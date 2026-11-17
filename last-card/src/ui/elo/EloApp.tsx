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

const TITLES: Record<Screen['name'], string> = {
  leaderboard: 'Rankings',
  addPlayer: 'Add player',
  recordGame: 'Record game',
  player: 'Player',
};

/**
 * Screen switching by state, the same as the card game's App — this project
 * has no router and adding one for four screens would not earn its keep.
 *
 * The shell is the game's own: .screen, .topbar, .scroll and .actions, so
 * Rankings reads as part of the app rather than a page bolted on beside it.
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

  const onLeaderboard = screen.name === 'leaderboard';
  const title =
    screen.name === 'player'
      ? api.table.standings.get(screen.playerId)?.name ?? TITLES.player
      : TITLES[screen.name];

  if (api.readiness.state === 'unconfigured') {
    return (
      <div className="screen elo-screen elo-setup">
        <header className="topbar">
          <h1 className="topbar-title">Rankings</h1>
          <button type="button" className="btn btn-tiny" onClick={onBack}>
            Menu
          </button>
        </header>
        <div className="scroll">
          <p className="elo-box">
            This needs a database, and it has not been set up yet. Nothing is saved until it is.
          </p>
          <p className="elo-note">
            The connection details go in <code>src/elo/config.ts</code>. See ELO-SETUP.md in the
            last-card folder for the steps, and for exactly what the database rules allow.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen elo-screen">
      <header className="topbar">
        <h1 className="topbar-title">{title}</h1>
        <button
          type="button"
          className="btn btn-tiny"
          onClick={onLeaderboard ? onBack : leaderboard}
        >
          {onLeaderboard ? 'Menu' : 'Rankings'}
        </button>
      </header>

      {api.error ? (
        <div className="elo-error" role="alert">
          {api.error}
          <button type="button" className="btn btn-tiny" onClick={api.clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {api.readiness.state === 'error' ? (
        <div className="elo-error" role="alert">
          {api.readiness.message} Nothing shown below may be up to date.
        </div>
      ) : null}

      {api.readiness.state === 'loading' ? (
        <div className="scroll">
          <p className="elo-box">Loading…</p>
        </div>
      ) : null}

      <input
        ref={fileInput}
        id="elo-import-file"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onFileChosen}
      />

      {api.readiness.state !== 'loading' && screen.name === 'leaderboard' ? (
        <Leaderboard
          api={api}
          onAddPlayer={() => setScreen({ name: 'addPlayer' })}
          onRecordGame={() => setScreen({ name: 'recordGame' })}
          onOpenPlayer={(playerId) => setScreen({ name: 'player', playerId })}
          onImport={() => fileInput.current?.click()}
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
