import type { GameState, Player } from '../engine/types';
import { Board } from './Board';

/**
 * Pass-and-play privacy. Nothing from the incoming player's hand is on screen
 * until they tap. When somebody has just played down to their last card, the
 * hand-over is held for a beat so the call can still be made.
 */
export function Handover({
  game,
  next,
  callable,
  msLeft,
  onReveal,
  onCallLastCard,
  onOpenJumpIn,
  onOpenPenalty,
  onOpenLog,
}: {
  game: GameState;
  next: Player;
  /** The player whose Last Card window is still open, if any. */
  callable: Player | null;
  msLeft: number;
  onReveal: () => void;
  onCallLastCard: (playerId: string) => void;
  onOpenJumpIn: () => void;
  onOpenPenalty: () => void;
  onOpenLog: () => void;
}) {
  const held = callable !== null && msLeft > 0;
  const seconds = Math.ceil(msLeft / 1000);

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="topbar-title">Pass the phone</h1>
        <button type="button" className="btn btn-tiny" onClick={onOpenLog}>
          Log
        </button>
      </header>

      <div className="scroll">
        <Board game={game} />
      </div>

      <footer className="actions">
        {held && callable ? (
          <>
            <button
              type="button"
              className="btn btn-shout"
              onClick={() => onCallLastCard(callable.id)}
            >
              {callable.name} — Last Card! ({seconds})
            </button>
            <p className="handover-hint">
              Call it before the next player moves, or the win will not count.
            </p>
          </>
        ) : null}

        <button type="button" className="btn btn-reveal" disabled={held} onClick={onReveal}>
          {held ? `Hold — ${seconds}` : `Tap to reveal ${next.name}'s hand`}
        </button>

        <div className="actions-row">
          <button type="button" className="btn btn-quiet" onClick={onOpenJumpIn}>
            Jump in
          </button>
          <button type="button" className="btn btn-quiet" onClick={onOpenPenalty}>
            Penalty
          </button>
        </div>
      </footer>
    </div>
  );
}
