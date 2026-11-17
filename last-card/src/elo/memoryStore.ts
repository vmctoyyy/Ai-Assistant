/**
 * An EloStore that keeps everything in memory.
 *
 * Used by the tests, and by the browser pass through `?eloStore=memory`, so
 * the screens can be driven end to end without a Firebase project. It is
 * deliberately NOT the fallback when Firebase is unconfigured: a store that
 * silently forgets everything on reload would look like it was working.
 */

import type { EloSnapshot, Game, Player } from './types';
import type { EloStore, Unsubscribe } from './store';

export interface MemoryStoreOptions {
  /** Seed data, so a test can start from a known table. */
  initial?: EloSnapshot;
  /** Milliseconds added to each successive write, standing in for the server clock. */
  now?: () => number;
  /** Make the next write fail, to exercise the error path. */
  failNextWrite?: boolean;
}

/**
 * Ids must be unique across stores, not just within one. Numbering from zero
 * per instance made two separate stores both hand out "mem-p-1", so importing
 * a backup overwrote an unrelated player that happened to share the number.
 */
let issued = 0;
function freshId(prefix: string): string {
  issued += 1;
  return `mem-${prefix}-${issued}-${Math.random().toString(36).slice(2, 8)}`;
}

export class MemoryEloStore implements EloStore {
  readonly kind = 'in-memory (test)';

  private players: Player[];
  private games: Game[];
  private listeners = new Set<(snapshot: EloSnapshot) => void>();
  private tick: () => number;
  private counter = 0;
  failNextWrite: boolean;

  constructor(options: MemoryStoreOptions = {}) {
    this.players = options.initial?.players.slice() ?? [];
    this.games = options.initial?.games.slice() ?? [];
    this.tick = options.now ?? (() => Date.now() + this.counter);
    this.failNextWrite = options.failNextWrite ?? false;
  }

  private snapshot(): EloSnapshot {
    return { players: this.players.slice(), games: this.games.slice() };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async write<T>(work: () => T): Promise<T> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('The test store was told to fail this write.');
    }
    this.counter += 1;
    const result = work();
    this.publish();
    return result;
  }

  subscribe(onData: (snapshot: EloSnapshot) => void): Unsubscribe {
    this.listeners.add(onData);
    onData(this.snapshot());
    return () => this.listeners.delete(onData);
  }

  async addPlayer(name: string): Promise<Player> {
    return this.write(() => {
      const player: Player = {
        id: freshId('p'),
        name: name.trim(),
        createdAt: this.tick(),
        deletedAt: null,
      };
      this.players.push(player);
      return player;
    });
  }

  async addGame(winnerId: string, loserIds: string[]): Promise<Game> {
    return this.write(() => {
      const game: Game = {
        id: freshId('g'),
        playedAt: this.tick(),
        winnerId,
        loserIds: loserIds.slice(),
        deletedAt: null,
      };
      this.games.push(game);
      return game;
    });
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.write(() => {
      this.games = this.games.map((g) =>
        g.id === gameId ? { ...g, deletedAt: g.deletedAt ?? this.tick() } : g,
      );
    });
  }

  async deletePlayer(playerId: string): Promise<void> {
    await this.write(() => {
      this.players = this.players.map((p) =>
        p.id === playerId ? { ...p, deletedAt: p.deletedAt ?? this.tick() } : p,
      );
    });
  }

  async importBackup(incoming: EloSnapshot): Promise<void> {
    await this.write(() => {
      this.players = upsert(this.players, incoming.players);
      this.games = upsert(this.games, incoming.games);
    });
  }
}

function upsert<T extends { id: string }>(existing: T[], incoming: readonly T[]): T[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()];
}
