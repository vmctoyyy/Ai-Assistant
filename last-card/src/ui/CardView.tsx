import type { Card, Rank, Suit } from '../engine/types';
import { isRed, suitSymbol } from '../engine/deck';

interface Props {
  card: Card;
  /** For a joker on the pile: the card it was nominated as. */
  as?: { rank: Rank; suit: Suit };
  selected?: boolean;
  dimmed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onTap?: () => void;
  label?: string;
}

export function CardView({ card, as, selected, dimmed, size = 'md', onTap, label }: Props) {
  const joker = card.rank === 'JOKER';
  const suit = joker ? as?.suit ?? null : card.suit;
  const rank = joker ? as?.rank ?? null : card.rank;
  const classes = [
    'card',
    `card-${size}`,
    isRed(suit) ? 'card-red' : 'card-black',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
    onTap ? 'is-tappable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = joker ? (
    <>
      <span className="card-rank card-rank-joker">JOKER</span>
      {as ? (
        <span className="card-called">
          as {as.rank}
          {suitSymbol(as.suit)}
        </span>
      ) : (
        <span className="card-pip">★</span>
      )}
    </>
  ) : (
    <>
      <span className="card-rank">{rank}</span>
      <span className="card-pip">{suit ? suitSymbol(suit) : ''}</span>
    </>
  );

  if (!onTap) {
    return (
      <div className={classes} aria-label={label}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={classes} onClick={onTap} aria-pressed={!!selected} aria-label={label}>
      {body}
    </button>
  );
}

export function CardBack({ count }: { count: number }) {
  return (
    <div className="card card-md card-back">
      <span className="card-count">{count}</span>
    </div>
  );
}
