/**
 * Per-player views.
 *
 * Pass-and-play could hand the whole GameState to the one screen, because the
 * screen was the privacy boundary. Over a network it is not: whatever reaches a
 * device is readable by whoever owns it, so the server must send each player
 * only what they are entitled to know.
 *
 * Three things leak if this is done carelessly, and only one of them is
 * obvious:
 *   - other players' hands
 *   - the draw pile, whose *order* is the next several draws
 *   - the RNG seed, which is every future shuffle
 *
 * Pure, like the rest of the engine, and tested by serialising a view and
 * looking for cards that should not be in it.
 */

import type {
  Card,
  GameConfig,
  GameState,
  LogEntry,
  PendingPenalty,
  Phase,
  PlayedCard,
  Rank,
  Suit,
} from './types';
import { isLastCardHand } from './rules';

/** What everyone may know about a player. */
export interface PlayerSummary {
  id: string;
  name: string;
  handCount: number;
  lastCardEligible: boolean;
  lastCardCalled: boolean;
  lastCardMissed: boolean;
  /** Whether it is this player's turn. */
  isTurn: boolean;
}

/** The whole of what one device is sent. */
export interface PlayerView {
  config: GameConfig;
  /** The viewer, with their own hand. */
  you: {
    id: string;
    name: string;
    hand: Card[];
    lastCardEligible: boolean;
    lastCardCalled: boolean;
    lastCardMissed: boolean;
  };
  players: PlayerSummary[];
  currentPlayerId: string;
  yourTurn: boolean;
  direction: 1 | -1;
  /** Counts only. The order of the draw pile is the next several draws. */
  drawCount: number;
  discardCount: number;
  /** Only the face-up card, not the pile beneath it. */
  discardTop: PlayedCard | null;
  activeSuit: Suit;
  activeRank: Rank;
  pickupCount: number;
  nuclear: boolean;
  phase: Phase;
  /** The drawn card is named only to the player who drew it. */
  pendingDraw: { playerId: string; card: Card | null } | null;
  pendingPenalty: PendingPenalty | null;
  winnerId: string | null;
  jumpOutOpen: boolean;
  /** Cards in the viewer's hand that exactly match the top of the pile. */
  jumpInCards: Card[];
  log: LogEntry[];
  moveCount: number;
}

function summarise(state: GameState, index: number): PlayerSummary {
  const p = state.players[index];
  return {
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    // Derived rather than copied: a player's own flag can be stale between a
    // hand changing and the next refresh, and other devices must not see that.
    lastCardEligible: p.lastCardEligible && isLastCardHand(p.hand),
    lastCardCalled: p.lastCardCalled,
    lastCardMissed: p.lastCardMissed,
    isTurn: index === state.currentPlayerIndex,
  };
}

/**
 * The view sent to `playerId`. Everything omitted here is omitted on purpose —
 * adding a field back means deciding it is public.
 */
export function viewFor(state: GameState, playerId: string): PlayerView {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`Unknown player "${playerId}"`);

  const top = state.discardPile.length
    ? state.discardPile[state.discardPile.length - 1]
    : null;

  let pendingDraw: PlayerView['pendingDraw'] = null;
  if (state.pendingDraw) {
    const mine = state.pendingDraw.playerId === playerId;
    pendingDraw = {
      playerId: state.pendingDraw.playerId,
      card: mine ? me.hand.find((c) => c.id === state.pendingDraw!.cardId) ?? null : null,
    };
  }

  return {
    config: state.config,
    you: {
      id: me.id,
      name: me.name,
      hand: me.hand.slice(),
      lastCardEligible: me.lastCardEligible,
      lastCardCalled: me.lastCardCalled,
      lastCardMissed: me.lastCardMissed,
    },
    players: state.players.map((_, i) => summarise(state, i)),
    currentPlayerId: state.players[state.currentPlayerIndex].id,
    yourTurn: state.players[state.currentPlayerIndex].id === playerId,
    direction: state.direction,
    drawCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    discardTop: top ? { ...top } : null,
    activeSuit: state.activeSuit,
    activeRank: state.activeRank,
    pickupCount: state.pickupCount,
    nuclear: state.nuclear,
    phase: state.phase,
    pendingDraw,
    pendingPenalty: state.pendingPenalty ? { ...state.pendingPenalty } : null,
    winnerId: state.winnerId,
    jumpOutOpen: state.jumpOutOpen,
    jumpInCards: top
      ? me.hand.filter((c) => c.rank === top.card.rank && c.suit === top.card.suit)
      : [],
    log: state.log.slice(),
    moveCount: state.moveCount,
  };
}

/**
 * Every card id a given player must not be able to see. Used by the tests, and
 * cheap enough to assert against in the server's own checks.
 */
export function hiddenFrom(state: GameState, playerId: string): string[] {
  const ids: string[] = [];
  for (const p of state.players) {
    if (p.id === playerId) continue;
    for (const card of p.hand) ids.push(card.id);
  }
  for (const card of state.drawPile) ids.push(card.id);
  return ids;
}
