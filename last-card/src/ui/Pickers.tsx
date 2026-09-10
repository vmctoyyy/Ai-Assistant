import { useState } from 'react';

import { STANDARD_RANKS, SUITS } from '../engine/types';
import type { Rank, Suit } from '../engine/types';
import { isRed, suitName, suitSymbol } from '../engine/deck';

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

/** Shown when a joker is played: it may stand in for any card in the game. */
export function JokerPicker({
  onPick,
  onCancel,
}: {
  onPick: (card: { rank: Rank; suit: Suit }) => void;
  onCancel: () => void;
}) {
  const [rank, setRank] = useState<Rank | null>(null);

  return (
    <Sheet title="The joker stands in for…" onCancel={onCancel}>
      <div className="rank-grid">
        {STANDARD_RANKS.map((r) => (
          <button
            key={r}
            type="button"
            className={`rank-btn ${rank === r ? 'is-on' : ''}`}
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
            disabled={!rank}
            onClick={() => rank && onPick({ rank, suit: s })}
          >
            <span className="suit-btn-pip">{suitSymbol(s)}</span>
            <span className="suit-btn-name">{suitName(s)}</span>
          </button>
        ))}
      </div>
      <p className="sheet-hint">
        {rank ? `Pick a suit for the ${rank}.` : 'Pick a rank, then a suit.'}
      </p>
    </Sheet>
  );
}
