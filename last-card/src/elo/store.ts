/**
 * Storage, behind an interface.
 *
 * Nothing above this file knows whether the records live in Firestore, in
 * memory, or somewhere else later. The screens only ever see an EloSnapshot
 * and call these methods.
 */

import type { EloSnapshot, Game, Player } from './types';

export type Unsubscribe = () => void;

export interface EloStore {
  /** Named in error messages, so a failure says which backend failed. */
  readonly kind: string;

  /**
   * Live updates. `onData` fires with the whole snapshot on first load and
   * again on every change, including ones made on other devices. Records that
   * the backend has not yet confirmed must not appear.
   */
  subscribe(onData: (snapshot: EloSnapshot) => void, onError: (error: Error) => void): Unsubscribe;

  /** Resolves only once the backend has the player. */
  addPlayer(name: string): Promise<Player>;

  /** Resolves only once the backend has the game, with its server timestamp. */
  addGame(winnerId: string, loserIds: string[]): Promise<Game>;

  /** Sets deletedAt. The record stays in the database. */
  deleteGame(gameId: string): Promise<void>;

  /** Sets deletedAt. Callers must check the player has no live games first. */
  deletePlayer(playerId: string): Promise<void>;

  /** Upserts every record in a backup by id. Never removes anything. */
  importBackup(snapshot: EloSnapshot): Promise<void>;
}

/** Thrown for a save the backend refused or never confirmed. */
export class EloStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EloStoreError';
  }
}
