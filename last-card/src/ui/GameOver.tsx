import type { GameState } from '../engine/types';
import { Board } from './Board';

export function GameOver({
  game,
  jumpOutMsLeft,
  onOpenJumpIn,
  onOpenLog,
  onRestart,
}: {
  game: GameState;
  jumpOutMsLeft: number;
  onOpenJumpIn: () => void;
  onOpenLog: () => void;
  onRestart: () => void;
}) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  const seconds = Math.ceil(jumpOutMsLeft / 1000);

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="topbar-title">{winner ? `${winner.name} is out` : 'Game over'}</h1>
        <button type="button" className="btn btn-tiny" onClick={onOpenLog}>
          Log
        </button>
      </header>

      <div className="scroll">
        <Board game={game} />
      </div>

      <footer className="actions">
        {game.jumpOutOpen ? (
          <>
            <button type="button" className="btn btn-shout" onClick={onOpenJumpIn}>
              Jump out — {seconds}
            </button>
            <p className="handover-hint">
              Anyone holding the exact same card can still take it, and the game reopens.
            </p>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onRestart}>
            New game
          </button>
        )}
      </footer>
    </div>
  );
}
