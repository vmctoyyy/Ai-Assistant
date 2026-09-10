import { useState } from 'react';

import type { Card, GameState } from '../engine/types';
import { cardLabel } from '../engine/deck';
import { jumpInCards, topCard } from '../engine/rules';
import { CardView, Sheet } from './index-parts';

/**
 * A jump-in can come from anyone at any time. On one phone that means asking
 * who is claiming it before any hand is shown.
 */
export function JumpInSheet({
  game,
  onPlay,
  onCancel,
}: {
  game: GameState;
  onPlay: (playerId: string, card: Card) => void;
  onCancel: () => void;
}) {
  const [who, setWho] = useState<string | null>(null);
  const top = topCard(game);
  const matches = who ? jumpInCards(game, who) : [];

  if (!who) {
    return (
      <Sheet title="Who is jumping in?" onCancel={onCancel}>
        <p className="sheet-hint">
          The top card is {top ? cardLabel(top.card) : 'nothing'}. You need the very same card.
        </p>
        <div className="player-grid">
          {game.players.map((p) => (
            <button key={p.id} type="button" className="btn btn-choice" onClick={() => setWho(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  const player = game.players.find((p) => p.id === who)!;
  return (
    <Sheet title={`${player.name} jumping in`} onCancel={onCancel}>
      {matches.length === 0 ? (
        <p className="sheet-body">
          {player.name} is not holding {top ? cardLabel(top.card) : 'a match'}.
        </p>
      ) : (
        <div className="hand-row">
          {matches.map((card) => (
            <CardView key={card.id} card={card} size="lg" onTap={() => onPlay(who, card)} />
          ))}
        </div>
      )}
      <button type="button" className="btn btn-quiet" onClick={() => setWho(null)}>
        Someone else
      </button>
    </Sheet>
  );
}
