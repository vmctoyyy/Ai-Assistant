import { forDisplay } from '../../elo/elo';
import type { EloApi } from '../../state/useElo';

export function Leaderboard({
  api,
  onAddPlayer,
  onRecordGame,
  onOpenPlayer,
  onImport,
}: {
  api: EloApi;
  onAddPlayer: () => void;
  onRecordGame: () => void;
  onOpenPlayer: (playerId: string) => void;
  onImport: () => void;
}) {
  const { standings } = api;

  return (
    <>
      <div className="scroll elo-stack">
        {standings.length === 0 ? (
          <p className="elo-empty">No players yet. Add one to start.</p>
        ) : (
          <table className="elo-table">
            <thead>
              <tr>
                <th className="elo-rank">#</th>
                <th>Player</th>
                <th className="elo-num">Rating</th>
                <th className="elo-num">W/L</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr key={row.playerId} className={row.rank === 1 ? 'elo-row-lead' : undefined}>
                  <td className="elo-rank">{row.rank}</td>
                  <td>
                    <button
                      type="button"
                      className="elo-name elo-linkbtn"
                      onClick={() => onOpenPlayer(row.playerId)}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="elo-rating">{forDisplay(row.rating)}</td>
                  <td className="elo-record">
                    {row.wins}–{row.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {standings.length === 1 ? (
          <p className="elo-note">Add a second player before recording a game.</p>
        ) : null}

        <h2 className="elo-h2 elo-footnote">Backup</h2>
        <div className="elo-inline">
          <button type="button" className="btn btn-quiet" onClick={api.exportBackup}>
            Export backup
          </button>
          <button type="button" className="btn btn-quiet" onClick={onImport}>
            Import backup
          </button>
        </div>
        <p className="elo-note">
          An export holds every player and game, deleted ones included. Nothing here is ever
          destroyed, so a backup is how you undo a mess.
        </p>
      </div>

      <footer className="actions">
        <div className="actions-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRecordGame}
            disabled={api.standings.length < 2}
          >
            Record game
          </button>
          <button type="button" className="btn btn-secondary" onClick={onAddPlayer}>
            Add player
          </button>
        </div>
      </footer>
    </>
  );
}
