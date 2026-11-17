import { describe, expect, it } from 'vitest';

import {
  K_FACTOR,
  START_RATING,
  expectedScore,
  forDisplay,
  formatDelta,
  headToHead,
  liveGameCount,
  nameIsTaken,
  nextRating,
  replay,
  winPercent,
} from './elo';
import type { EloSnapshot, Game, Player } from './types';

let seq = 0;
function player(name: string, overrides: Partial<Player> = {}): Player {
  seq += 1;
  return { id: `p${seq}`, name, createdAt: seq, deletedAt: null, ...overrides };
}

function game(winnerId: string, loserId: string, overrides: Partial<Game> = {}): Game {
  seq += 1;
  return {
    id: `g${seq}`,
    playedAt: seq * 1000,
    winnerId,
    loserIds: [loserId],
    deletedAt: null,
    ...overrides,
  };
}

function snapshot(players: Player[], games: Game[]): EloSnapshot {
  return { players, games };
}

function ratingOf(s: EloSnapshot, id: string): number {
  return replay(s).standings.get(id)!.rating;
}

// ---------------------------------------------------------------------------
// The four cases named in the brief
// ---------------------------------------------------------------------------

describe('the required cases', () => {
  it('moves equal ratings by 16 — winner up, loser down', () => {
    const josh = player('Josh');
    const levon = player('Levon');
    const s = snapshot([josh, levon], [game(josh.id, levon.id)]);

    expect(forDisplay(ratingOf(s, josh.id))).toBe(1016);
    expect(forDisplay(ratingOf(s, levon.id))).toBe(984);
  });

  it('pays an underdog more than a favourite', () => {
    const strong = player('Strong');
    const weak = player('Weak');

    // Give the favourite a lead by having them win a few first.
    const lead = [1, 2, 3].map(() => game(strong.id, weak.id));
    const before = snapshot([strong, weak], lead);
    expect(ratingOf(before, strong.id)).toBeGreaterThan(ratingOf(before, weak.id));

    const underdogWins = replay(snapshot([strong, weak], [...lead, game(weak.id, strong.id)]));
    const favouriteWins = replay(snapshot([strong, weak], [...lead, game(strong.id, weak.id)]));

    const underdogGain = underdogWins.changes.at(-2)!.delta; // the weak player's win
    const favouriteGain = favouriteWins.changes.at(-2)!.delta;

    expect(underdogGain).toBeGreaterThan(favouriteGain);
  });

  it('gives the winner exactly what it takes from the loser', () => {
    const a = player('A');
    const b = player('B');
    // Lopsided ratings, so this is not just true by symmetry.
    const history = [game(a.id, b.id), game(a.id, b.id), game(a.id, b.id), game(a.id, b.id)];

    for (const decider of [game(a.id, b.id), game(b.id, a.id)]) {
      const r = replay(snapshot([a, b], [...history, decider]));
      const [winner, loser] = r.changesByGame.get(decider.id)!;
      expect(winner.delta).toBeCloseTo(-loser.delta, 10);
    }
  });

  it('treats a deleted game exactly as if it had never been recorded', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');

    const first = game(a.id, b.id);
    const middle = game(b.id, c.id);
    const last = game(c.id, a.id);

    const withMiddleDeleted = snapshot(
      [a, b, c],
      [first, { ...middle, deletedAt: 123 }, last],
    );
    const neverRecorded = snapshot([a, b, c], [first, last]);

    for (const id of [a.id, b.id, c.id]) {
      expect(ratingOf(withMiddleDeleted, id)).toBeCloseTo(ratingOf(neverRecorded, id), 10);
    }

    const r = replay(withMiddleDeleted);
    expect(r.changesByGame.has(middle.id)).toBe(false);
    expect(r.standings.get(b.id)!.wins).toBe(0);
    expect(r.standings.get(c.id)!.losses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The formula itself
// ---------------------------------------------------------------------------

describe('the formula', () => {
  it('calls an even match even', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 12);
  });

  it('gives 400 points of lead roughly ten to one', () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 12);
    expect(expectedScore(1000, 1400)).toBeCloseTo(1 / 11, 12);
  });

  it('keeps the two expectations adding to one', () => {
    expect(expectedScore(1234, 987) + expectedScore(987, 1234)).toBeCloseTo(1, 12);
  });

  it('moves by K times the surprise', () => {
    expect(nextRating(1000, 1000, 1) - 1000).toBeCloseTo(K_FACTOR * 0.5, 12);
    expect(nextRating(1000, 1000, 0) - 1000).toBeCloseTo(-K_FACTOR * 0.5, 12);
  });

  it('can never move further than K in one game', () => {
    for (const [a, b] of [[1000, 9000], [9000, 1000], [1000, 1000], [2400, 800]]) {
      expect(Math.abs(nextRating(a, b, 1) - a)).toBeLessThanOrEqual(K_FACTOR + 1e-9);
      expect(Math.abs(nextRating(a, b, 0) - a)).toBeLessThanOrEqual(K_FACTOR + 1e-9);
    }
  });

  it('starts everyone at the named constant', () => {
    const a = player('A');
    expect(ratingOf(snapshot([a], []), a.id)).toBe(START_RATING);
  });

  it('keeps full precision internally and rounds only to show', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const s = snapshot([a, b, c], [game(a.id, b.id), game(b.id, c.id), game(c.id, a.id)]);
    const raw = ratingOf(s, a.id);
    expect(Number.isInteger(raw)).toBe(false);
    expect(Number.isInteger(forDisplay(raw))).toBe(true);
  });

  it('conserves the total rating across the table', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const s = snapshot(
      [a, b, c],
      [game(a.id, b.id), game(b.id, c.id), game(c.id, a.id), game(a.id, c.id)],
    );
    const total = [a, b, c].reduce((n, p) => n + ratingOf(s, p.id), 0);
    expect(total).toBeCloseTo(3 * START_RATING, 8);
  });
});

