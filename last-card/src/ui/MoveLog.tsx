import type { GameState } from '../engine/types';
import { Sheet } from './Pickers';

/** A plain record of what happened, so a disagreement can be settled. */
export function MoveLog({ game, onClose }: { game: GameState; onClose: () => void }) {
  const entries = game.log.slice().reverse();
  return (
    <Sheet title="Move log" onCancel={onClose}>
      <ol className="log">
        {entries.map((e) => (
          <li key={e.seq} className="log-entry">
            <span className="log-seq">{e.seq + 1}</span>
            <span className="log-text">{e.text}</span>
          </li>
        ))}
        {entries.length === 0 ? <li className="log-entry">Nothing yet.</li> : null}
      </ol>
    </Sheet>
  );
}
