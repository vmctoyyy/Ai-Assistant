import { useState } from 'react';

import { STANDARD_RANKS, SUITS } from '../engine/types';
import type { GameState, Rank, Suit } from '../engine/types';
import { isRed, suitName, suitSymbol } from '../engine/deck';
import { nominationPlayability } from '../engine/rules';

export function Sheet({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="sheet-title">{title}</h2>
        {children}
        {onCancel ? (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Shown when an ace is played outside a pick-up. */
export function SuitPicker({
  onPick,
  onCancel,
}: {
  onPick: (suit: Suit) => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title="Call a suit" onCancel={onCancel}>
      <div className="suit-grid">
        {SUITS.map((s) => (
          <button
            key={s}
            type="button"
            className={`suit-btn ${isRed(s) ? 'is-red' : 'is-black'}`}
            onClick={() => onPick(s)}
          >
            <span className="suit-btn-pip">{suitSymbol(s)}</span>
            <span className="suit-btn-name">{suitName(s)}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Shown when a joker is played. A joker stands in for a card that could have
 * been played, so anything illegal is unpickable here rather than accepted and
 * then rejected — the rule is easier to see than to be told.
 */
export function JokerPicker({
  state,
  onPick,
  onCancel,
}: {
  state: GameState;
  onPick: (card: { rank: Rank; suit: Suit }) => void;
  onCancel: () => void;
}) {
  const [rank, setRank] = useState<Rank | null>(null);

  const allowed = (r: Rank, s: Suit) => nominationPlayability(state, { rank: r, suit: s }).ok;
  const rankAllowed = (r: Rank) => SUITS.some((s) => allowed(r, s));

  return (
    <Sheet title="The joker stands in for…" onCancel={onCancel}>
      <div className="rank-grid">
        {STANDARD_RANKS.map((r) => (
          <button
            key={r}
            type="button"
            className={`rank-btn ${rank === r ? 'is-on' : ''}`}
            disabled={!rankAllowed(r)}
            onClick={() => setRank(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="suit-grid">
        {SUITS.map((s) => (
          <button
            key={s}
            type="button"
            className={`suit-btn ${isRed(s) ? 'is-red' : 'is-black'}`}
            disabled={!rank || !allowed(rank, s)}
            onClick={() => rank && allowed(rank, s) && onPick({ rank, suit: s })}
          >
            <span className="suit-btn-pip">{suitSymbol(s)}</span>
            <span className="suit-btn-name">{suitName(s)}</span>
          </button>
        ))}
      </div>
      <p className="sheet-hint">
        {rank
          ? `Pick a suit for the ${rank}.`
          : state.pickupCount > 0
            ? `A pick-up of ${state.pickupCount} is running, so the joker has to be a 2, 5, 7, 10 or jack.`
            : `It can only be a card you could have played: a ${state.activeRank}, or a ${suitName(state.activeSuit)}.`}
      </p>
    </Sheet>
  );
}
