import { describe, expect, it } from 'vitest';

import {
  applyMove,
  cardPlayability,
  createGame,
  currentPlayer,
  isCardPlayable,
  jumpInCards,
  legalMoves,
  playerById,
  topCard,
} from './rules';
import { IllegalMoveError, type GameState, type Move } from './types';
import { c, cards, giveAndPlay, scenario } from './testkit';

const FOUR = ['Ana', 'Ben', 'Cara', 'Dev'];

function play(state: GameState, playerId: string, specs: string[], extra: Partial<Move> = {}) {
  return applyMove(state, {
    kind: 'play',
    playerId,
    cards: cards(...specs),
    ...extra,
  } as Move);
}

function hand(state: GameState, playerId: string) {
  return playerById(state, playerId)!.hand;
}

function turnOf(state: GameState) {
  return currentPlayer(state).id;
}

// ---------------------------------------------------------------------------
// 1. Basic suit and rank matching
// ---------------------------------------------------------------------------

describe('suit and rank matching', () => {
  it('accepts a suit match and a rank match, and rejects everything else', () => {
    const s = scenario({ hands: { p1: ['4H', '4C', '9S'] }, pile: ['8H'] });

    expect(isCardPlayable(s, c('4H'))).toBe(true); // same suit as 8♥
    expect(isCardPlayable(s, c('9S'))).toBe(false);

    const after = play(s, 'p1', ['4H']);
    expect(after.activeSuit).toBe('H');
    expect(after.activeRank).toBe('4');
    expect(isCardPlayable(after, c('4C'))).toBe(true); // now a rank match
  });

  it('rejects an unmatched card with a readable reason', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'] });
    expect(() => play(s, 'p1', ['9S'])).toThrow(IllegalMoveError);
    expect(cardPlayability(s, c('9S')).reason).toMatch(/does not match/);
  });

  it('never mutates the state it was given', () => {
    const s = scenario({ hands: { p1: ['4H', '9S'] }, pile: ['8H'] });
    const snapshot = JSON.stringify(s);
    play(s, 'p1', ['4H']);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('refuses a move made out of turn', () => {
    const s = scenario({ hands: { p1: ['4H'], p2: ['8C'] }, pile: ['8H'] });
    expect(() => play(s, 'p2', ['8C'])).toThrow(/Ana's turn/);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-card same-rank plays
// ---------------------------------------------------------------------------

describe('multi-card plays', () => {
  it('plays several cards of one rank, the last one setting the suit', () => {
    const s = scenario({ hands: { p1: ['4H', '4C', '4D', 'QS'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['4H', '4C', '4D']);

    expect(hand(after, 'p1').map((x) => x.id)).toEqual(['1-QS']);
    expect(after.activeSuit).toBe('D');
    expect(after.activeRank).toBe('4');
    expect(after.discardPile).toHaveLength(4);
  });

  it('rejects a group of mixed ranks', () => {
    const s = scenario({ hands: { p1: ['4H', '9H', 'QS'] }, pile: ['8H'] });
    expect(() => play(s, 'p1', ['4H', '9H'])).toThrow(/share a rank/);
  });

  it('requires the lead card of a group to be legal', () => {
    const s = scenario({ hands: { p1: ['4C', '4H', 'QS'] }, pile: ['8H'] });
    expect(() => play(s, 'p1', ['4C', '4H'])).toThrow(/does not match/);
    expect(() => play(s, 'p1', ['4H', '4C'])).not.toThrow();
  });

  it('stacks the effect of every card in the group', () => {
    const s = scenario({ hands: { p1: ['2H', '2D', 'QS'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['2H', '2D']);
    expect(after.pickupCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. The worked pick-up example, step by step
// ---------------------------------------------------------------------------

describe('the worked pick-up example', () => {
  it('reproduces the sequence from the rules exactly', () => {
    let s = scenario({
      players: FOUR,
      hands: { p1: ['QC'], p2: ['QD'], p3: ['QH'], p4: ['QS'] },
      pile: ['8H'],
    });

    s = giveAndPlay(s, '4H'); // same suit
    expect([s.activeRank, s.activeSuit]).toEqual(['4', 'H']);
    expect(turnOf(s)).toBe('p2');

    s = giveAndPlay(s, '4C'); // same rank
    expect([s.activeRank, s.activeSuit]).toEqual(['4', 'C']);

    s = giveAndPlay(s, '4D'); // same rank
    expect([s.activeRank, s.activeSuit]).toEqual(['4', 'D']);

    s = giveAndPlay(s, '9D'); // same suit
    expect([s.activeRank, s.activeSuit]).toEqual(['9', 'D']);
    expect(turnOf(s)).toBe('p1');

    s = giveAndPlay(s, '5D'); // same suit — pick up 5
    expect(s.pickupCount).toBe(5);

    s = giveAndPlay(s, '5C'); // any suit, chain active — pick up 10
    expect(s.pickupCount).toBe(10);
    expect(s.activeSuit).toBe('C');

    s = giveAndPlay(s, '2H'); // any suit — pick up 12
    expect(s.pickupCount).toBe(12);

    expect(turnOf(s)).toBe('p4');
    s = giveAndPlay(s, '10C'); // skips this player from picking up, passes the chain on
    expect(s.pickupCount).toBe(12);
    expect(turnOf(s)).toBe('p1'); // the next player, not the one after

    expect(s.direction).toBe(1);
    s = giveAndPlay(s, 'JH'); // reverse direction
    expect(s.direction).toBe(-1);
    expect(s.pickupCount).toBe(12);
    expect(turnOf(s)).toBe('p4');

    s = giveAndPlay(s, '7S'); // stops the pick-up, play continues from the 7
    expect(s.pickupCount).toBe(0);
    expect([s.activeRank, s.activeSuit]).toEqual(['7', 'S']);
    expect(turnOf(s)).toBe('p3');

    s = giveAndPlay(s, '6S'); // same suit
    expect([s.activeRank, s.activeSuit]).toEqual(['6', 'S']);
  });

  it('will not let a plain matching card dodge a running pick-up', () => {
    const s = scenario({ hands: { p1: ['6S', 'QC'] }, pile: ['6H'], pickup: 4 });
    expect(() => play(s, 'p1', ['6S'])).toThrow(/pick-up of 4 is running/);
  });

  it('honours the opt-in variant that allows plain cards during a pick-up', () => {
    const s = scenario({
      hands: { p1: ['6S', 'QC'] },
      pile: ['6H'],
      pickup: 4,
      config: { allowPlainCardDuringPickup: true },
    });
    const after = play(s, 'p1', ['6S']);
    expect(after.pickupCount).toBe(4);
  });

  it('makes a player who cannot answer the chain pick the whole thing up', () => {
    const s = scenario({
      players: FOUR,
      hands: { p1: ['6S'] },
      pile: ['6H'],
      pickup: 12,
      drawPile: Array.from({ length: 20 }, (_, i) => ['3C', '3D', '3H', '3S'][i % 4] + (i > 3 ? "'" : '')),
    });
    const after = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(after.pickupCount).toBe(0);
    expect(hand(after, 'p1')).toHaveLength(13);
    expect(turnOf(after)).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// 4. Aces
// ---------------------------------------------------------------------------

describe('aces', () => {
  it('nominates a new suit in normal play', () => {
    const s = scenario({ hands: { p1: ['AS', '3C'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['AS'], { calledSuit: 'C' });
    expect(after.activeSuit).toBe('C');
    expect(after.activeRank).toBe('A');
  });

  it('requires a nomination in normal play', () => {
    const s = scenario({ hands: { p1: ['AS', '3C'] }, pile: ['8H'] });
    expect(() => play(s, 'p1', ['AS'])).toThrow(/must nominate a suit/);
  });

  it('stops a pick-up and keeps its own suit, ignoring any nomination', () => {
    const s = scenario({ hands: { p1: ['AS', '3C'] }, pile: ['2H'], pickup: 4 });
    const after = play(s, 'p1', ['AS'], { calledSuit: 'C' });
    expect(after.pickupCount).toBe(0);
    expect(after.activeSuit).toBe('S'); // the ace's own suit, not the called one
    expect(after.activeRank).toBe('A');
  });

  it('is playable on any card', () => {
    const s = scenario({ hands: { p1: ['AS', '3C'] }, pile: ['9D'] });
    expect(isCardPlayable(s, c('AS'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Sevens, tens and jacks during a chain
// ---------------------------------------------------------------------------

describe('chain responses', () => {
  it('cancels the chain with a 7 and continues from it', () => {
    const s = scenario({ players: FOUR, hands: { p1: ['7S', 'QC'] }, pile: ['2H'], pickup: 6 });
    const after = play(s, 'p1', ['7S']);
    expect(after.pickupCount).toBe(0);
    expect(after.activeSuit).toBe('S');
    expect(turnOf(after)).toBe('p2');
  });

  it('passes an intact chain on with a 10 without skipping anybody extra', () => {
    const s = scenario({ players: FOUR, hands: { p1: ['10C', 'QC'] }, pile: ['2H'], pickup: 6 });
    const after = play(s, 'p1', ['10C']);
    expect(after.pickupCount).toBe(6);
    expect(turnOf(after)).toBe('p2');
  });

  it('skips the next player with a 10 in normal play', () => {
    const s = scenario({ players: FOUR, hands: { p1: ['10H', 'QC'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['10H']);
    expect(turnOf(after)).toBe('p3');
  });

  it('reverses direction with a jack while a chain is running', () => {
    const s = scenario({ players: FOUR, hands: { p1: ['JH', 'QC'] }, pile: ['2C'], pickup: 6 });
    const after = play(s, 'p1', ['JH']);
    expect(after.direction).toBe(-1);
    expect(after.pickupCount).toBe(6);
    expect(turnOf(after)).toBe('p4');
  });
});

// ---------------------------------------------------------------------------
// 6. Jack as a skip heads-up
// ---------------------------------------------------------------------------

describe('two-player games', () => {
  it('treats a jack as a skip, handing the turn straight back', () => {
    const s = scenario({ hands: { p1: ['JH', 'QC'], p2: ['3C'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['JH']);
    expect(after.direction).toBe(1);
    expect(turnOf(after)).toBe('p1');
  });

  it('still reverses in a three-player game', () => {
    const s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['JH', 'QC'] },
      pile: ['8H'],
    });
    const after = play(s, 'p1', ['JH']);
    expect(after.direction).toBe(-1);
    expect(turnOf(after)).toBe('p3');
  });
});

// ---------------------------------------------------------------------------
// 7. The one-eyed king of diamonds
// ---------------------------------------------------------------------------

describe('the one-eyed king', () => {
  it('is playable out of suit and takes the card underneath it', () => {
    const s = scenario({ hands: { p1: ['KD', 'QC'] }, pile: ['3C', '8H'] });
    const after = play(s, 'p1', ['KD']);

    expect(after.activeSuit).toBe('D');
    expect(after.activeRank).toBe('K');
    expect(hand(after, 'p1').map((x) => x.id)).toContain('1-8H');
    expect(topCard(after)!.card.id).toBe('1-KD');
    expect(after.discardPile.map((e) => e.card.id)).toEqual(['1-3C', '1-KD']);
  });

  it('blocks a pick-up', () => {
    const s = scenario({ hands: { p1: ['KD', 'QC'] }, pile: ['3C', '2H'], pickup: 8 });
    const after = play(s, 'p1', ['KD']);
    expect(after.pickupCount).toBe(0);
    expect(hand(after, 'p1').map((x) => x.id)).toContain('1-2H');
  });

  it('does not give a regular king any powers', () => {
    const s = scenario({ hands: { p1: ['KS', 'QC'] }, pile: ['3C', '8H'] });
    expect(isCardPlayable(s, c('KS'))).toBe(false);
    expect(() => play(s, 'p1', ['KS'])).toThrow(/does not match/);
  });
});

// ---------------------------------------------------------------------------
// 8. Jokers
// ---------------------------------------------------------------------------

describe('jokers', () => {
  it('takes on whatever card it is nominated as', () => {
    const s = scenario({ hands: { p1: ['JOKER', '3C'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['JOKER'], { calledCard: { rank: 'Q', suit: 'S' } });
    expect(after.activeRank).toBe('Q');
    expect(after.activeSuit).toBe('S');
  });

  it('carries the power of the card it names', () => {
    const s = scenario({ hands: { p1: ['JOKER', '3C'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['JOKER'], { calledCard: { rank: '2', suit: 'D' } });
    expect(after.pickupCount).toBe(2);
    expect(after.activeRank).toBe('2');
  });

  it('may join a group of the rank it names', () => {
    const s = scenario({ hands: { p1: ['2H', 'JOKER', 'QC'] }, pile: ['8H'] });
    const after = play(s, 'p1', ['2H', 'JOKER'], { calledCard: { rank: '2', suit: 'D' } });
    expect(after.pickupCount).toBe(4);
    expect(after.activeSuit).toBe('D');
  });

  it('must be nominated', () => {
    const s = scenario({ hands: { p1: ['JOKER', '3C'] }, pile: ['8H'] });
    expect(() => play(s, 'p1', ['JOKER'])).toThrow(/must be nominated/);
  });
});

// ---------------------------------------------------------------------------
// 9. The nuclear pick-up
// ---------------------------------------------------------------------------

describe('the pick-up ceiling', () => {
  it('caps the chain at 25 and flags it as nuclear', () => {
    const s = scenario({ hands: { p1: ['5D', 'QC'] }, pile: ['2H'], pickup: 22 });
    const after = play(s, 'p1', ['5D']);
    expect(after.pickupCount).toBe(25);
    expect(after.nuclear).toBe(true);
  });

  it('does not go past the ceiling however many cards are added', () => {
    const s = scenario({ hands: { p1: ['5D', '5C', 'QC'] }, pile: ['2H'], pickup: 25 });
    const after = play(s, 'p1', ['5D', '5C']);
    expect(after.pickupCount).toBe(25);
  });

  it('can still be blocked by a 7', () => {
    const s = scenario({ hands: { p1: ['7S', 'QC'] }, pile: ['2H'], pickup: 25 });
    expect(play(s, 'p1', ['7S']).pickupCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Winning on a power card
// ---------------------------------------------------------------------------

describe('winning', () => {
  it('rejects a win on a power card', () => {
    const s = scenario({ hands: { p1: ['2S'] }, pile: ['2H'] });
    s.players[0].lastCardCalled = true;
    expect(() => play(s, 'p1', ['2S'])).toThrow(/may not win on a power card/);
  });

  it('rejects a win on the one-eyed king but allows one on a regular king', () => {
    const kd = scenario({ hands: { p1: ['KD'] }, pile: ['KH'] });
    kd.players[0].lastCardCalled = true;
    expect(() => play(kd, 'p1', ['KD'])).toThrow(/power card/);

    const ks = scenario({ hands: { p1: ['KS'] }, pile: ['KH'] });
    ks.players[0].lastCardCalled = true;
    const after = play(ks, 'p1', ['KS']);
    expect(after.phase).toBe('finished');
    expect(after.winnerId).toBe('p1');
  });

  it('lets a called set of identical ranks go out together', () => {
    const s = scenario({ hands: { p1: ['3H', '3S', '3D'] }, pile: ['3C'] });
    s.players[0].lastCardCalled = true;
    const after = play(s, 'p1', ['3H', '3S', '3D']);
    expect(after.winnerId).toBe('p1');
    expect(after.jumpOutOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. The Last Card call
// ---------------------------------------------------------------------------

describe('calling Last Card', () => {
  it('closes the window as soon as the next player moves', () => {
    let s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['4H', '9S'], p2: ['4C', 'QD'], p3: ['QH'] },
      pile: ['8H'],
    });

    s = play(s, 'p1', ['4H']);
    expect(playerById(s, 'p1')!.lastCardEligible).toBe(true);
    expect(playerById(s, 'p1')!.lastCardCalled).toBe(false);

    s = play(s, 'p2', ['4C']); // Ana was too slow
    expect(playerById(s, 'p1')!.lastCardMissed).toBe(true);
    expect(playerById(s, 'p1')!.lastCardEligible).toBe(false);
  });

  it('blocks the win and makes the player pick up when the call was missed', () => {
    const s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['9S'], p2: ['QD'], p3: ['QH'] },
      pile: ['9H'],
      drawPile: ['3C', '3D'],
    });
    s.players[0].lastCardMissed = true;
    s.players[0].lastCardEligible = false;

    const after = play(s, 'p1', ['9S']);
    expect(after.winnerId).toBeNull();
    expect(after.phase).toBe('playing');
    expect(hand(after, 'p1')).toHaveLength(1); // picked up in place of the win
    expect(turnOf(after)).toBe('p2');
    expect(after.log.some((l) => /does not count/.test(l.text))).toBe(true);
  });

  it('lets a player who called in time go out', () => {
    let s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['4H', '9S'], p2: ['4C', 'QD'], p3: ['9C', 'QH'] },
      pile: ['8H'],
    });

    s = play(s, 'p1', ['4H']);
    s = applyMove(s, { kind: 'callLastCard', playerId: 'p1' });
    s = play(s, 'p2', ['4C']);
    expect(playerById(s, 'p1')!.lastCardMissed).toBe(false);

    s = play(s, 'p3', ['9C']);
    s = play(s, 'p1', ['9S']);
    expect(s.winnerId).toBe('p1');
  });

  it('refuses a call from a player who is not on their last card', () => {
    const s = scenario({ hands: { p1: ['4H', '9S'] }, pile: ['8H'] });
    expect(() => applyMove(s, { kind: 'callLastCard', playerId: 'p1' })).toThrow(/one set of a kind/);
  });

  it('drops the call when the hand grows again', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'], drawPile: ['3C', '3D'] });
    s.players[0].lastCardCalled = true;
    const after = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(playerById(after, 'p1')!.lastCardCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Pick and Play
// ---------------------------------------------------------------------------

describe('Pick and Play', () => {
  it('offers the drawn card when it is playable in normal play', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'], drawPile: ['3C', '4H'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });

    expect(drawn.phase).toBe('awaitingDrawChoice');
    expect(drawn.pendingDraw).toEqual({ playerId: 'p1', cardId: '1-4H' });
    expect(turnOf(drawn)).toBe('p1');

    const played = applyMove(drawn, { kind: 'playDrawnCard', playerId: 'p1', card: c('4H') });
    expect(played.activeRank).toBe('4');
    expect(hand(played, 'p1').map((x) => x.id)).toEqual(['1-9S']);
    expect(turnOf(played)).toBe('p2');
  });

  it('lets the drawer keep the card instead', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'], drawPile: ['3C', '4H'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    const passed = applyMove(drawn, { kind: 'pass', playerId: 'p1' });
    expect(passed.phase).toBe('playing');
    expect(hand(passed, 'p1')).toHaveLength(2);
    expect(turnOf(passed)).toBe('p2');
  });

  it('ends the turn straight away when the drawn card is unplayable', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'], drawPile: ['3C', '2S'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(drawn.phase).toBe('playing');
    expect(turnOf(drawn)).toBe('p2');
  });

  it('never applies during a pick-up', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['2H'], pickup: 4, drawPile: ['4H', '4C', '4D', '4S'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(drawn.phase).toBe('playing');
    expect(hand(drawn, 'p1')).toHaveLength(5);
  });

  it('cannot be used to win', () => {
    // Reachable after a blocked win emptied a hand while the draw pile was out.
    const s = scenario({ hands: { p1: [], p2: ['QD'] }, pile: ['8H'], drawPile: ['4H'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(drawn.phase).toBe('awaitingDrawChoice');
    expect(() =>
      applyMove(drawn, { kind: 'playDrawnCard', playerId: 'p1', card: c('4H') }),
    ).toThrow(/cannot Pick and Play to win/);
  });

  it('clears an earlier Last Card call, so the win waits another turn', () => {
    const s = scenario({ hands: { p1: ['9S'] }, pile: ['8H'], drawPile: ['3C', '9H'] });
    s.players[0].lastCardCalled = true;
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    const played = applyMove(drawn, { kind: 'playDrawnCard', playerId: 'p1', card: c('9H') });
    expect(playerById(played, 'p1')!.lastCardEligible).toBe(true);
    expect(playerById(played, 'p1')!.lastCardCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Jump-ins
// ---------------------------------------------------------------------------

describe('jump-ins', () => {
  it('lets any player play an exact duplicate out of turn', () => {
    const s = scenario({
      players: FOUR,
      hands: { p2: ["4D'", 'QD'], p3: ['QH'] },
      pile: ['4D'],
      current: 2,
    });

    expect(jumpInCards(s, 'p2').map((x) => x.id)).toEqual(['2-4D']);
    const after = applyMove(s, { kind: 'jumpIn', playerId: 'p2', cards: [c("4D'")] });

    expect(hand(after, 'p2')).toHaveLength(1);
    expect(topCard(after)!.card.id).toBe('2-4D');
    expect(turnOf(after)).toBe('p3'); // play continues from the jumper
  });

  it('works even when the jumper has just been skipped', () => {
    let s = scenario({
      players: FOUR,
      hands: { p1: ['10H', 'QC'], p2: ["10H'", 'QD'] },
      pile: ['8H'],
    });

    s = play(s, 'p1', ['10H']); // skips Ben
    expect(turnOf(s)).toBe('p3');

    s = applyMove(s, { kind: 'jumpIn', playerId: 'p2', cards: [c("10H'")] });
    expect(hand(s, 'p2')).toHaveLength(1);
    expect(turnOf(s)).toBe('p4'); // Ben's ten skips Cara in turn
  });

  it('applies the jumped-in card power, including during a chain', () => {
    const s = scenario({
      players: FOUR,
      hands: { p2: ["2H'", 'QD'] },
      pile: ['2H'],
      pickup: 6,
      current: 2,
    });
    const after = applyMove(s, { kind: 'jumpIn', playerId: 'p2', cards: [c("2H'")] });
    expect(after.pickupCount).toBe(8);
  });

  it('rejects a card that is not an exact match', () => {
    const s = scenario({ players: FOUR, hands: { p2: ['4H', 'QD'] }, pile: ['4D'], current: 2 });
    expect(() => applyMove(s, { kind: 'jumpIn', playerId: 'p2', cards: [c('4H')] })).toThrow(
      /exact same card/,
    );
  });
});

// ---------------------------------------------------------------------------
// 14. Jump-outs
// ---------------------------------------------------------------------------

describe('jump-outs', () => {
  function finishedGame() {
    let s = scenario({
      players: FOUR,
      hands: { p1: ['6S'], p2: ["6S'", 'QD'], p3: ['QH'], p4: ['QS'] },
      pile: ['6H'],
      drawPile: ['3C', '3D', '3H'],
    });
    s.players[0].lastCardCalled = true;
    s = play(s, 'p1', ['6S']);
    return s;
  }

  it('reopens a finished game and puts the beaten winner back in', () => {
    const won = finishedGame();
    expect(won.phase).toBe('finished');
    expect(won.winnerId).toBe('p1');
    expect(won.jumpOutOpen).toBe(true);

    const after = applyMove(won, { kind: 'jumpIn', playerId: 'p2', cards: [c("6S'")] });

    expect(after.phase).toBe('playing');
    expect(after.winnerId).toBeNull();
    expect(after.jumpOutOpen).toBe(false);
    expect(hand(after, 'p1')).toHaveLength(1); // back in the game
    expect(topCard(after)!.card.id).toBe('2-6S');
    expect(turnOf(after)).toBe('p3');
  });

  it('refuses a jump-out once the window has closed', () => {
    const won = finishedGame();
    const closed = applyMove(won, { kind: 'closeJumpOut' });
    expect(closed.jumpOutOpen).toBe(false);
    expect(() => applyMove(closed, { kind: 'jumpIn', playerId: 'p2', cards: [c("6S'")] })).toThrow(
      /window has closed/,
    );
  });

  it('offers the jump-out in legalMoves while the window is open', () => {
    const won = finishedGame();
    const kinds = legalMoves(won, 'p2').map((m) => m.kind);
    expect(kinds).toContain('jumpIn');
    expect(legalMoves(won, 'p3').map((m) => m.kind)).not.toContain('jumpIn');
  });
});

// ---------------------------------------------------------------------------
// 15. Reshuffling
// ---------------------------------------------------------------------------

describe('reshuffling', () => {
  it('folds the discards back in when the draw pile empties mid-pick-up', () => {
    const pile = ['3C', '3D', '3H', '3S', '4C', '4D', '4H', '4S', '5C', '5D', '5H', '2H'];
    const s = scenario({
      players: FOUR,
      hands: { p1: ['QC'] },
      pile,
      pickup: 10,
      drawPile: ['6C', '6D'],
    });

    const after = applyMove(s, { kind: 'draw', playerId: 'p1' });

    expect(hand(after, 'p1')).toHaveLength(11); // QC plus ten picked up
    expect(after.pickupCount).toBe(0);
    expect(after.discardPile).toHaveLength(1);
    expect(after.discardPile[0].card.id).toBe('1-2H'); // the top card stays put
    expect(after.drawPile).toHaveLength(3); // 2 left + 11 folded back - 10 taken
    expect(after.log.some((l) => /shuffled back in/.test(l.text))).toBe(true);
  });

  it('hands out what it can when every card is already in a hand', () => {
    const s = scenario({ hands: { p1: ['QC'] }, pile: ['2H'], pickup: 5, drawPile: [] });
    const after = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(hand(after, 'p1')).toHaveLength(1);
    expect(after.pickupCount).toBe(0);
  });

  it('shuffles deterministically from the seed', () => {
    const a = createGame(['Ana', 'Ben'], {}, 99);
    const b = createGame(['Ana', 'Ben'], {}, 99);
    expect(a.players[0].hand.map((x) => x.id)).toEqual(b.players[0].hand.map((x) => x.id));
    expect(createGame(['Ana', 'Ben'], {}, 100).players[0].hand.map((x) => x.id)).not.toEqual(
      a.players[0].hand.map((x) => x.id),
    );
  });
});

// ---------------------------------------------------------------------------
// The 8s instant win
// ---------------------------------------------------------------------------

describe('eights', () => {
  const eight = ['3H', '3S', '3D', '3C', "3H'", "3S'", "3D'", "3C'"];

  it('wins instantly when declared', () => {
    const s = scenario({ hands: { p1: eight }, pile: ['8H'] });
    const after = applyMove(s, { kind: 'declareEights', playerId: 'p1' });
    expect(after.phase).toBe('finished');
    expect(after.winnerId).toBe('p1');
    expect(after.jumpOutOpen).toBe(false);
  });

  it('is detected automatically, out of turn, as soon as the hand appears', () => {
    // Ben holds seven threes; the eighth reaches him through a penalty pick-up,
    // on somebody else's turn, without him declaring anything.
    const s = scenario({
      hands: { p1: ['QC'], p2: eight.slice(0, 7) },
      pile: ['8H'],
      drawPile: ["3C'"],
    });
    expect(s.winnerId).toBeNull();

    const proposed = applyMove(s, {
      kind: 'penalty',
      playerId: 'p1',
      targetPlayerId: 'p2',
      reason: 'dropped a card face up',
      amount: 1,
    });
    expect(proposed.winnerId).toBeNull();

    const penalised = applyMove(proposed, { kind: 'confirmPenalty', playerId: 'p2' });
    expect(penalised.phase).toBe('finished');
    expect(penalised.winnerId).toBe('p2');
  });

  it('rejects a false declaration', () => {
    const s = scenario({ hands: { p1: ['3H', '3S'] }, pile: ['8H'] });
    expect(() => applyMove(s, { kind: 'declareEights', playerId: 'p1' })).toThrow(/does not hold/);
  });

  it('is unreachable with a single deck', () => {
    const s = createGame(['Ana', 'Ben'], { deckCount: 1, jokersPerDeck: 2 }, 7);
    expect(s.drawPile.length + s.players.reduce((n, p) => n + p.hand.length, 0) + 1).toBe(54);
  });
});

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

describe('penalties', () => {
  it('waits for confirmation before it applies', () => {
    const s = scenario({ hands: { p1: ['QC'], p2: ['QD'] }, pile: ['8H'], drawPile: ['3C', '3D', '3H'] });
    const proposed = applyMove(s, {
      kind: 'penalty',
      playerId: 'p1',
      targetPlayerId: 'p2',
      reason: 'shuffling infringement',
      amount: 2,
    });

    expect(proposed.pendingPenalty).toMatchObject({ targetPlayerId: 'p2', amount: 2 });
    expect(hand(proposed, 'p2')).toHaveLength(1);
    expect(() => play(proposed, 'p1', ['QC'])).toThrow(/waiting to be settled/);

    const applied = applyMove(proposed, { kind: 'confirmPenalty', playerId: 'p2' });
    expect(hand(applied, 'p2')).toHaveLength(3);
    expect(applied.pendingPenalty).toBeNull();
  });

  it('can be dismissed, so a player can defend themselves', () => {
    const s = scenario({ hands: { p1: ['QC'], p2: ['QD'] }, pile: ['8H'], drawPile: ['3C', '3D'] });
    const proposed = applyMove(s, {
      kind: 'penalty',
      playerId: 'p1',
      targetPlayerId: 'p2',
      reason: 'looked at their cards first',
      amount: 2,
    });
    const dismissed = applyMove(proposed, { kind: 'declinePenalty', playerId: 'p2' });
    expect(hand(dismissed, 'p2')).toHaveLength(1);
    expect(dismissed.pendingPenalty).toBeNull();
  });

  it('takes a negotiated amount', () => {
    const s = scenario({
      hands: { p1: ['QC'], p2: ['QD'] },
      pile: ['8H'],
      drawPile: ['3C', '3D', '3H', '3S', '4C', '4D', '4H'],
    });
    const applied = applyMove(
      applyMove(s, {
        kind: 'penalty',
        playerId: 'p1',
        targetPlayerId: 'p2',
        reason: 'negotiated down from 15',
        amount: 6,
      }),
      { kind: 'confirmPenalty', playerId: 'p1' },
    );
    expect(hand(applied, 'p2')).toHaveLength(7);
  });

  it('needs a reason and a sensible amount', () => {
    const s = scenario({ hands: { p1: ['QC'], p2: ['QD'] }, pile: ['8H'] });
    const base = { kind: 'penalty' as const, playerId: 'p1', targetPlayerId: 'p2' };
    expect(() => applyMove(s, { ...base, reason: '  ', amount: 2 })).toThrow(/needs a reason/);
    expect(() => applyMove(s, { ...base, reason: 'x', amount: 0 })).toThrow(/at least one card/);
  });
});

// ---------------------------------------------------------------------------
// legalMoves and setup
// ---------------------------------------------------------------------------

describe('legalMoves', () => {
  it('lists singles, same-rank groups and the draw', () => {
    const s = scenario({ hands: { p1: ['4H', '4C', '9S'] }, pile: ['8H'] });
    const moves = legalMoves(s, 'p1');
    const plays = moves.filter((m) => m.kind === 'play');

    expect(plays.map((m) => (m as { cards: { id: string }[] }).cards.map((x) => x.id))).toEqual([
      ['1-4H'],
      ['1-4H', '1-4C'],
    ]);
    expect(moves.some((m) => m.kind === 'draw')).toBe(true);
  });

  it('gives a player who is not on turn only the off-turn actions', () => {
    const s = scenario({ hands: { p1: ['4H'], p2: ['8C', "8H'"] }, pile: ['8H'] });
    const kinds = legalMoves(s, 'p2').map((m) => m.kind);
    expect(kinds).toContain('jumpIn');
    expect(kinds).toContain('penalty');
    expect(kinds).not.toContain('play');
    expect(kinds).not.toContain('draw');
  });

  it('offers only the penalty decision while one is pending', () => {
    const s = applyMove(scenario({ hands: { p1: ['4H'], p2: ['QD'] }, pile: ['8H'] }), {
      kind: 'penalty',
      playerId: 'p1',
      targetPlayerId: 'p2',
      reason: 'dropped a card',
      amount: 2,
    });
    expect(legalMoves(s, 'p1').map((m) => m.kind).sort()).toEqual([
      'confirmPenalty',
      'declinePenalty',
    ]);
  });
});

describe('createGame', () => {
  it('deals 108 cards across two decks and turns over a plain starter', () => {
    const s = createGame(FOUR, {}, 5);
    const total = s.drawPile.length + s.discardPile.length + s.players.reduce((n, p) => n + p.hand.length, 0);
    expect(total).toBe(108);
    expect(s.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(['A', '2', '5', '7', '10', 'J', 'JOKER']).not.toContain(s.activeRank);
    expect(topCard(s)!.card.suit).toBe(s.activeSuit);
  });

  it('holds the table size between two and six', () => {
    expect(() => createGame(['Solo'], {}, 1)).toThrow(/between 2 and 6/);
    expect(() => createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], {}, 1)).toThrow(/between 2 and 6/);
  });

  it('plays a full game through legalMoves without ever throwing', () => {
    let s = createGame(FOUR, {}, 2024);
    for (let i = 0; i < 600 && s.phase !== 'finished'; i++) {
      const me = currentPlayer(s).id;
      const options = legalMoves(s, me).filter(
        (m) => m.kind === 'play' || m.kind === 'draw' || m.kind === 'playDrawnCard' || m.kind === 'pass',
      );
      const pick =
        options.find((m) => {
          if (m.kind !== 'play') return false;
          const player = playerById(s, me)!;
          // Skip plays that need a nomination or would be an illegal win.
          if (m.cards.some((x) => x.rank === 'JOKER' || x.rank === 'A')) return false;
          return m.cards.length < player.hand.length || player.lastCardCalled;
        }) ?? options.find((m) => m.kind === 'draw' || m.kind === 'pass');
      if (!pick) break;
      s = applyMove(s, pick);
      const player = playerById(s, me)!;
      if (player.lastCardEligible && !player.lastCardCalled) {
        s = applyMove(s, { kind: 'callLastCard', playerId: me });
      }
    }
    expect(s.log.length).toBeGreaterThan(10);
  });
});
