import { useRef, useState } from 'react';

import { useElo } from '../../state/useElo';
import { AddPlayer } from './AddPlayer';
import { Leaderboard } from './Leaderboard';
import { PlayerProfile } from './PlayerProfile';
import { RecordGame } from './RecordGame';
import './elo.css';

type Screen =
  | { name: 'leaderboard' }
  | { name: 'addPlayer' }
  | { name: 'recordGame' }
  | { name: 'player'; playerId: string };

/**
 * Screen switching by state, the same as the card game's App — this project
 * has no router and adding one for four screens would not earn its keep.
 */
export function EloApp({ onBack }: { onBack: () => void }) {
  const api = useElo();
  const [screen, setScreen] = useState<Screen>({ name: 'leaderboard' });
  const fileInput = useRef<HTMLInputElement>(null);

  const leaderboard = () => setScreen({ name: 'leaderboard' });

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file twice still fires
    if (!file) return;
    await api.importBackup(await file.text());
  }

  if (api.readiness.state === 'unconfigured') {
    return (
      <div className="elo elo-setup">
        <h1>Rankings</h1>
        <p className="elo-box">
          This needs a database, and it has not been set up yet. Nothing is saved until it is.
        </p>
        <p>
          The connection details go in <code>src/elo/config.ts</code>. See{' '}
          <strong>ELO-SETUP.md</strong> in the <code>last-card</code> folder for the steps and for
          exactly what the database rules allow.
        </p>
        <div className="elo-bar">
          <button type="button" onClick={onBack}>
            Back to game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="elo">
      {api.error ? (
        <div className="elo-error" role="alert">
          {api.error}{' '}
          <button type="button" onClick={api.clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {api.readiness.state === 'error' ? (
        <div className="elo-error" role="alert">
          {api.readiness.message} Nothing shown below may be up to date.
        </div>
      ) : null}

      {api.readiness.state === 'loading' ? <p className="elo-box">Loading…</p> : null}

      <input
        ref={fileInput}
        id="elo-import-file"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onFileChosen}
      />

      {screen.name === 'leaderboard' ? (
        <Leaderboard
          api={api}
          onAddPlayer={() => setScreen({ name: 'addPlayer' })}
          onRecordGame={() => setScreen({ name: 'recordGame' })}
          onOpenPlayer={(playerId) => setScreen({ name: 'player', playerId })}
          onImport={() => fileInput.current?.click()}
          onBack={onBack}
        />
      ) : null}

      {screen.name === 'addPlayer' ? <AddPlayer api={api} onDone={leaderboard} /> : null}
      {screen.name === 'recordGame' ? <RecordGame api={api} onDone={leaderboard} /> : null}
      {screen.name === 'player' ? (
        <PlayerProfile api={api} playerId={screen.playerId} onBack={leaderboard} />
      ) : null}
    </div>
  );
}
