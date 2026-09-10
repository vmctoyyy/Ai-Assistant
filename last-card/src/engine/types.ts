/**
 * Last Card — core types.
 *
 * Nothing in /src/engine may import React, touch the DOM, read the clock or
 * call Math.random. Phase 2 runs this same code on a server to validate moves,
 * so every transition has to be pure and reproducible from (state, move).
 */

export type Suit = 'H' | 'D' | 'C' | 'S';

export const SUITS: readonly Suit[] = ['H', 'D', 'C', 'S'];

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8'
  | '9' | '10' | 'J' | 'Q' | 'K' | 'JOKER';

/** Ranks that appear in a standard 52-card deck, in dealing order. */
export const STANDARD_RANKS: readonly Rank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

/** A physical card. `suit` is null only for jokers. */
export interface Card {
  /** Unique per physical card, so duplicates across decks stay distinguishable. */
  id: string;
  rank: Rank;
  suit: Suit | null;
  /** 1-based deck this card came from. */
  deck: number;
}

/** A card as it sits on the discard pile, with any nomination made when it was played. */
export interface PlayedCard {
  card: Card;
  /** For a joker: the card it was nominated to represent. */
  as?: { rank: Rank; suit: Suit };
  /** For an ace played as a suit change. */
  calledSuit?: Suit;
  playedBy: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  /** Hand is one card, or a set of identical-rank cards, so "Last Card!" is available. */
  lastCardEligible: boolean;
  lastCardCalled: boolean;
  /** Became eligible but the next player moved before the call landed. */
  lastCardMissed: boolean;
}

export interface GameConfig {
  /** 1 or 2 standard decks. Two decks (108 cards with jokers) is the default. */
  deckCount: 1 | 2;
  /** Jokers added per deck. */
  jokersPerDeck: number;
  handSize: number;
  /** Nuclear pick-up ceiling. */
  maxPickup: number;
  /** Default penalty amount; negotiable, hence editable in the UI. */
  defaultPenalty: number;
  /** Cards picked up when a win is blocked by a missed "Last Card" call. */
  missedLastCardPenalty: number;
  /** Cards the beaten winner picks up when a jump-out reopens the game. */
  jumpOutPenalty: number;
  /** Identical-rank cards that trigger the instant "8s" win. */
  eightsWinCount: number;
  /**
   * Whether a plain suit/rank-matching card may be played during an active
   * pick-up. Off by default — see the ambiguities section of the README.
   */
  allowPlainCardDuringPickup: boolean;
  /** UI-only windows, kept on config so both surfaces agree. */
  jumpOutWindowMs: number;
  lastCardWindowMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  deckCount: 2,
  jokersPerDeck: 2,
  handSize: 7,
  maxPickup: 25,
  defaultPenalty: 2,
  missedLastCardPenalty: 1,
  jumpOutPenalty: 1,
  eightsWinCount: 8,
  allowPlainCardDuringPickup: false,
  jumpOutWindowMs: 3000,
  lastCardWindowMs: 3000,
};

export type Phase =
  /** Normal play. */
  | 'playing'
  /** A card was drawn in normal play and may be played straight away (Pick and Play). */
  | 'awaitingDrawChoice'
  /** Someone has won. A jump-out may still reopen it while `jumpOutOpen` is true. */
  | 'finished';

export interface PendingPenalty {
  byPlayerId: string;
  targetPlayerId: string;
  reason: string;
  amount: number;
}

export interface LogEntry {
  seq: number;
  playerId: string | null;
  text: string;
}

export interface GameState {
  config: GameConfig;
  players: Player[];
  drawPile: Card[];
  /** Last element is the top card. */
  discardPile: PlayedCard[];
  /** Suit that must currently be matched (may differ from the top card's own suit). */
  activeSuit: Suit;
  /** Rank that must currently be matched. */
  activeRank: Rank;
  currentPlayerIndex: number;
  /** 1 = clockwise through `players`, -1 = anticlockwise. */
  direction: 1 | -1;
  /** Running pick-up chain. 0 when no chain is active. */
  pickupCount: number;
  /** True once the chain has hit `config.maxPickup`. */
  nuclear: boolean;
  phase: Phase;
  pendingDraw: { playerId: string; cardId: string } | null;
  pendingPenalty: PendingPenalty | null;
  winnerId: string | null;
  /** True during the jump-out window that follows a win. */
  jumpOutOpen: boolean;
  /** Seeded RNG state; every shuffle advances it. */
  seed: number;
  log: LogEntry[];
  moveCount: number;
}

export type Move =
  | {
      kind: 'play';
      playerId: string;
      cards: Card[];
      /** Suit nominated by an ace. */
      calledSuit?: Suit;
      /** Card nominated by a joker. */
      calledCard?: { rank: Rank; suit: Suit };
    }
  | { kind: 'draw'; playerId: string }
  | {
      kind: 'playDrawnCard';
      playerId: string;
      card: Card;
      calledSuit?: Suit;
      calledCard?: { rank: Rank; suit: Suit };
    }
  /** Decline to play a card drawn in normal play, ending the turn. */
  | { kind: 'pass'; playerId: string }
  | { kind: 'callLastCard'; playerId: string }
  | {
      kind: 'jumpIn';
      playerId: string;
      cards: Card[];
      calledSuit?: Suit;
      calledCard?: { rank: Rank; suit: Suit };
    }
  | { kind: 'declareEights'; playerId: string }
  /** Proposes a penalty. It does not apply until confirmed. */
  | { kind: 'penalty'; playerId: string; targetPlayerId: string; reason: string; amount: number }
  | { kind: 'confirmPenalty'; playerId: string }
  | { kind: 'declinePenalty'; playerId: string }
  /** Closes the jump-out window, making a win final. */
  | { kind: 'closeJumpOut' };

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}
