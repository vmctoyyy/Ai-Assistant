/**
 * Elo ranking — data model.
 *
 * Deliberately separate from the card game: these records are entered by hand
 * and are not linked to games played in the app, to accounts, or to lobbies.
 */

export interface Player {
  id: string;
  name: string;
  /** Milliseconds since the epoch, from the server. */
  createdAt: number;
  /** Set when "deleted". Records are never removed, only hidden. */
  deletedAt: number | null;
}

export interface Game {
  id: string;
  /** Server timestamp. Replay order depends on it, so it is never set locally. */
  playedAt: number;
  winnerId: string;
  /**
   * Always one entry for now. It is an array so a later version can record a
   * multiplayer game — one winner, everyone else loses, no placings — without
   * a migration.
   */
  loserIds: string[];
  deletedAt: number | null;
}

/** Everything the store holds, deleted records included. */
export interface EloSnapshot {
  players: Player[];
  games: Game[];
}

/** A player's standing, derived by replaying the games. Never stored. */
export interface Standing {
  playerId: string;
  name: string;
  /** Full precision. Round only for display. */
  rating: number;
  wins: number;
  losses: number;
  /** 1-based, by rating. Equal ratings share a rank. */
  rank: number;
}

/** What one game did to one player's rating. */
export interface RatingChange {
  gameId: string;
  playerId: string;
  before: number;
  after: number;
  /** after - before. Positive for the winner. */
  delta: number;
  won: boolean;
  opponentIds: string[];
}

export interface Replay {
  /** Player id -> standing, for every player who exists. */
  standings: Map<string, Standing>;
  /** In replay order, oldest first. */
  changes: RatingChange[];
  /** Game id -> the changes that game caused. */
  changesByGame: Map<string, RatingChange[]>;
}
