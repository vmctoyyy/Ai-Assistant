import { useState } from 'react';

import type { EloApi } from '../../state/useElo';

export function AddPlayer({ api, onDone }: { api: EloApi; onDone: () => void }) {
  const [name, setName] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const saved = await api.addPlayer(name);
    // Only leave the screen once the backend has it.
    if (saved) onDone();
  }

  return (
    <div>
      <h1>Add player</h1>
      <form onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            id="elo-player-name"
            type="text"
            value={name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="elo-bar">
          <button type="submit" disabled={api.busy}>
            {api.busy ? 'Saving…' : 'Add player'}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
      <p className="elo-note">Names must be different, ignoring capitals.</p>
    </div>
  );
}
