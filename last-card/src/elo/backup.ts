/**
 * Backup files.
 *
 * Deleted records are included on purpose: a backup is everything the database
 * holds, so restoring one cannot quietly drop the history that "deleting"
 * was careful not to destroy.
 *
 * Pure — building and parsing are testable without a backend.
 */

import type { EloSnapshot, Game, Player } from './types';

export const BACKUP_FORMAT = 'last-card-elo';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  players: Player[];
  games: Game[];
}

export function buildBackup(snapshot: EloSnapshot, now: Date): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    players: snapshot.players,
    games: snapshot.games,
  };
}

export function backupFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `last-card-elo-${stamp}.json`;
}

function fail(message: string): never {
  throw new Error(message);
}

function asTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} is not a timestamp`);
  return value as number;
}

function asOptionalTimestamp(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return asTimestamp(value, field);
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} is missing`);
  return value as string;
}

/**
 * Reads a backup file. Strict on purpose — a half-understood file restored
 * into a shared database is worse than a refusal with a reason.
 */
export function parseBackup(text: string): EloSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('That file is not JSON.');
  }
  if (typeof raw !== 'object' || raw === null) fail('That file is not a backup.');

  const body = raw as Record<string, unknown>;
  if (body.format !== BACKUP_FORMAT) fail('That file is not a Last Card Elo backup.');
  if (typeof body.version !== 'number' || body.version > BACKUP_VERSION) {
    fail(`That backup is version ${String(body.version)}, which this app is too old to read.`);
  }
  if (!Array.isArray(body.players) || !Array.isArray(body.games)) {
    fail('That backup is missing its players or games.');
  }

  const players: Player[] = (body.players as unknown[]).map((entry, i) => {
    const p = entry as Record<string, unknown>;
    return {
      id: asNonEmptyString(p.id, `players[${i}].id`),
      name: asNonEmptyString(p.name, `players[${i}].name`),
      createdAt: asTimestamp(p.createdAt, `players[${i}].createdAt`),
      deletedAt: asOptionalTimestamp(p.deletedAt, `players[${i}].deletedAt`),
    };
  });

  const games: Game[] = (body.games as unknown[]).map((entry, i) => {
    const g = entry as Record<string, unknown>;
    if (!Array.isArray(g.loserIds) || g.loserIds.length === 0) {
      fail(`games[${i}].loserIds is missing`);
    }
    return {
      id: asNonEmptyString(g.id, `games[${i}].id`),
      playedAt: asTimestamp(g.playedAt, `games[${i}].playedAt`),
      winnerId: asNonEmptyString(g.winnerId, `games[${i}].winnerId`),
      loserIds: (g.loserIds as unknown[]).map((id, j) =>
        asNonEmptyString(id, `games[${i}].loserIds[${j}]`),
      ),
      deletedAt: asOptionalTimestamp(g.deletedAt, `games[${i}].deletedAt`),
    };
  });

  const ids = new Set<string>();
  for (const p of players) {
    if (ids.has(p.id)) fail(`Two players share the id ${p.id}.`);
    ids.add(p.id);
  }
  const gameIds = new Set<string>();
  for (const g of games) {
    if (gameIds.has(g.id)) fail(`Two games share the id ${g.id}.`);
    gameIds.add(g.id);
  }

  return { players, games };
}
