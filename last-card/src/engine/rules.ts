/**
 * Last Card — rules engine.
 *
 * Pure functions over an immutable GameState. `applyMove` deep-copies the parts
 * it touches and returns a new state; the input is never mutated.
 */

import {
  DEFAULT_CONFIG,
  IllegalMoveError,
  type Card,
  type GameConfig,
  type GameState,
  type LogEntry,
  type Move,
  type PlayedCard,
  type Player,
  type Rank,
  type Suit,
} from './types';
import {
  CHAIN_RANKS,
  cardLabel,
  createDeck,
  isOneEyedKing,
  isPowerCard,
  shuffle,
  suitName,
} from './deck';

/** A card's identity for matching purposes: rank plus suit, ignoring which deck it came from. */
export interface CardFace {
  rank: Rank;
  suit: Suit | null;
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function playerById(state: GameState, playerId: string): Player | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function topCard(state: GameState): PlayedCard | undefined {
  return state.discardPile[state.discardPile.length - 1];
}

export function isPickupActive(state: GameState): boolean {
  return state.pickupCount > 0;
}

/** Same rank and same suit — the jump-in test. Two 4♦ from different decks match. */
export function sameFace(a: CardFace, b: CardFace): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** What a card counts as: its own face, or a joker's nomination. */
export function faceOf(card: Card, calledCard?: { rank: Rank; suit: Suit }): CardFace {
  if (card.rank === 'JOKER' && calledCard) return { rank: calledCard.rank, suit: calledCard.suit };
  return { rank: card.rank, suit: card.suit };
}

function requirePlayer(state: GameState, playerId: string): Player {
  const p = playerById(state, playerId);
  if (!p) throw new IllegalMoveError(`Unknown player "${playerId}"`);
  return p;
}

function indexOfPlayer(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.id === playerId);
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

export interface Playability {
  ok: boolean;
  reason?: string;
}

const OK: Playability = { ok: true };

/**
 * Whether a single card may be led onto the pile right now.
 *
 * Wilds (ace, joker) and the one-eyed king of diamonds are playable at any
 * time. While a pick-up chain is running, 2s, 5s, 7s, 10s and jacks may be
 * played on any suit; everything else has to wait for the chain to resolve.
 */
export function cardPlayability(
  state: GameState,
  card: Card,
  calledCard?: { rank: Rank; suit: Suit },
): Playability {
  const face = faceOf(card, calledCard);

  // Wilds and the one-eyed king ignore the pile entirely.
  if (card.rank === 'JOKER') return OK;
  if (card.rank === 'A') return OK;
  if (isOneEyedKing(face) || isOneEyedKing(card)) return OK;

  const matches = face.suit === state.activeSuit || face.rank === state.activeRank;

  if (isPickupActive(state)) {
    if (CHAIN_RANKS.includes(face.rank)) return OK;
    if (state.config.allowPlainCardDuringPickup && matches) return OK;
    return {
      ok: false,
      reason:
        `A pick-up of ${state.pickupCount} is running. Play a 2, 5, 7, 10, jack, ace, ` +
        `joker or the one-eyed K♦ — or pick up.`,
    };
  }

  if (matches) return OK;
  return {
    ok: false,
    reason: `${cardLabel(card)} does not match ${state.activeRank} or ${suitName(state.activeSuit)}.`,
  };
}

export function isCardPlayable(state: GameState, card: Card): boolean {
  // A joker's nomination cannot make it illegal, so probing without one is safe.
  return cardPlayability(state, card).ok;
}

/** Cards in a hand that share an effective rank with the given card. */
export function sameRankGroup(hand: Card[], card: Card): Card[] {
  return hand.filter((c) => c.rank === card.rank);
}

function hasEights(state: GameState, player: Player): Rank | null {
  const counts = new Map<Rank, number>();
  for (const c of player.hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  for (const [rank, n] of counts) {
    if (n >= state.config.eightsWinCount) return rank;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Draft helpers (used only inside applyMove, on a private copy)
// ---------------------------------------------------------------------------

function draft(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: p.hand.slice() })),
    drawPile: state.drawPile.slice(),
    discardPile: state.discardPile.slice(),
    log: state.log.slice(),
    pendingDraw: state.pendingDraw ? { ...state.pendingDraw } : null,
    pendingPenalty: state.pendingPenalty ? { ...state.pendingPenalty } : null,
  };
}

