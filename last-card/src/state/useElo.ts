/**
 * Glue between the Elo store and React.
 *
 * Holds no ratings: the snapshot of games is the only state, and every figure
 * on screen is derived from it by `replay`. Nothing here decides a rule.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildBackup, backupFilename, parseBackup } from '../elo/backup';
import { FIREBASE_CONFIG, isFirebaseConfigured } from '../elo/config';
import { headToHead, nameIsTaken, liveGameCount, replay } from '../elo/elo';
import { MemoryEloStore } from '../elo/memoryStore';
import type { EloStore } from '../elo/store';
import type { EloSnapshot, Game } from '../elo/types';

export type Readiness =
  | { state: 'unconfigured' }
  | { state: 'loading'; store: EloStore }
  | { state: 'ready'; store: EloStore }
  | { state: 'error'; store: EloStore; message: string };

const EMPTY: EloSnapshot = { players: [], games: [] };

/**
 * Test hooks, both inert unless asked for by name in the address:
 *   ?eloStore=memory  the in-memory store, so the screens can be driven in a
 *                     browser without touching the real database
 *   ?eloStore=none    pretend nothing is configured, to exercise the
 *                     not-set-up screen once a real config exists
 *
 * Production never falls back to the memory store on its own: one that forgets
 * everything on reload would look like it was working.
 */
function storeOverride(): 'memory' | 'none' | null {
  if (typeof window === 'undefined') return null;
  const asked = new URLSearchParams(window.location.search).get('eloStore');
  return asked === 'memory' || asked === 'none' ? asked : null;
}

async function makeStore(): Promise<EloStore | null> {
  const override = storeOverride();
  if (override === 'memory') return new MemoryEloStore();
  if (override === 'none') return null;
  if (!isFirebaseConfigured(FIREBASE_CONFIG)) return null;
  // Loaded only when it will actually be used, so an unconfigured app never
  // pays for the Firebase bundle.
  const { FirestoreEloStore } = await import('../elo/firestoreStore');
  return new FirestoreEloStore(FIREBASE_CONFIG);
}

export function useElo() {
  const [readiness, setReadiness] = useState<Readiness>({ state: 'unconfigured' });
  const [snapshot, setSnapshot] = useState<EloSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef<EloStore | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const store = await makeStore();
      if (cancelled) return;
      if (!store) {
        setReadiness({ state: 'unconfigured' });
        return;
      }
      storeRef.current = store;
      setReadiness({ state: 'loading', store });
      stop = store.subscribe(
        (next) => {
          setSnapshot(next);
          setReadiness({ state: 'ready', store });
        },
        (e) => setReadiness({ state: 'error', store, message: e.message }),
      );
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const table = useMemo(() => replay(snapshot), [snapshot]);

  const standings = useMemo(
    () => [...table.standings.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)),
    [table],
  );

  /** Runs a write, reporting a failure rather than letting it pass as done. */
  const run = useCallback(async <T,>(work: (store: EloStore) => Promise<T>): Promise<T | null> => {
    const store = storeRef.current;
    if (!store) {
      setError('The rankings database is not set up yet.');
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      return await work(store);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const addPlayer = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') {
        setError('A player needs a name.');
        return null;
      }
      if (nameIsTaken(snapshot.players, trimmed)) {
        setError(`There is already a player called ${trimmed}.`);
        return null;
      }
      return run((store) => store.addPlayer(trimmed));
    },
    [run, snapshot.players],
  );

  const recordGame = useCallback(
    async (winnerId: string, loserId: string) => {
      if (winnerId === loserId) {
        setError('A player cannot beat themselves.');
        return null;
      }
      if (!winnerId || !loserId) {
        setError('Pick a winner and a loser.');
        return null;
      }
      return run((store) => store.addGame(winnerId, [loserId]));
    },
    [run],
  );

  const deleteGame = useCallback((gameId: string) => run((store) => store.deleteGame(gameId)), [run]);

  const deletePlayer = useCallback(
    async (playerId: string) => {
      if (liveGameCount(snapshot, playerId) > 0) {
        setError('That player still has games. Delete those first.');
        return null;
      }
      return run((store) => store.deletePlayer(playerId));
    },
    [run, snapshot],
  );

  const exportBackup = useCallback(() => {
    const now = new Date();
    const text = JSON.stringify(buildBackup(snapshot, now), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFilename(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [snapshot]);

  const importBackup = useCallback(
    async (text: string) => {
      let parsed: EloSnapshot;
      try {
        parsed = parseBackup(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
      return run((store) => store.importBackup(parsed));
    },
    [run],
  );

  const gamesFor = useCallback(
    (playerId: string): Game[] =>
      snapshot.games
        .filter(
          (g) =>
            g.deletedAt === null && (g.winnerId === playerId || g.loserIds.includes(playerId)),
        )
        .sort((a, b) => b.playedAt - a.playedAt),
    [snapshot],
  );

  return {
    readiness,
    snapshot,
    table,
    standings,
    busy,
    error,
    clearError: () => setError(null),
    addPlayer,
    recordGame,
    deleteGame,
    deletePlayer,
    exportBackup,
    importBackup,
    gamesFor,
    headToHeadFor: (playerId: string) => headToHead(snapshot, playerId),
    liveGamesFor: (playerId: string) => liveGameCount(snapshot, playerId),
  };
}

export type EloApi = ReturnType<typeof useElo>;
