/**
 * Test-only helpers for building precise game states. Kept out of the UI bundle
 * by never being imported from /src/ui.
 */

import {
  DEFAULT_CONFIG,
  type Card,
  type GameConfig,
  type GameState,
  type PlayedCard,
  type Player,
  type Rank,
  type Suit,
} from './types';
import type { Move } from './types';
import { applyMove, isLastCardHand } from './rules';

/**
 * Parses a card spec: "4H", "10D", "KD", "JOKER". A trailing apostrophe means
 * the copy from the second deck — "4D'" is the other four of diamonds.
 */
export function c(spec: string): Card {
  let deck = 1;
  let s = spec;
  if (s.endsWith("'")) {
    deck = 2;
    s = s.slice(0, -1);
  }
  if (s === 'JOKER') return { id: `${deck}-JOKER1`, rank: 'JOKER', suit: null, deck };
  const suit = s.slice(-1) as Suit;
  const rank = s.slice(0, -1) as Rank;
  return { id: `${deck}-${rank}${suit}`, rank, suit, deck };
}

export function cards(...specs: string[]): Card[] {
  return specs.map(c);
}

export interface ScenarioOptions {
  players?: string[];
  /** Player id -> card specs. Ids are p1, p2, ... in order. */
  hands?: Record<string, string[]>;
  /** Discard pile, bottom first. Defaults to a single starter. */
  pile?: string[];
  activeSuit?: Suit;
  activeRank?: Rank;
  pickup?: number;
  current?: number;
  direction?: 1 | -1;
  /** Draw pile, bottom first — the last entry is drawn next. */
  drawPile?: string[];
  config?: Partial<GameConfig>;
}

export function scenario(opts: ScenarioOptions = {}): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const names = opts.players ?? ['Ana', 'Ben'];

  const players: Player[] = names.map((name, i) => {
    const id = `p${i + 1}`;
    const hand = (opts.hands?.[id] ?? []).map(c);
    return {
      id,
      name,
      hand,
      lastCardEligible: isLastCardHand(hand),
      lastCardCalled: false,
      lastCardMissed: false,
    };
  });

  const pileSpecs = opts.pile ?? ['8H'];
  const discardPile: PlayedCard[] = pileSpecs.map((spec) => ({
    card: c(spec),
    playedBy: 'dealer',
  }));
  const top = discardPile[discardPile.length - 1].card;

  return {
    config,
    players,
    drawPile: (opts.drawPile ?? []).map(c),
    discardPile,
    activeSuit: opts.activeSuit ?? (top.suit as Suit),
    activeRank: opts.activeRank ?? top.rank,
    currentPlayerIndex: opts.current ?? 0,
    direction: opts.direction ?? 1,
    pickupCount: opts.pickup ?? 0,
    nuclear: (opts.pickup ?? 0) >= config.maxPickup,
    phase: 'playing',
    pendingDraw: null,
    pendingPenalty: null,
    winnerId: null,
    jumpOutOpen: false,
    seed: 12345,
    log: [],
    moveCount: 0,
  };
}

/** Adds a card to whoever's turn it is, then plays it. Used to script sequences. */
export function giveAndPlay(
  state: GameState,
  spec: string,
  extra: { calledSuit?: Suit; calledCard?: { rank: Rank; suit: Suit } } = {},
): GameState {
  const cur = state.players[state.currentPlayerIndex];
  const card = c(spec);
  const seeded: GameState = {
    ...state,
    players: state.players.map((p) => (p.id === cur.id ? { ...p, hand: [...p.hand, card] } : p)),
  };
  const move: Move = { kind: 'play', playerId: cur.id, cards: [card], ...extra };
  return applyMove(seeded, move);
}
