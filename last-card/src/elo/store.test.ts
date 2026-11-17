import { describe, expect, it, vi } from 'vitest';

import { buildBackup, backupFilename, parseBackup } from './backup';
import { forDisplay, replay } from './elo';
import { MemoryEloStore } from './memoryStore';
import type { EloSnapshot } from './types';

function latest(store: MemoryEloStore): EloSnapshot {
  let seen: EloSnapshot = { players: [], games: [] };
  const stop = store.subscribe((s) => {
    seen = s;
  });
  stop();
  return seen;
}

describe('the store contract', () => {
  it('publishes to every subscriber on a change, which is what makes other devices update', async () => {
    const store = new MemoryEloStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    await store.addPlayer('Josh');

    expect(a).toHaveBeenCalledTimes(2); // first load, then the change
    expect(b).toHaveBeenCalledTimes(2);
    expect(a.mock.calls.at(-1)![0].players[0].name).toBe('Josh');
  });

  it('stops publishing once unsubscribed', async () => {
    const store = new MemoryEloStore();
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    stop();
    await store.addPlayer('Josh');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('resolves a write only when the record exists', async () => {
    const store = new MemoryEloStore();
    const josh = await store.addPlayer('Josh');
    expect(latest(store).players.map((p) => p.id)).toContain(josh.id);
  });

  it('reports a failed save instead of pretending it worked', async () => {
    const store = new MemoryEloStore({ failNextWrite: true });
    await expect(store.addPlayer('Josh')).rejects.toThrow(/fail this write/);
    expect(latest(store).players).toEqual([]);
  });

  it('soft-deletes a game, keeping the record', async () => {
    const store = new MemoryEloStore();
    const josh = await store.addPlayer('Josh');
    const levon = await store.addPlayer('Levon');
    const g = await store.addGame(josh.id, [levon.id]);

    await store.deleteGame(g.id);

    const after = latest(store);
    expect(after.games).toHaveLength(1); // still there
    expect(after.games[0].deletedAt).not.toBeNull();
    expect(replay(after).changes).toEqual([]); // but ignored
    expect(forDisplay(replay(after).standings.get(josh.id)!.rating)).toBe(1000);
  });

  it('soft-deletes a player, keeping the record', async () => {
    const store = new MemoryEloStore();
    const josh = await store.addPlayer('Josh');
    await store.deletePlayer(josh.id);

    const after = latest(store);
    expect(after.players).toHaveLength(1);
    expect(after.players[0].deletedAt).not.toBeNull();
    expect(replay(after).standings.size).toBe(0);
  });

  it('gives each game a later timestamp than the last, so replay order is stable', async () => {
    const store = new MemoryEloStore();
    const a = await store.addPlayer('A');
    const b = await store.addPlayer('B');
    const first = await store.addGame(a.id, [b.id]);
    const second = await store.addGame(b.id, [a.id]);
    expect(second.playedAt).toBeGreaterThan(first.playedAt);
  });
});

describe('backups', () => {
  async function populated() {
    const store = new MemoryEloStore();
    const josh = await store.addPlayer('Josh');
    const levon = await store.addPlayer('Levon');
    const kept = await store.addGame(josh.id, [levon.id]);
    const binned = await store.addGame(levon.id, [josh.id]);
    await store.deleteGame(binned.id);
    return { store, josh, levon, kept, binned };
  }

  it('includes deleted records, because a backup is the whole database', async () => {
    const { store, binned } = await populated();
    const backup = buildBackup(latest(store), new Date('2026-01-02T03:04:05Z'));

    expect(backup.games.map((g) => g.id)).toContain(binned.id);
    expect(backup.games.find((g) => g.id === binned.id)!.deletedAt).not.toBeNull();
    expect(backup.exportedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('round-trips through the file exactly', async () => {
    const { store } = await populated();
    const before = latest(store);
    const text = JSON.stringify(buildBackup(before, new Date()));
    expect(parseBackup(text)).toEqual(before);
  });

  it('restores into an empty database and gives back the same ratings', async () => {
    const { store, josh } = await populated();
    const text = JSON.stringify(buildBackup(latest(store), new Date()));

    const fresh = new MemoryEloStore();
    await fresh.importBackup(parseBackup(text));

    expect(forDisplay(replay(latest(fresh)).standings.get(josh.id)!.rating)).toBe(
      forDisplay(replay(latest(store)).standings.get(josh.id)!.rating),
    );
  });

  it('upserts rather than wiping, so a restore never destroys history', async () => {
    const { store } = await populated();
    const backup = parseBackup(JSON.stringify(buildBackup(latest(store), new Date())));

    const target = new MemoryEloStore();
    const other = await target.addPlayer('Someone else');
    await target.importBackup(backup);

    expect(latest(target).players.map((p) => p.name)).toContain('Someone else');
    expect(latest(target).players.map((p) => p.name)).toContain('Josh');
    void other;
  });

  it('is idempotent — importing twice changes nothing the second time', async () => {
    const { store } = await populated();
    const backup = parseBackup(JSON.stringify(buildBackup(latest(store), new Date())));

    const target = new MemoryEloStore();
    await target.importBackup(backup);
    const once = latest(target);
    await target.importBackup(backup);
    expect(latest(target)).toEqual(once);
  });

  it('names the file by the moment it was taken', () => {
    expect(backupFilename(new Date('2026-01-02T03:04:05Z'))).toBe(
      'last-card-elo-2026-01-02-03-04-05.json',
    );
  });

  it('refuses a file it does not understand, with a reason', () => {
    expect(() => parseBackup('not json')).toThrow(/not JSON/);
    expect(() => parseBackup('{"format":"something-else"}')).toThrow(/not a Last Card Elo backup/);
    expect(() => parseBackup('{"format":"last-card-elo","version":99}')).toThrow(/too old to read/);
    expect(() => parseBackup('{"format":"last-card-elo","version":1}')).toThrow(/missing its players/);
  });

  it('refuses a record with a missing or malformed field', () => {
    const base = { format: 'last-card-elo', version: 1, exportedAt: '', players: [], games: [] };
    expect(() =>
      parseBackup(JSON.stringify({ ...base, players: [{ id: 'p1', createdAt: 1 }] })),
    ).toThrow(/players\[0\].name is missing/);
    expect(() =>
      parseBackup(JSON.stringify({ ...base, players: [{ id: 'p1', name: 'A', createdAt: 'soon' }] })),
    ).toThrow(/createdAt is not a timestamp/);
    expect(() =>
      parseBackup(
        JSON.stringify({ ...base, games: [{ id: 'g1', playedAt: 1, winnerId: 'p1', loserIds: [] }] }),
      ),
    ).toThrow(/loserIds is missing/);
  });

  it('refuses duplicate ids rather than silently dropping one', () => {
    const dup = {
      format: 'last-card-elo',
      version: 1,
      exportedAt: '',
      players: [
        { id: 'p1', name: 'A', createdAt: 1, deletedAt: null },
        { id: 'p1', name: 'B', createdAt: 2, deletedAt: null },
      ],
      games: [],
    };
    expect(() => parseBackup(JSON.stringify(dup))).toThrow(/share the id p1/);
  });
});