// ---------------------------------------------------------------------------
// Replay order and derived figures
// ---------------------------------------------------------------------------

describe('replaying the games', () => {
  it('orders by server timestamp, not by the order they arrive in', () => {
    const a = player('A');
    const b = player('B');
    const first = { ...game(a.id, b.id), playedAt: 1000 };
    const second = { ...game(b.id, a.id), playedAt: 2000 };

    const forwards = replay(snapshot([a, b], [first, second]));
    const backwards = replay(snapshot([a, b], [second, first]));

    expect(forwards.standings.get(a.id)!.rating).toBeCloseTo(
      backwards.standings.get(a.id)!.rating,
      10,
    );
    expect(backwards.changes[0].gameId).toBe(first.id);
  });

  it('breaks a timestamp tie by id, so the result never wanders', () => {
    const a = player('A');
    const b = player('B');
    const x = { ...game(a.id, b.id), id: 'g-aaa', playedAt: 5000 };
    const y = { ...game(b.id, a.id), id: 'g-bbb', playedAt: 5000 };
    expect(replay(snapshot([a, b], [x, y])).changes[0].gameId).toBe('g-aaa');
    expect(replay(snapshot([a, b], [y, x])).changes[0].gameId).toBe('g-aaa');
  });

  it('counts wins and losses from the games, not from a stored tally', () => {
    const a = player('A');
    const b = player('B');
    const s = snapshot([a, b], [game(a.id, b.id), game(a.id, b.id), game(b.id, a.id)]);
    const r = replay(s);
    expect([r.standings.get(a.id)!.wins, r.standings.get(a.id)!.losses]).toEqual([2, 1]);
    expect([r.standings.get(b.id)!.wins, r.standings.get(b.id)!.losses]).toEqual([1, 2]);
  });

  it('ranks by rating and lets equal ratings share a rank', () => {
    const a = player('Alice');
    const b = player('Bob');
    const c = player('Carol');
    const r = replay(snapshot([a, b, c], [])); // all on 1000
    expect([a, b, c].map((p) => r.standings.get(p.id)!.rank)).toEqual([1, 1, 1]);

    const r2 = replay(snapshot([a, b, c], [game(a.id, b.id)]));
    expect(r2.standings.get(a.id)!.rank).toBe(1);
    expect(r2.standings.get(c.id)!.rank).toBe(2);
    expect(r2.standings.get(b.id)!.rank).toBe(3);
  });

  it('hides a deleted player and leaves the live ones alone', () => {
    const a = player('A');
    const b = player('B');
    const gone = player('Gone', { deletedAt: 5 });
    const r = replay(snapshot([a, b, gone], [game(a.id, b.id)]));
    expect(r.standings.has(gone.id)).toBe(false);
    expect(r.standings.size).toBe(2);
  });

  it('skips a game naming somebody who is not there rather than guessing', () => {
    const a = player('A');
    const r = replay(snapshot([a], [game(a.id, 'nobody')]));
    expect(r.standings.get(a.id)!.rating).toBe(START_RATING);
    expect(r.changes).toEqual([]);
  });

  it('records what each game did to each player', () => {
    const a = player('A');
    const b = player('B');
    const only = game(a.id, b.id);
    const r = replay(snapshot([a, b], [only]));
    const [winner, loser] = r.changesByGame.get(only.id)!;

    expect(winner.playerId).toBe(a.id);
    expect(winner.won).toBe(true);
    expect(forDisplay(winner.before)).toBe(1000);
    expect(forDisplay(winner.after)).toBe(1016);
    expect(loser.won).toBe(false);
    expect(loser.opponentIds).toEqual([a.id]);
  });

  it('leaves loserIds open for more than one loser without changing today', () => {
    // Not a feature yet — just proof the shape does not block it, and that a
    // single loser still gives exactly the two-player answer.
    const w = player('W');
    const x = player('X');
    const y = player('Y');
    const multi: Game = { ...game(w.id, x.id), loserIds: [x.id, y.id] };
    const r = replay(snapshot([w, x, y], [multi]));

    expect(r.changesByGame.get(multi.id)).toHaveLength(3);
    expect(forDisplay(r.standings.get(x.id)!.rating)).toBe(984);
    expect(forDisplay(r.standings.get(y.id)!.rating)).toBe(984);
    expect(forDisplay(r.standings.get(w.id)!.rating)).toBe(1032); // 16 from each
  });
});

