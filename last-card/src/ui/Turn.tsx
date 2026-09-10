import { useMemo, useState } from 'react';

import type { Card, GameState, Move, Player, Rank, Suit } from '../engine/types';
import { cardLabel } from '../engine/deck';
import { isCardPlayable, isPickupActive } from '../engine/rules';
import { Board } from './Board';
import { CardView, JokerPicker, SuitPicker } from './index-parts';

interface Props {
  game: GameState;
  player: Player;
  canCallLastCard: boolean;
  hasEights: boolean;
  onMove: (move: Move) => void;
  onOpenJumpIn: () => void;
  onOpenPenalty: () => void;
  onOpenLog: () => void;
}

type Nomination = { calledSuit?: Suit; calledCard?: { rank: Rank; suit: Suit } };

export function Turn({
  game,
  player,
  canCallLastCard,
  hasEights,
  onMove,
  onOpenJumpIn,
  onOpenPenalty,
  onOpenLog,
}: Props) {
  const [selected, setSelected] = useState<Card[]>([]);
  const [asking, setAsking] = useState<'suit' | 'joker' | null>(null);

  const drawn = useMemo(() => {
    if (game.phase !== 'awaitingDrawChoice' || !game.pendingDraw) return null;
    return player.hand.find((c) => c.id === game.pendingDraw!.cardId) ?? null;
  }, [game, player]);

  const chain = isPickupActive(game);

  function toggle(card: Card) {
    setSelected((prev) => {
      if (prev.some((c) => c.id === card.id)) return prev.filter((c) => c.id !== card.id);
      if (prev.length === 0) return [card];
      // Jokers need their own nomination, so keep them out of groups here.
      if (card.rank === 'JOKER' || prev[0].rank === 'JOKER') return [card];
      if (prev[0].rank !== card.rank) return [card];
      return [...prev, card];
    });
  }

  function send(nomination: Nomination = {}) {
    onMove({ kind: 'play', playerId: player.id, cards: selected, ...nomination });
    setSelected([]);
    setAsking(null);
  }

  function attemptPlay() {
    if (selected.length === 0) return;
    if (selected.some((c) => c.rank === 'JOKER')) return setAsking('joker');
    if (selected.some((c) => c.rank === 'A') && !chain) return setAsking('suit');
    send();
  }

  function playDrawn(nomination: Nomination = {}) {
    if (!drawn) return;
    onMove({ kind: 'playDrawnCard', playerId: player.id, card: drawn, ...nomination });
    setAsking(null);
  }

  function attemptPlayDrawn() {
    if (!drawn) return;
    if (drawn.rank === 'JOKER') return setAsking('joker');
    if (drawn.rank === 'A' && !chain) return setAsking('suit');
    playDrawn();
  }

  const sorted = useMemo(
    () => player.hand.slice().sort((a, b) => a.id.localeCompare(b.id)),
    [player.hand],
  );

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="topbar-title">{player.name}</h1>
        <button type="button" className="btn btn-tiny" onClick={onOpenLog}>
          Log
        </button>
      </header>

      <div className="scroll">
        <Board game={game} />

        {drawn ? (
          <section className="drawn">
            <p className="drawn-title">You drew {cardLabel(drawn)} — Pick and Play?</p>
            <div className="drawn-row">
              <CardView card={drawn} size="lg" />
              <div className="drawn-actions">
                <button type="button" className="btn btn-primary" onClick={attemptPlayDrawn}>
                  Play it
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => onMove({ kind: 'pass', playerId: player.id })}
                >
                  Keep it
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="hand">
          <h2 className="hand-title">Your hand — {player.hand.length}</h2>
          <div className="hand-row">
            {sorted.map((card) => (
              <CardView
                key={card.id}
                card={card}
                size="md"
                label={cardLabel(card)}
                selected={selected.some((c) => c.id === card.id)}
                dimmed={!drawn && !isCardPlayable(game, card)}
                onTap={drawn ? undefined : () => toggle(card)}
              />
            ))}
          </div>
        </section>
      </div>

      <footer className="actions">
        {canCallLastCard ? (
          <button
            type="button"
            className="btn btn-shout"
            onClick={() => onMove({ kind: 'callLastCard', playerId: player.id })}
          >
            Last Card!
          </button>
        ) : null}

        {hasEights ? (
          <button
            type="button"
            className="btn btn-shout"
            onClick={() => onMove({ kind: 'declareEights', playerId: player.id })}
          >
            Call 8s — instant win
          </button>
        ) : null}

        {!drawn ? (
          <div className="actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={selected.length === 0}
              onClick={attemptPlay}
            >
              {selected.length > 1 ? `Play ${selected.length} cards` : 'Play'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onMove({ kind: 'draw', playerId: player.id })}
            >
              {chain ? `Pick up ${game.pickupCount}` : 'Draw'}
            </button>
          </div>
        ) : null}

        <div className="actions-row">
          <button type="button" className="btn btn-quiet" onClick={onOpenJumpIn}>
            Jump in
          </button>
          <button type="button" className="btn btn-quiet" onClick={onOpenPenalty}>
            Penalty
          </button>
        </div>
      </footer>

      {asking === 'suit' ? (
        <SuitPicker
          onCancel={() => setAsking(null)}
          onPick={(suit) => (drawn ? playDrawn({ calledSuit: suit }) : send({ calledSuit: suit }))}
        />
      ) : null}
      {asking === 'joker' ? (
        <JokerPicker
          onCancel={() => setAsking(null)}
          onPick={(card) => (drawn ? playDrawn({ calledCard: card }) : send({ calledCard: card }))}
        />
      ) : null}
    </div>
  );
}
