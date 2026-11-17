import { useState } from 'react';

import { forDisplay, formatDelta } from '../../elo/elo';
import type { RatingChange } from '../../elo/types';
import type { EloApi } from '../../state/useElo';

export function RecordGame({ api, onDone }: { api: EloApi; onDone: () => void }) {
  const players = api.standings;
  const [winnerId, setWinnerId] = useState('');
  const [loserId, setLoserId] = useState('');
  const [savedGameId, setSavedGameId] = useState<string | null>(null);

  // Derived from the replay, so what is shown is what was actually recorded —
  // not a guess made before the write landed.
  const changes: RatingChange[] | undefined = savedGameId
    ? api.table.changesByGame.get(savedGameId)
    : undefined;

  const nameOf = (id: string) => players.find((p) => p.playerId === id)?.name ?? 'Unknown';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const game = await api.recordGame(winnerId, loserId);
    if (game) setSavedGameId(game.id);
  }

  if (savedGameId) {
    return (
      <div>
        <h1>Result recorded</h1>
        {changes ? (
          <div className="elo-box">
            {changes.map((c) => (
              <p key={c.playerId}>
                {nameOf(c.playerId)} {forDisplay(c.before)} -&gt; {forDisplay(c.after)} (
                {formatDelta(c.delta)})
              </p>
            ))}
          </div>
        ) : (
          <p className="elo-box">Saved. Working out the new ratings…</p>
        )}
        <div className="elo-bar">
          <button
            type="button"
            onClick={() => {
              setSavedGameId(null);
              setWinnerId('');
              setLoserId('');
            }}
          >
            Record another
          </button>
          <button type="button" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Record game</h1>
      <form onSubmit={submit}>
        <label>
          <span>Winner</span>
          <select id="elo-winner" value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
            <option value="">Choose…</option>
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Loser</span>
          <select id="elo-loser" value={loserId} onChange={(e) => setLoserId(e.target.value)}>
            <option value="">Choose…</option>
            {players
              .filter((p) => p.playerId !== winnerId)
              .map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>

        <div className="elo-bar">
          <button type="submit" disabled={api.busy || !winnerId || !loserId}>
            {api.busy ? 'Saving…' : 'Record result'}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
      <p className="elo-note">One winner, one loser. No draws.</p>
    </div>
  );
}
