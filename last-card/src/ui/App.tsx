import { useState } from 'react';

import { currentPlayer, legalMoves, playerById } from '../engine/rules';
import type { Card, Move } from '../engine/types';
import { useGame } from '../state/useGame';
import { GameOver } from './GameOver';
import { Handover } from './Handover';
import { JumpInSheet } from './JumpInSheet';
import { MoveLog } from './MoveLog';
import { PenaltyDecision, PenaltyMenu } from './PenaltyMenu';
import { Setup } from './Setup';
import { Turn } from './Turn';

type Overlay = 'jumpIn' | 'penalty' | 'log' | null;

export default function App() {
  const g = useGame();
  const [overlay, setOverlay] = useState<Overlay>(null);

  const send = (move: Move) => {
    if (g.dispatch(move)) setOverlay(null);
  };

  if (!g.game) return <Setup onStart={g.start} />;
  const game = g.game;

  const turn = currentPlayer(game);
  const callable = g.lastCardWindow ? playerById(game, g.lastCardWindow.playerId) ?? null : null;

  const jumpIn = (playerId: string, card: Card) =>
    send({ kind: 'jumpIn', playerId, cards: [card] });

  const overlays = (
    <>
      {overlay === 'jumpIn' ? (
        <JumpInSheet game={game} onPlay={jumpIn} onCancel={() => setOverlay(null)} />
      ) : null}
      {overlay === 'penalty' ? (
        <PenaltyMenu
          game={game}
          onCancel={() => setOverlay(null)}
          onSubmit={(playerId, targetPlayerId, reason, amount) =>
            send({ kind: 'penalty', playerId, targetPlayerId, reason, amount })
          }
        />
      ) : null}
      {overlay === 'log' ? <MoveLog game={game} onClose={() => setOverlay(null)} /> : null}
      {game.pendingPenalty ? (
        <PenaltyDecision
          game={game}
          pending={game.pendingPenalty}
          onConfirm={() => send({ kind: 'confirmPenalty', playerId: game.pendingPenalty!.targetPlayerId })}
          onDecline={() => send({ kind: 'declinePenalty', playerId: game.pendingPenalty!.targetPlayerId })}
        />
      ) : null}
      {g.error ? (
        <div className="toast" role="alert" onClick={g.clearError}>
          {g.error}
        </div>
      ) : null}
    </>
  );

  if (game.phase === 'finished') {
    return (
      <>
        <GameOver
          game={game}
          jumpOutMsLeft={g.jumpOutMsLeft}
          onOpenJumpIn={() => setOverlay('jumpIn')}
          onOpenLog={() => setOverlay('log')}
          onRestart={g.restart}
        />
        {overlays}
      </>
    );
  }

  if (!g.revealed) {
    return (
      <>
        <Handover
          game={game}
          next={turn}
          callable={callable}
          msLeft={g.msLeft}
          onReveal={g.reveal}
          onCallLastCard={(playerId) => send({ kind: 'callLastCard', playerId })}
          onOpenJumpIn={() => setOverlay('jumpIn')}
          onOpenPenalty={() => setOverlay('penalty')}
          onOpenLog={() => setOverlay('log')}
        />
        {overlays}
      </>
    );
  }

  const kinds = new Set(legalMoves(game, turn.id).map((m) => m.kind));

  return (
    <>
      <Turn
        game={game}
        player={turn}
        canCallLastCard={kinds.has('callLastCard')}
        hasEights={kinds.has('declareEights')}
        onMove={send}
        onOpenJumpIn={() => setOverlay('jumpIn')}
        onOpenPenalty={() => setOverlay('penalty')}
        onOpenLog={() => setOverlay('log')}
      />
      {overlays}
    </>
  );
}
