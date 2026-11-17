import type { EloApi } from '../../state/useElo';
import { forDisplay } from '../../elo/elo';

export function Leaderboard({
  api,
  onAddPlayer,
  onRecordGame,
  onOpenPlayer,
  onImport,
  onBack,
}: {
  api: EloApi;
  onAddPlayer: () => void;
  onRecordGame: () => void;
  onOpenPlayer: (playerId: string) => void;
  onImport: () => void;
  onBack: () => void;
}) {
  const { standings } = api;

  return (
    <div>
      <h1>Rankings</h1>

      <div className="elo-bar">
        <button type="button" onClick={onAddPlayer}>
          Add player
        </button>
        <button type="button" onClick={onRecordGame} disabled={standings.length < 2}>
          Record game
        </button>
        <button type="button" onClick={api.exportBackup}>
          Export backup
        </button>
        <button type="button" onClick={onImport}>
          Import backup
        </button>
        <button type="button" onClick={onBack}>
          Back to game
        </button>
      </div>

      {standings.length === 0 ? (
        <p className="elo-empty">No players yet. Add one to start.</p>
      ) : (
        <table className="elo-table">
          <thead>
            <tr>
              <th className="elo-num">#</th>
              <th>Name</th>
              <th className="elo-num">Rating</th>
              <th className="elo-num">W</th>
              <th className="elo-num">L</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.playerId}>
                <td className="elo-num">{row.rank}</td>
                <td>
                  <button
                    type="button"
                    className="elo-linkbtn"
                    onClick={() => onOpenPlayer(row.playerId)}
                  >
                    {row.name}
                  </button>
                </td>
                <td className="elo-num">{forDisplay(row.rating)}</td>
                <td className="elo-num">{row.wins}</td>
                <td className="elo-num">{row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {standings.length === 1 ? (
        <p className="elo-note">Add a second player before recording a game.</p>
      ) : null}
    </div>
  );
}