function log(s: GameState, playerId: string | null, text: string): void {
  const entry: LogEntry = { seq: s.log.length, playerId, text };
  s.log.push(entry);
}

function resetLastCard(p: Player): void {
  p.lastCardEligible = false;
  p.lastCardCalled = false;
  p.lastCardMissed = false;
}

/** A hand of one card, or of identical-rank cards, is a Last Card hand. */
export function isLastCardHand(hand: readonly Card[]): boolean {
  return hand.length > 0 && hand.every((c) => c.rank === hand[0].rank);
}

function refreshEligibility(p: Player): void {
  const eligible = isLastCardHand(p.hand);
  if (!eligible) {
    p.lastCardEligible = false;
    p.lastCardCalled = false;
  } else {
    p.lastCardEligible = true;
  }
}

/** Reshuffles the discards (all but the top card) back into the draw pile. */
function replenish(s: GameState): void {
  if (s.discardPile.length <= 1) return;
  const top = s.discardPile[s.discardPile.length - 1];
  const rest = s.discardPile.slice(0, -1).map((pc) => pc.card);
  const { items, seed } = shuffle(rest, s.seed);
  s.drawPile = items;
  s.discardPile = [top];
  s.seed = seed;
  log(s, null, `Draw pile ran out; ${items.length} discards were shuffled back in`);
}

function drawCards(s: GameState, playerId: string, n: number): Card[] {
  const p = requirePlayer(s, playerId);
  const taken: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (s.drawPile.length === 0) replenish(s);
    if (s.drawPile.length === 0) break; // every card is in someone's hand
    taken.push(s.drawPile.pop()!);
  }
  if (taken.length > 0) {
    p.hand = p.hand.concat(taken);
    resetLastCard(p);
  }
  return taken;
}

function addPickup(s: GameState, amount: number): void {
  s.pickupCount = Math.min(s.config.maxPickup, s.pickupCount + amount);
  if (s.pickupCount >= s.config.maxPickup) s.nuclear = true;
}

function clearPickup(s: GameState): void {
  s.pickupCount = 0;
  s.nuclear = false;
}

function stepIndex(s: GameState, from: number, steps: number): number {
  const n = s.players.length;
  return (((from + s.direction * steps) % n) + n) % n;
}

function advanceFrom(s: GameState, fromIndex: number, extraSkips: number): void {
  s.currentPlayerIndex = stepIndex(s, fromIndex, 1 + extraSkips);
}

/**
 * "You must call before the next player plays." Any turn action by somebody
 * else shuts the window on an eligible player who has not called.
 */
const WINDOW_CLOSING_MOVES: ReadonlySet<Move['kind']> = new Set([
  'play',
  'draw',
  'playDrawnCard',
  'pass',
  'jumpIn',
]);

function closeLastCardWindow(s: GameState, moverId: string): void {
  for (const p of s.players) {
    if (p.id === moverId) continue;
    if (p.lastCardEligible && !p.lastCardCalled) {
      p.lastCardEligible = false;
      p.lastCardMissed = true;
      log(s, p.id, `${p.name} did not call Last Card in time`);
    }
  }
}

function declareWin(s: GameState, playerId: string, jumpOutable: boolean, text: string): void {
  const p = requirePlayer(s, playerId);
  s.phase = 'finished';
  s.winnerId = playerId;
  s.jumpOutOpen = jumpOutable;
  s.pendingDraw = null;
  log(s, playerId, `${p.name} ${text}`);
}