// ---------------------------------------------------------------------------
// The small helpers the screens use
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('formats a delta with its sign', () => {
    expect(formatDelta(16.4)).toBe('+16');
    expect(formatDelta(-15.6)).toBe('-16');
    expect(formatDelta(0)).toBe('+0');
  });

  it('reports a win percentage, and nothing before any games', () => {
    expect(winPercent(0, 0)).toBeNull();
    expect(winPercent(1, 1)).toBe(50);
    expect(winPercent(3, 1)).toBe(75);
  });

  it('builds a head-to-head record per opponent', () => {
    const a = player('A');
    const b = player('B');
    const c = player('C');
    const s = snapshot(
      [a, b, c],
      [game(a.id, b.id), game(b.id, a.id), game(a.id, b.id), game(a.id, c.id)],
    );
    const rows = headToHead(s, a.id);
    expect(rows.map((r) => [r.opponentName, r.wins, r.losses])).toEqual([
      ['B', 2, 1],
      ['C', 1, 0],
    ]);
  });

  it('leaves a deleted game out of the head-to-head', () => {
    const a = player('A');
    const b = player('B');
    const s = snapshot([a, b], [{ ...game(a.id, b.id), deletedAt: 1 }]);
    expect(headToHead(s, a.id)).toEqual([]);
  });

  it('refuses a duplicate name whatever its case or padding', () => {
    const players = [player('Josh')];
    expect(nameIsTaken(players, 'josh')).toBe(true);
    expect(nameIsTaken(players, '  JOSH  ')).toBe(true);
    expect(nameIsTaken(players, 'Joshua')).toBe(false);
  });

  it('frees a name again once its player is deleted', () => {
    expect(nameIsTaken([player('Josh', { deletedAt: 9 })], 'Josh')).toBe(false);
  });

  it('counts the live games that would block deleting a player', () => {
    const a = player('A');
    const b = player('B');
    const s = snapshot([a, b], [game(a.id, b.id), { ...game(b.id, a.id), deletedAt: 1 }]);
    expect(liveGameCount(s, a.id)).toBe(1);
    expect(liveGameCount(snapshot([a, b], []), a.id)).toBe(0);
  });
});
