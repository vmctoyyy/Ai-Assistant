/**
 * An EloStore backed by Cloud Firestore.
 *
 * Two collections, named in config.ts, which are the only ones the security
 * rules open up. Timestamps are always the server's: replay order depends on
 * them, so a device with a wrong clock must not be able to reorder history.
 *
 * A write that the server has not acknowledged has a null timestamp, and such
 * records are left out of the snapshot entirely. That is what makes "never
 * show a result as recorded until the backend confirms it" true by
 * construction rather than by remembering to check.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';

import {
  FIREBASE_CONFIG,
  GAMES_COLLECTION,
  PLAYERS_COLLECTION,
  type FirebaseConfigValues,
} from './config';
import { EloStoreError, type EloStore, type Unsubscribe } from './store';
import type { EloSnapshot, Game, Player } from './types';

const BATCH_LIMIT = 400;

/** Firestore hands back Timestamps; everything above this file wants millis. */
function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readPlayer(id: string, data: DocumentData): Player | null {
  const createdAt = millis(data.createdAt);
  if (createdAt === null) return null; // not yet confirmed by the server
  const name = typeof data.name === 'string' ? data.name : '';
  if (name.trim() === '') return null;
  return { id, name, createdAt, deletedAt: millis(data.deletedAt) };
}

function readGame(id: string, data: DocumentData): Game | null {
  const playedAt = millis(data.playedAt);
  if (playedAt === null) return null; // not yet confirmed by the server
  const winnerId = typeof data.winnerId === 'string' ? data.winnerId : '';
  const loserIds = Array.isArray(data.loserIds)
    ? data.loserIds.filter((v): v is string => typeof v === 'string')
    : [];
  if (winnerId === '' || loserIds.length === 0) return null;
  return { id, playedAt, winnerId, loserIds, deletedAt: millis(data.deletedAt) };
}

export class FirestoreEloStore implements EloStore {
  readonly kind = 'Firestore';

  private app: FirebaseApp;
  private db: Firestore;

  constructor(config: FirebaseConfigValues = FIREBASE_CONFIG, appName = 'last-card-elo') {
    this.app = initializeApp({ ...config }, appName);
    this.db = getFirestore(this.app);
  }

  subscribe(onData: (snapshot: EloSnapshot) => void, onError: (error: Error) => void): Unsubscribe {
    let players: Player[] = [];
    let games: Game[] = [];
    let havePlayers = false;
    let haveGames = false;

    const emit = () => {
      // Hold the first frame until both collections have arrived, so the
      // leaderboard never flashes a table with players but no games.
      if (havePlayers && haveGames) onData({ players, games });
    };

    const fail = (what: string) => (error: unknown) =>
      onError(new EloStoreError(`Could not read ${what} from Firestore.`, error));

    const unsubPlayers = onSnapshot(
      collection(this.db, PLAYERS_COLLECTION),
      (snap: QuerySnapshot) => {
        players = snap.docs
          .map((d) => readPlayer(d.id, d.data()))
          .filter((p): p is Player => p !== null);
        havePlayers = true;
        emit();
      },
      fail('the players'),
    );

    const unsubGames = onSnapshot(
      collection(this.db, GAMES_COLLECTION),
      (snap: QuerySnapshot) => {
        games = snap.docs.map((d) => readGame(d.id, d.data())).filter((g): g is Game => g !== null);
        haveGames = true;
        emit();
      },
      fail('the games'),
    );

    return () => {
      unsubPlayers();
      unsubGames();
    };
  }

  async addPlayer(name: string): Promise<Player> {
    try {
      const ref = await addDoc(collection(this.db, PLAYERS_COLLECTION), {
        name: name.trim(),
        createdAt: serverTimestamp(),
        deletedAt: null,
      });
      // addDoc resolves once the server has it, so the id and the write are real.
      return { id: ref.id, name: name.trim(), createdAt: Date.now(), deletedAt: null };
    } catch (error) {
      throw new EloStoreError('Could not save that player.', error);
    }
  }

  async addGame(winnerId: string, loserIds: string[]): Promise<Game> {
    try {
      const ref = await addDoc(collection(this.db, GAMES_COLLECTION), {
        winnerId,
        loserIds,
        playedAt: serverTimestamp(),
        deletedAt: null,
      });
      return { id: ref.id, playedAt: Date.now(), winnerId, loserIds, deletedAt: null };
    } catch (error) {
      throw new EloStoreError('Could not save that result.', error);
    }
  }

  async deleteGame(gameId: string): Promise<void> {
    try {
      await updateDoc(doc(this.db, GAMES_COLLECTION, gameId), { deletedAt: serverTimestamp() });
    } catch (error) {
      throw new EloStoreError('Could not delete that game.', error);
    }
  }

  async deletePlayer(playerId: string): Promise<void> {
    try {
      await updateDoc(doc(this.db, PLAYERS_COLLECTION, playerId), { deletedAt: serverTimestamp() });
    } catch (error) {
      throw new EloStoreError('Could not delete that player.', error);
    }
  }

  async importBackup(incoming: EloSnapshot): Promise<void> {
    // Upsert by id, never remove: a restore must not undo the care taken to
    // keep deleted records.
    const stamp = (value: number | null) => (value === null ? null : Timestamp.fromMillis(value));

    const rows: Array<{ path: string; id: string; data: DocumentData }> = [
      ...incoming.players.map((p) => ({
        path: PLAYERS_COLLECTION,
        id: p.id,
        data: {
          name: p.name,
          createdAt: Timestamp.fromMillis(p.createdAt),
          deletedAt: stamp(p.deletedAt),
        },
      })),
      ...incoming.games.map((g) => ({
        path: GAMES_COLLECTION,
        id: g.id,
        data: {
          winnerId: g.winnerId,
          loserIds: g.loserIds,
          playedAt: Timestamp.fromMillis(g.playedAt),
          deletedAt: stamp(g.deletedAt),
        },
      })),
    ];

    try {
      // Firestore caps a batch at 500 writes.
      for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
        const batch = writeBatch(this.db);
        for (const row of rows.slice(i, i + BATCH_LIMIT)) {
          batch.set(doc(this.db, row.path, row.id), row.data, { merge: true });
        }
        await batch.commit();
      }
    } catch (error) {
      throw new EloStoreError('Could not restore that backup.', error);
    }
  }
}
