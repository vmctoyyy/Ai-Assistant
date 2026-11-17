/**
 * Elo ranking — the maths.
 *
 * Pure: no React, no storage, no clock, no randomness. The list of games is
 * the source of truth, and every rating, win, loss and per-game change is
 * derived by replaying it from the starting rating. Nothing here reads a
 * stored rating, because there is no stored rating to read.
 */

import type { EloSnapshot, Game, Player, RatingChange, Replay, Standing } from './types';

/** Everyone starts here. */
export const START_RATING = 1000;

/** How much a single result can move a rating. */
export const K_FACTOR = 32;

/**
 * The chance `rating` beats `opponentRating`, between 0 and 1.
 *
 *   E = 1 / (1 + 10^((opponent - player) / 400))
 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * The new rating after a result.
 *
 * `score` is 1 for a win and 0 for a loss; there are no draws, but the formula
 * is the general one and 0.5 would work if that ever changed.
 */
export function nextRating(rating: number, opponentRating: number, score: number): number {
  return rating + K_FACTOR * (score - expectedScore(rating, opponentRating));
}

/** Games in the order they count: by server timestamp, then by id to break ties. */
export function replayOrder(games: readonly Game[]): Game[] {
  return games
    .slice()
    .sort((a, b) => (a.playedAt === b.playedAt ? a.id.localeCompare(b.id) : a.playedAt - b.playedAt));
}

export function isLive<T extends { deletedAt: number | null }>(record: T): boolean {
  return record.deletedAt === null || record.deletedAt === undefined;
}

/**
 * Replays every live game in order and returns what the ratings are now.
 *
 * Deleting a game is therefore the same as it never having been recorded: it
 * simply stops appearing here, and everything after it is worked out again.
 */
export function replay(snapshot: EloSnapshot): Replay {
  const players = snapshot.players.filter(isLive);
  const games = replayOrder(snapshot.games.filter(isLive));

  const rating = new Map<string, number>();
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const p of players) {
    rating.set(p.id, START_RATING);
    wins.set(p.id, 0);
    losses.set(p.id, 0);
  }

  // A game naming a player who no longer exists is skipped rather than
  // guessed at. A player can only be deleted with no live games, so this is
  // a torn-data case, not a normal one.
  const known = (id: string) => rating.has(id);

  const changes: RatingChange[] = [];
  const changesByGame = new Map<string, RatingChange[]>();

  for (const game of games) {
    const losers = game.loserIds.filter(known);
    if (!known(game.winnerId) || losers.length === 0) continue;

    const winnerBefore = rating.get(game.winnerId)!;

    // Every loser is scored against the winner's rating as it stood at the
    // start of the game, so the order of the losers cannot matter. With one
    // loser — all this records today — it is the plain two-player formula.
    let winnerAfter = winnerBefore;
    const perGame: RatingChange[] = [];

    for (const loserId of losers) {
      const loserBefore = rating.get(loserId)!;
      const loserAfter = nextRating(loserBefore, winnerBefore, 0);
      rating.set(loserId, loserAfter);
      losses.set(loserId, losses.get(loserId)! + 1);

      winnerAfter += nextRating(winnerBefore, loserBefore, 1) - winnerBefore;

      perGame.push({
        gameId: game.id,
        playerId: loserId,
        before: loserBefore,
        after: loserAfter,
        delta: loserAfter - loserBefore,
        won: false,
        opponentIds: [game.winnerId],
      });
    }

    rating.set(game.winnerId, winnerAfter);
    wins.set(game.winnerId, wins.get(game.winnerId)! + 1);

    perGame.unshift({
      gameId: game.id,
      playerId: game.winnerId,
      before: winnerBefore,
      after: winnerAfter,
      delta: winnerAfter - winnerBefore,
      won: true,
      opponentIds: losers,
    });

    changesByGame.set(game.id, perGame);
    changes.push(...perGame);
  }

  const standings = rankStandings(players, rating, wins, losses);
  return { standings, changes, changesByGame };
}

function rankStandings(
  players: readonly Player[],
  rating: Map<string, number>,
  wins: Map<string, number>,
  losses: Map<string, number>,
): Map<string, Standing> {
  const rows = players
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      rating: rating.get(p.id)!,
      wins: wins.get(p.id)!,
      losses: losses.get(p.id)!,
      rank: 0,
    }))
    // Highest rating first; equal ratings fall back to the name so the order
    // does not wander between reloads.
    .sort((a, b) => (b.rating === a.rating ? a.name.localeCompare(b.name) : b.rating - a.rating));

  const out = new Map<string, Standing>();
  rows.forEach((row, i) => {
    // Order is by true rating, but the rank number groups by the rating people
    // can actually see: two players a tenth of a point apart both read 1001,
    // and showing them as 2nd and 3rd looks like a fault rather than a margin.
    // The next distinct rating skips the ranks used up, as ordinals should.
    const previous = rows[i - 1];
    const tied = previous && forDisplay(previous.rating) === forDisplay(row.rating);
    row.rank = tied ? out.get(previous.playerId)!.rank : i + 1;
    out.set(row.playerId, row);
  });
  return out;
}

/** Ratings are kept at full precision and only rounded to be shown. */
export function forDisplay(rating: number): number {
  return Math.round(rating);
}

/** A signed whole number, e.g. "+16" or "-16". */
export function formatDelta(delta: number): string {
  const rounded = Math.round(delta);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

/** Wins as a percentage of games played, or null when none have been. */
export function winPercent(wins: number, losses: number): number | null {
  const played = wins + losses;
  return played === 0 ? null : (wins / played) * 100;
}

export interface HeadToHead {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
}

/** A player's record against each opponent they have actually played. */
export function headToHead(snapshot: EloSnapshot, playerId: string): HeadToHead[] {
  const names = new Map(snapshot.players.map((p) => [p.id, p.name]));
  const tally = new Map<string, HeadToHead>();

  const row = (id: string): HeadToHead => {
    let found = tally.get(id);
    if (!found) {
      found = { opponentId: id, opponentName: names.get(id) ?? 'Unknown', wins: 0, losses: 0 };
      tally.set(id, found);
    }
    return found;
  };

  for (const game of snapshot.games.filter(isLive)) {
    if (game.winnerId === playerId) {
      for (const loserId of game.loserIds) row(loserId).wins += 1;
    } else if (game.loserIds.includes(playerId)) {
      row(game.winnerId).losses += 1;
    }
  }

  return [...tally.values()].sort((a, b) => a.opponentName.localeCompare(b.opponentName));
}

/** Whether a name is free. Case-insensitive, and ignores deleted players. */
export function nameIsTaken(players: readonly Player[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return players.filter(isLive).some((p) => p.name.trim().toLowerCase() === wanted);
}

/** A player may only be deleted once they have no live games. */
export function liveGameCount(snapshot: EloSnapshot, playerId: string): number {
  return snapshot.games.filter(
    (g) => isLive(g) && (g.winnerId === playerId || g.loserIds.includes(playerId)),
  ).length;
}
