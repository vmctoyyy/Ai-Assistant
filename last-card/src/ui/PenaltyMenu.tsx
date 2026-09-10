import { useState } from 'react';

import type { GameState, PendingPenalty } from '../engine/types';
import { Sheet } from './Pickers';

const REASONS = [
  'Incorrect play',
  'Dropped a card off the table',
  'Dropped a card face up on the table',
  'Disrespectful use of the cards',
  'Disrupting the game',
  'Shuffling infringement (+2 per card)',
  'Dealer looked at their cards first',
  'Dealer was too slow to deal',
  'Dealer did not shuffle enough',
];

/** Most penalties are table offences, so any player can raise one on anyone. */
export function PenaltyMenu({
  game,
  onSubmit,
  onCancel,
}: {
  game: GameState;
  onSubmit: (byPlayerId: string, targetPlayerId: string, reason: string, amount: number) => void;
  onCancel: () => void;
}) {
  const [by, setBy] = useState(game.players[0].id);
  const [chosenTarget, setChosenTarget] = useState(game.players[1].id);
  const [reason, setReason] = useState(REASONS[0]);
  const [amount, setAmount] = useState(game.config.defaultPenalty);

  // You cannot penalise yourself, so the target follows whoever is accusing.
  const targets = game.players.filter((p) => p.id !== by);
  const target = targets.some((p) => p.id === chosenTarget) ? chosenTarget : targets[0].id;

  return (
    <Sheet title="Call a penalty" onCancel={onCancel}>
      <label className="field">
        <span>Called by</span>
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          {game.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Against</span>
        <select value={target} onChange={(e) => setChosenTarget(e.target.value)}>
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Cards (negotiable)</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={25}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSubmit(by, target, reason, amount)}
      >
        Propose penalty
      </button>
      <p className="sheet-hint">Nothing is picked up until the table agrees.</p>
    </Sheet>
  );
}

export function PenaltyDecision({
  game,
  pending,
  onConfirm,
  onDecline,
}: {
  game: GameState;
  pending: PendingPenalty;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const by = game.players.find((p) => p.id === pending.byPlayerId)!;
  const target = game.players.find((p) => p.id === pending.targetPlayerId)!;

  return (
    <Sheet title="Penalty proposed">
      <p className="sheet-body">
        {by.name} says {target.name} should pick up {pending.amount}.
      </p>
      <p className="sheet-body sheet-reason">{pending.reason}</p>
      <p className="sheet-hint">{target.name} gets to answer before anything is picked up.</p>
      <button type="button" className="btn btn-primary" onClick={onConfirm}>
        Apply — {target.name} picks up {pending.amount}
      </button>
      <button type="button" className="btn btn-quiet" onClick={onDecline}>
        Dismiss it
      </button>
    </Sheet>
  );
}
