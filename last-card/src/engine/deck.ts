import type { Card, GameConfig, Rank, Suit } from './types';
import { STANDARD_RANKS, SUITS } from './types';

/**
 * Seeded RNG (mulberry32). The engine never calls Math.random — the seed lives
 * on GameState so a game replays identically from its move list.
 */
export interface Rng {
  next(): number;
  readonly state: number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return a;
    },
  };
}

/** Fisher–Yates. Returns a new array plus the advanced seed. */
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const rng = makeRng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { items: out, seed: rng.state };
}

/**
 * Builds the deck. Two decks plus two jokers each is 108 cards, which is what
 * makes duplicate cards (and therefore jump-ins and the 8s rule) meaningful.
 */
export function createDeck(config: Pick<GameConfig, 'deckCount' | 'jokersPerDeck'>): Card[] {
  const cards: Card[] = [];
  for (let deck = 1; deck <= config.deckCount; deck++) {
    for (const suit of SUITS) {
      for (const rank of STANDARD_RANKS) {
        cards.push({ id: `${deck}-${rank}${suit}`, rank, suit, deck });
      }
    }
    for (let j = 0; j < config.jokersPerDeck; j++) {
      cards.push({ id: `${deck}-JOKER${j + 1}`, rank: 'JOKER', suit: null, deck });
    }
  }
  return cards;
}

const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<Suit, string> = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOL[suit];
}

export function suitName(suit: Suit): string {
  return SUIT_NAME[suit];
}

export function isRed(suit: Suit | null): boolean {
  return suit === 'H' || suit === 'D';
}

export function cardLabel(card: { rank: Rank; suit: Suit | null }): string {
  if (card.rank === 'JOKER') return 'Joker';
  return `${card.rank}${suitSymbol(card.suit as Suit)}`;
}

/** The one-eyed king: the king of diamonds, playable at any time. */
export function isOneEyedKing(card: { rank: Rank; suit: Suit | null }): boolean {
  return card.rank === 'K' && card.suit === 'D';
}

/**
 * Power cards, for the "you may not win on a power card" rule. A regular king
 * has no effect and is not a power card; the one-eyed king is.
 */
export function isPowerCard(card: { rank: Rank; suit: Suit | null }): boolean {
  if (isOneEyedKing(card)) return true;
  return ['A', '2', '5', '7', '10', 'J', 'JOKER'].includes(card.rank);
}

/** Ranks that may be played on any suit while a pick-up chain is running. */
export const CHAIN_RANKS: readonly Rank[] = ['2', '5', '7', '10', 'J'];