function checkEights(s: GameState): void {
  if (s.phase === 'finished') return;
  for (const p of s.players) {
    const rank = hasEights(s, p);
    if (rank) {
      declareWin(s, p.id, false, `wins instantly with ${s.config.eightsWinCount} ${rank}s`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Playing cards
// ---------------------------------------------------------------------------

interface PlayOptions {
  /** Pick and Play: a card drawn this turn. It may never be the winning card. */
  isPickAndPlay?: boolean;
  /** A jump-in: the lead card must exactly match the top card, turn order does not apply. */
  isJumpIn?: boolean;
}

function performPlay(
  s: GameState,
  playerId: string,
  cards: Card[],
  calledSuit: Suit | undefined,
  calledCard: { rank: Rank; suit: Suit } | undefined,
  opts: PlayOptions = {},
): void {
  const p = requirePlayer(s, playerId);

  if (cards.length === 0) throw new IllegalMoveError('No cards were played.');

  // Every card must actually be in the hand, and named only once.
  const seen = new Set<string>();
  const played: Card[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) throw new IllegalMoveError(`${cardLabel(c)} was played twice in one move.`);
    seen.add(c.id);
    const held = p.hand.find((h) => h.id === c.id);
    if (!held) throw new IllegalMoveError(`${p.name} is not holding ${cardLabel(c)}.`);
    played.push(held);
  }

  if (played.some((c) => c.rank === 'JOKER') && !calledCard) {
    throw new IllegalMoveError('A joker must be nominated as a specific card.');
  }

  const faces = played.map((c) => faceOf(c, calledCard));

  // Multi-card plays must be a single rank. A joker counts as whatever it was
  // nominated as, so a joker called as 2♦ may join a pair of 2s.
  const groupRank = faces[0].rank;
  if (faces.some((f) => f.rank !== groupRank)) {
    throw new IllegalMoveError('Multiple cards may only be played together if they share a rank.');
  }

  const chainWasActive = isPickupActive(s);

  if (played.some((c) => c.rank === 'A') && !chainWasActive && !calledSuit) {
    throw new IllegalMoveError('An ace must nominate a suit.');
  }

  // Lead-card legality.
  if (opts.isJumpIn) {
    const top = topCard(s);
    if (!top) throw new IllegalMoveError('There is nothing to jump in on.');
    if (!sameFace({ rank: played[0].rank, suit: played[0].suit }, { rank: top.card.rank, suit: top.card.suit })) {
      throw new IllegalMoveError(
        `A jump-in needs the exact same card. The top card is ${cardLabel(top.card)}.`,
      );
    }
  } else {
    const lead = cardPlayability(s, played[0], calledCard);
    if (!lead.ok) throw new IllegalMoveError(lead.reason!);
  }

  // Win checks, before anything is committed.
  const emptiesHand = played.length === p.hand.length;
  let blockedWin = false;
  if (emptiesHand) {
    if (opts.isPickAndPlay) {
      throw new IllegalMoveError(
        'You cannot Pick and Play to win — the winning hand must be played on your next turn.',
      );
    }
    const power = played.find((c, i) => isPowerCard(c) || isPowerCard(faces[i]));
    if (power) {
      throw new IllegalMoveError(`You may not win on a power card (${cardLabel(power)}).`);
    }
    if (!p.lastCardCalled) {
      blockedWin = true;
    }
  }

  // The one-eyed king takes the card underneath it in return.
  const oneEyed = faces.some(isOneEyedKing) || played.some(isOneEyedKing);
  let underneath: PlayedCard | undefined;
  if (oneEyed) underneath = s.discardPile.pop();

  // Commit the cards.
  p.hand = p.hand.filter((h) => !seen.has(h.id));
  for (const card of played) {
    const entry: PlayedCard = { card, playedBy: playerId };
    if (card.rank === 'JOKER' && calledCard) entry.as = calledCard;
    if (card.rank === 'A' && !chainWasActive && calledSuit) entry.calledSuit = calledSuit;
    s.discardPile.push(entry);
  }

  const names = played.map(cardLabel).join(' + ');
  log(s, playerId, `${p.name} played ${names}${opts.isJumpIn ? ' (jump-in)' : ''}`);

  // Effects. Every card in the group shares a rank, so this runs once for the group.
  let extraSkips = 0;
  let aceStopped = false;
  const n = played.length;

  switch (groupRank) {
    case '2':
      addPickup(s, 2 * n);
      log(s, playerId, `Pick-up is now ${s.pickupCount}${s.nuclear ? ' — nuclear' : ''}`);
      break;
    case '5':
      addPickup(s, 5 * n);
      log(s, playerId, `Pick-up is now ${s.pickupCount}${s.nuclear ? ' — nuclear' : ''}`);
      break;
    case '7':
      if (chainWasActive) {
        clearPickup(s);
        log(s, playerId, 'The pick-up was blocked; play continues from the 7');
      }
      break;
    case '10':
      if (chainWasActive) {
        log(s, playerId, `Skipped the pick-up; ${s.pickupCount} passes to the next player`);
      } else {
        extraSkips = n;
      }
      break;
    case 'J':
      if (s.players.length === 2) {
        extraSkips = n; // direction is meaningless heads-up, so a jack skips
      } else if (n % 2 === 1) {
        s.direction = (s.direction === 1 ? -1 : 1) as 1 | -1;
        log(s, playerId, 'Direction reversed');
      }
      break;
    case 'A':
      if (chainWasActive) {
        clearPickup(s);
        aceStopped = true;
        log(s, playerId, 'The ace stopped the pick-up and keeps its own suit');
      }
      break;
    case 'K':
      if (oneEyed && chainWasActive) {
        clearPickup(s);
        log(s, playerId, 'The one-eyed king blocked the pick-up');
      }
      break;
    default:
      break;
  }

  // New matching target, taken from the last card of the group.
  const lastCard = played[n - 1];
  if (lastCard.rank === 'JOKER' && calledCard) {
    s.activeRank = calledCard.rank;
    s.activeSuit = calledCard.suit;
    log(s, playerId, `Joker called as ${cardLabel(calledCard)}`);
  } else if (lastCard.rank === 'A') {
    s.activeRank = 'A';
    if (aceStopped) {
      s.activeSuit = lastCard.suit as Suit;
    } else {
      s.activeSuit = calledSuit as Suit;
      log(s, playerId, `Suit called: ${suitName(s.activeSuit)}`);
    }
  } else {
    s.activeRank = lastCard.rank;
    s.activeSuit = lastCard.suit as Suit;
  }

  // The one-eyed king's forced pick-up happens after the pile settles.
  if (oneEyed && underneath) {
    p.hand = p.hand.concat(underneath.card);
    resetLastCard(p);
    log(s, playerId, `${p.name} picked up ${cardLabel(underneath.card)} from under the king`);
  }

  refreshEligibility(p);

  const fromIndex = indexOfPlayer(s, playerId);

  if (p.hand.length === 0) {
    if (blockedWin) {
      log(s, playerId, `${p.name} played out but never called Last Card — the win does not count`);
      drawCards(s, playerId, s.config.missedLastCardPenalty);
      refreshEligibility(p);
      advanceFrom(s, fromIndex, extraSkips);
      return;
    }
    declareWin(s, playerId, true, 'went out');
    return;
  }

  advanceFrom(s, fromIndex, extraSkips);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createGame(
  playerNames: string[],
  configOverrides: Partial<GameConfig> = {},
  seed = 1,
): GameState {
  if (playerNames.length < 2 || playerNames.length > 6) {
    throw new IllegalMoveError('Last Card needs between 2 and 6 players.');
  }
  const config: GameConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  const { items: shuffled, seed: nextSeed } = shuffle(createDeck(config), seed);
  const drawPile = shuffled;

  const players: Player[] = playerNames.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    hand: [],
    lastCardEligible: false,
    lastCardCalled: false,
    lastCardMissed: false,
  }));

  for (let round = 0; round < config.handSize; round++) {
    for (const p of players) p.hand.push(drawPile.pop()!);
  }

  // Turn over a starter. Power cards would need somebody to resolve them before
  // the first turn, so keep going until a plain card shows up.
  let starter = drawPile.pop()!;
  const rejected: Card[] = [];
  while (isPowerCard(starter) && drawPile.length > 0) {
    rejected.push(starter);
    starter = drawPile.pop()!;
  }
  const reshuffled = shuffle(drawPile.concat(rejected), nextSeed);

  const state: GameState = {
    config,
    players,
    drawPile: reshuffled.items,
    discardPile: [{ card: starter, playedBy: 'dealer' }],
    activeSuit: starter.suit as Suit,
    activeRank: starter.rank,
    currentPlayerIndex: 0,
    direction: 1,
    pickupCount: 0,
    nuclear: false,
    phase: 'playing',
    pendingDraw: null,
    pendingPenalty: null,
    winnerId: null,
    jumpOutOpen: false,
    seed: reshuffled.seed,
    log: [],
    moveCount: 0,
  };

  log(state, null, `Dealt ${config.handSize} cards each. Starter: ${cardLabel(starter)}`);
  for (const p of state.players) refreshEligibility(p);
  return state;
}

// ---------------------------------------------------------------------------
// legalMoves
// ---------------------------------------------------------------------------

/**
 * Moves available to `playerId` right now.
 *
 * These are templates: `play`, `playDrawnCard` and `jumpIn` moves involving an
 * ace or a joker come back without a nomination, and the caller must fill in
 * `calledSuit` / `calledCard` before passing them to `applyMove`.
 */
export function legalMoves(state: GameState, playerId: string): Move[] {
  const p = playerById(state, playerId);
  if (!p) return [];
  const moves: Move[] = [];

  // A proposed penalty is settled before anything else happens.
  if (state.pendingPenalty) {
    moves.push({ kind: 'confirmPenalty', playerId }, { kind: 'declinePenalty', playerId });
    return moves;
  }

  if (state.phase === 'finished') {
    if (state.jumpOutOpen) {
      for (const card of jumpInCards(state, playerId)) {
        moves.push({ kind: 'jumpIn', playerId, cards: [card] });
      }
      moves.push({ kind: 'closeJumpOut' });
    }
    return moves;
  }

  if (hasEights(state, p)) moves.push({ kind: 'declareEights', playerId });

  if (p.lastCardEligible && !p.lastCardCalled && !p.lastCardMissed) {
    moves.push({ kind: 'callLastCard', playerId });
  }

  for (const card of jumpInCards(state, playerId)) {
    moves.push({ kind: 'jumpIn', playerId, cards: [card] });
  }

  moves.push({
    kind: 'penalty',
    playerId,
    targetPlayerId: '',
    reason: '',
    amount: state.config.defaultPenalty,
  });

  const isTurn = currentPlayer(state).id === playerId;
  if (!isTurn) return moves;

  if (state.phase === 'awaitingDrawChoice') {
    if (state.pendingDraw && state.pendingDraw.playerId === playerId) {
      const card = p.hand.find((c) => c.id === state.pendingDraw!.cardId);
      if (card && isCardPlayable(state, card)) {
        moves.push({ kind: 'playDrawnCard', playerId, card });
      }
      moves.push({ kind: 'pass', playerId });
    }
    return moves;
  }

  const seenRanks = new Set<Rank>();
  for (const card of p.hand) {
    if (!isCardPlayable(state, card)) continue;
    moves.push({ kind: 'play', playerId, cards: [card] });
    if (!seenRanks.has(card.rank)) {
      seenRanks.add(card.rank);
      const group = sameRankGroup(p.hand, card);
      if (group.length > 1) {
        // Lead with the legal card so the group is accepted as played.
        const ordered = [card, ...group.filter((c) => c.id !== card.id)];
        moves.push({ kind: 'play', playerId, cards: ordered });
      }
    }
  }

  moves.push({ kind: 'draw', playerId });
  return moves;
}

/** Cards in a player's hand that exactly match the top of the pile. */
export function jumpInCards(state: GameState, playerId: string): Card[] {
  const p = playerById(state, playerId);
  const top = topCard(state);
  if (!p || !top) return [];
  return p.hand.filter((c) => sameFace(c, top.card));
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

export function applyMove(state: GameState, move: Move): GameState {
  const s = draft(state);

  // A proposed penalty blocks the game until it is confirmed or dismissed —
  // players always get to defend themselves.
  if (s.pendingPenalty && move.kind !== 'confirmPenalty' && move.kind !== 'declinePenalty') {
    throw new IllegalMoveError('A penalty is waiting to be settled.');
  }

  if (move.kind !== 'closeJumpOut' && 'playerId' in move) {
    requirePlayer(s, move.playerId);
  }

  if (s.phase === 'finished') {
    const allowed = move.kind === 'jumpIn' || move.kind === 'closeJumpOut' || move.kind === 'penalty';
    if (!allowed) throw new IllegalMoveError('The game is over.');
    if (move.kind === 'jumpIn' && !s.jumpOutOpen) {
      throw new IllegalMoveError('The jump-out window has closed.');
    }
  }

  if (WINDOW_CLOSING_MOVES.has(move.kind) && 'playerId' in move) {
    closeLastCardWindow(s, move.playerId);
  }

  switch (move.kind) {
    case 'play': {
      requireTurn(s, move.playerId);
      requirePhase(s, 'playing');
      performPlay(s, move.playerId, move.cards, move.calledSuit, move.calledCard);
      break;
    }

    case 'draw': {
      requireTurn(s, move.playerId);
      requirePhase(s, 'playing');
      const p = requirePlayer(s, move.playerId);
      const fromIndex = indexOfPlayer(s, move.playerId);
      if (isPickupActive(s)) {
        const amount = s.pickupCount;
        const taken = drawCards(s, move.playerId, amount);
        clearPickup(s);
        log(s, move.playerId, `${p.name} picked up ${taken.length}`);
        refreshEligibility(p);
        advanceFrom(s, fromIndex, 0);
      } else {
        const taken = drawCards(s, move.playerId, 1);
        log(s, move.playerId, `${p.name} drew a card`);
        refreshEligibility(p);
        if (taken.length === 1 && isCardPlayable(s, taken[0])) {
          // Pick and Play: the drawn card may go straight down.
          s.phase = 'awaitingDrawChoice';
          s.pendingDraw = { playerId: move.playerId, cardId: taken[0].id };
        } else {
          advanceFrom(s, fromIndex, 0);
        }
      }
      break;
    }

    case 'playDrawnCard': {
      requireTurn(s, move.playerId);
      if (s.phase !== 'awaitingDrawChoice' || s.pendingDraw?.playerId !== move.playerId) {
        throw new IllegalMoveError('There is no drawn card waiting to be played.');
      }
      if (s.pendingDraw.cardId !== move.card.id) {
        throw new IllegalMoveError('Only the card you just drew may be played this way.');
      }
      s.pendingDraw = null;
      s.phase = 'playing';
      performPlay(s, move.playerId, [move.card], move.calledSuit, move.calledCard, {
        isPickAndPlay: true,
      });
      break;
    }

    case 'pass': {
      requireTurn(s, move.playerId);
      if (s.phase !== 'awaitingDrawChoice' || s.pendingDraw?.playerId !== move.playerId) {
        throw new IllegalMoveError('There is nothing to pass on.');
      }
      const p = requirePlayer(s, move.playerId);
      s.pendingDraw = null;
      s.phase = 'playing';
      log(s, move.playerId, `${p.name} kept the drawn card`);
      advanceFrom(s, indexOfPlayer(s, move.playerId), 0);
      break;
    }

    case 'callLastCard': {
      const p = requirePlayer(s, move.playerId);
      if (!p.lastCardEligible) {
        throw new IllegalMoveError('Last Card can only be called with one card, or one set of a kind.');
      }
      if (p.lastCardMissed) throw new IllegalMoveError('That call came too late.');
      p.lastCardCalled = true;
      log(s, move.playerId, `${p.name} called Last Card`);
      break;
    }

    case 'jumpIn': {
      const p = requirePlayer(s, move.playerId);
      if (s.phase === 'finished') {
        // Jump-out: the win is undone and the beaten winner rejoins.
        const beatenId = s.winnerId!;
        const beaten = requirePlayer(s, beatenId);
        s.phase = 'playing';
        s.winnerId = null;
        s.jumpOutOpen = false;
        drawCards(s, beatenId, s.config.jumpOutPenalty);
        refreshEligibility(beaten);
        log(s, move.playerId, `${p.name} jumped out — ${beaten.name}'s win is cancelled`);
      } else if (s.phase === 'awaitingDrawChoice') {
        // A jump-in preempts the drawer's Pick and Play; the drawn card stays put.
        s.pendingDraw = null;
        s.phase = 'playing';
      }
      performPlay(s, move.playerId, move.cards, move.calledSuit, move.calledCard, {
        isJumpIn: true,
      });
      break;
    }

    case 'declareEights': {
      const p = requirePlayer(s, move.playerId);
      const rank = hasEights(s, p);
      if (!rank) {
        throw new IllegalMoveError(
          `${p.name} does not hold ${s.config.eightsWinCount} cards of one rank.`,
        );
      }
      declareWin(s, move.playerId, false, `wins instantly with ${s.config.eightsWinCount} ${rank}s`);
      break;
    }

    case 'penalty': {
      const by = requirePlayer(s, move.playerId);
      const target = requirePlayer(s, move.targetPlayerId);
      if (!Number.isInteger(move.amount) || move.amount < 1) {
        throw new IllegalMoveError('A penalty must be at least one card.');
      }
      if (!move.reason.trim()) throw new IllegalMoveError('A penalty needs a reason.');
      s.pendingPenalty = {
        byPlayerId: move.playerId,
        targetPlayerId: move.targetPlayerId,
        reason: move.reason.trim(),
        amount: move.amount,
      };
      log(
        s,
        move.playerId,
        `${by.name} proposed a ${move.amount}-card penalty on ${target.name}: ${move.reason.trim()}`,
      );
      break;
    }

    case 'confirmPenalty': {
      const pending = s.pendingPenalty;
      if (!pending) throw new IllegalMoveError('No penalty is waiting.');
      const target = requirePlayer(s, pending.targetPlayerId);
      s.pendingPenalty = null;
      const taken = drawCards(s, pending.targetPlayerId, pending.amount);
      refreshEligibility(target);
      log(s, pending.targetPlayerId, `${target.name} picked up ${taken.length}: ${pending.reason}`);
      break;
    }

    case 'declinePenalty': {
      const pending = s.pendingPenalty;
      if (!pending) throw new IllegalMoveError('No penalty is waiting.');
      const target = requirePlayer(s, pending.targetPlayerId);
      s.pendingPenalty = null;
      log(s, pending.targetPlayerId, `The penalty on ${target.name} was dismissed`);
      break;
    }

    case 'closeJumpOut': {
      if (s.phase !== 'finished') throw new IllegalMoveError('Nobody has won yet.');
      s.jumpOutOpen = false;
      log(s, s.winnerId, 'The jump-out window closed');
      break;
    }

    default: {
      const never: never = move;
      throw new IllegalMoveError(`Unknown move ${JSON.stringify(never)}`);
    }
  }

  checkEights(s);
  s.moveCount = state.moveCount + 1;
  return s;
}

function requireTurn(s: GameState, playerId: string): void {
  if (currentPlayer(s).id !== playerId) {
    throw new IllegalMoveError(`It is ${currentPlayer(s).name}'s turn.`);
  }
}

function requirePhase(s: GameState, phase: GameState['phase']): void {
  if (s.phase !== phase) {
    if (s.phase === 'awaitingDrawChoice') {
      throw new IllegalMoveError('Play or keep the card you just drew first.');
    }
    throw new IllegalMoveError('That move is not available right now.');
  }
}
