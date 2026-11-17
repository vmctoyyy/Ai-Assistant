import { useState } from 'react';

import type { EloApi } from '../../state/useElo';

const FORM_ID = 'elo-add-player';

export function AddPlayer({ api, onDone }: { api: EloApi; onDone: () => void }) {
  const [name, setName] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const saved = await api.addPlayer(name);
    // Only leave the screen once the backend has it.
    if (saved) onDone();
  }

  return (
    <>
      <div className="scroll">
        {/* The submit button lives in the footer, tied back by `form`, so the
            layout keeps the app's header/body/footer shape. */}
        <form id={FORM_ID} onSubmit={submit}>
          <label className="elo-field">
            <span>Name</span>
            <input
              id="elo-player-name"
              type="text"
              value={name}
              autoComplete="off"
              autoCapitalize="words"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </form>
        <p className="elo-note">Two players cannot share a name, ignoring capitals.</p>
      </div>

      <footer className="actions">
        <div className="actions-row">
          <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={api.busy}>
            {api.busy ? 'Saving…' : 'Add player'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onDone}>
            Cancel
          </button>
        </div>
      </footer>
    </>
  );
}
