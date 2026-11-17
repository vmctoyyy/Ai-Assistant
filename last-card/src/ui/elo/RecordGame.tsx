import { useState } from 'react';

import { forDisplay } from '../../elo/elo';
import { prettyDelta } from './delta';
import type { RatingChange } from '../../elo/types';
import type { EloApi } from '../../state/useElo';

const FORM_ID = 'elo-record-game';

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
      <>
        <div className="scroll elo-centre">
          {changes ? (
            <div className="elo-result elo-box">
              {changes.map((c) => (
                <div className="elo-result-row" key={c.playerId}>
                  <span className="elo-result-name">{nameOf(c.playerId)}</span>
                  <span className="elo-result-move">
                    {forDisplay(c.before)} → <strong>{forDisplay(c.after)}</strong>
                    <span className={`elo-delta ${c.delta >= 0 ? 'elo-up' : 'elo-down'}`}>
                      {prettyDelta(c.delta)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="elo-box">Saved. Working out the new ratings…</p>
          )}
        </div>

        <footer className="actions">
          <div className="actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSavedGameId(null);
                setWinnerId('');
                setLoserId('');
              }}
            >
              Record another
            </button>
            <button type="button" className="btn btn-primary" onClick={onDone}>
              Done
            </button>
          </div>
        </footer>
      </>
    );
  }

  return (
    <>
      <div className="scroll">
        <form id={FORM_ID} onSubmit={submit}>
          <label className="elo-field">
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

          <label className="elo-field">
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
        </form>
        <p className="elo-note">One winner, one loser. No draws.</p>
      </div>

      <footer className="actions">
        <div className="actions-row">
          <button
            type="submit"
            form={FORM_ID}
            className="btn btn-primary"
            disabled={api.busy || !winnerId || !loserId}
          >
            {api.busy ? 'Saving…' : 'Record result'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onDone}>
            Cancel
          </button>
        </div>
      </footer>
    </>
  );
}
