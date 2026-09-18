import { describe, expect, it } from 'vitest';

import { applyMove, createGame, currentPlayer, legalMoves, playerById } from './rules';
import { hiddenFrom, viewFor } from './view';
import { scenario } from './testkit';

describe('what a device is sent', () => {
  it('carries the viewer their own hand, and everyone else only a count', () => {
    const s = createGame(['Ana', 'Ben', 'Cara'], {}, 4242);
    const v = viewFor(s, 'p2');

    expect(v.you.id).toBe('p2');
    expect(v.you.hand.map((c) => c.id)).toEqual(playerById(s, 'p2')!.hand.map((c) => c.id));
    expect(v.players.map((p) => p.handCount)).toEqual([7, 7, 7]);
    expect(v.players.every((p) => !('hand' in p))).toBe(true);
  });

  it('leaks no card the viewer is not entitled to', () => {
    const s = createGame(['Ana', 'Ben', 'Cara', 'Dev'], {}, 99);

    for (const p of s.players) {
      const serialised = JSON.stringify(viewFor(s, p.id));
      const leaked = hiddenFrom(s, p.id).filter((id) => serialised.includes(`"${id}"`));
      expect(leaked).toEqual([]);
    }
  });

  it('never sends the draw pile, whose order is the next several draws', () => {
    const s = createGame(['Ana', 'Ben'], {}, 7);
    const v = viewFor(s, 'p1');
    expect(v.drawCount).toBe(s.drawPile.length);
    expect(JSON.stringify(v)).not.toContain(s.drawPile[s.drawPile.length - 1].id);
  });

  it('never sends the seed, which is every future shuffle', () => {
    const s = createGame(['Ana', 'Ben'], {}, 123456);
    const v = viewFor(s, 'p1') as unknown as Record<string, unknown>;
    expect('seed' in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain('123456');
  });

  it('shows the top of the pile but not the pile underneath it', () => {
    const s = scenario({ hands: { p1: ['4H'], p2: ['9S'] }, pile: ['3C', '7D', '8H'] });
    const v = viewFor(s, 'p1');
    expect(v.discardTop!.card.id).toBe('1-8H');
    expect(v.discardCount).toBe(3);
    const serialised = JSON.stringify(v);
    expect(serialised).not.toContain('1-3C');
    expect(serialised).not.toContain('1-7D');
  });

  it('names a drawn card only to the player who drew it', () => {
    const s = scenario({ hands: { p1: ['9S'], p2: ['QD'] }, pile: ['8H'], drawPile: ['3C', '4H'] });
    const drawn = applyMove(s, { kind: 'draw', playerId: 'p1' });
    expect(drawn.phase).toBe('awaitingDrawChoice');

    const mine = viewFor(drawn, 'p1');
    expect(mine.pendingDraw!.card!.id).toBe('1-4H');

    const theirs = viewFor(drawn, 'p2');
    expect(theirs.pendingDraw!.playerId).toBe('p1'); // they know a draw happened
    expect(theirs.pendingDraw!.card).toBeNull(); // but not what it was
    expect(JSON.stringify(theirs)).not.toContain('1-4H');
  });

  it('tells a player when they can jump in, and nobody else', () => {
    const s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['QC'], p2: ["4D'", 'QD'], p3: ['QH'] },
      pile: ['4D'],
    });
    expect(viewFor(s, 'p2').jumpInCards.map((c) => c.id)).toEqual(['2-4D']);
    expect(viewFor(s, 'p1').jumpInCards).toEqual([]);
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('2-4D');
  });

  it('keeps the public facts public', () => {
    const s = scenario({
      players: ['Ana', 'Ben', 'Cara'],
      hands: { p1: ['2H', 'QC'], p2: ['QD'], p3: ['QH'] },
      pile: ['8H'],
    });
    const after = applyMove(s, { kind: 'play', playerId: 'p1', cards: [{ ...s.players[0].hand[0] }] });
    const v = viewFor(after, 'p3');

    expect(v.pickupCount).toBe(2);
    expect(v.currentPlayerId).toBe('p2');
    expect(v.yourTurn).toBe(false);
    expect(v.activeSuit).toBe('H');
    expect(v.log.length).toBeGreaterThan(0);
    expect(v.players.find((p) => p.id === 'p1')!.handCount).toBe(1);
  });

  it('stays honest across a whole game', () => {
    let s = createGame(['Ana', 'Ben', 'Cara'], {}, 2718);

    for (let i = 0; i < 200 && s.phase !== 'finished'; i++) {
      // Every player's view must be clean at every single step, not just at the deal.
      for (const p of s.players) {
        const serialised = JSON.stringify(viewFor(s, p.id));
        const leaked = hiddenFrom(s, p.id).filter((id) => serialised.includes(`"${id}"`));
        if (leaked.length) throw new Error(`move ${i}: ${p.id} could see ${leaked.join(', ')}`);
      }

      const me = currentPlayer(s).id;
      const options = legalMoves(s, me).filter(
        (m) =>
          (m.kind === 'play' &&
            !m.cards.some((x) => x.rank === 'JOKER' || x.rank === 'A') &&
            (m.cards.length < playerById(s, me)!.hand.length || playerById(s, me)!.lastCardCalled)) ||
          m.kind === 'draw' ||
          m.kind === 'pass',
      );
      const pick = options.find((m) => m.kind === 'play') ?? options[0];
      if (!pick) break;
      s = applyMove(s, pick);
    }

    expect(s.moveCount).toBeGreaterThan(5);
  });

  it('refuses a view for somebody who is not at the table', () => {
    const s = createGame(['Ana', 'Ben'], {}, 1);
    expect(() => viewFor(s, 'p9')).toThrow(/Unknown player/);
  });
});
