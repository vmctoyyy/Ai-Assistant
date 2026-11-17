import { useState } from 'react';

import { forDisplay, formatDelta, winPercent } from '../../elo/elo';
import type { EloApi } from '../../state/useElo';

function when(millis: number): string {
  return new Date(millis).toLocaleDateString();
}

export function PlayerProfile({
  api,
  playerId,
  onBack,
}: {
  api: EloApi;
  playerId: string;
  onBack: () => void;
}) {
  const [confirmingGame, setConfirmingGame] = useState<string | null>(null);
  const [confirmingPlayer, setConfirmingPlayer] = useState(false);

  const standing = api.table.standings.get(playerId);
  if (!standing) {
    return (
      <div>
        <h1>Player</h1>
        <p className="elo-empty">That player is no longer in the rankings.</p>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const games = api.gamesFor(playerId);
  const h2h = api.headToHeadFor(playerId);
  const percent = winPercent(standing.wins, standing.losses);
  const liveGames = api.liveGamesFor(playerId);
  const nameOf = (id: string) => api.table.standings.get(id)?.name ?? 'Unknown';

  return (
    <div>
      <h1>{standing.name}</h1>

      <div className="elo-box">
        <p>Rating {forDisplay(standing.rating)}</p>
        <p>
          {standing.wins} won, {standing.losses} lost
          {percent === null ? '' : ` — ${percent.toFixed(0)}% wins`}
        </p>
      </div>

      <h2>Against each opponent</h2>
      {h2h.length === 0 ? (
        <p className="elo-empty">No games yet.</p>
      ) : (
        <table className="elo-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th className="elo-num">W</th>
              <th className="elo-num">L</th>
            </tr>
          </thead>
          <tbody>
            {h2h.map((row) => (
              <tr key={row.opponentId}>
                <td>{row.opponentName}</td>
                <td className="elo-num">{row.wins}</td>
                <td className="elo-num">{row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Games</h2>
      {games.length === 0 ? (
        <p className="elo-empty">No games yet.</p>
      ) : (
        <ul className="elo-list">
          {games.map((game) => {
            const change = api.table.changesByGame
              .get(game.id)
              ?.find((c) => c.playerId === playerId);
            const won = game.winnerId === playerId;
            const opponents = won ? game.loserIds : [game.winnerId];

            return (
              <li key={game.id}>
                <div>
                  {when(game.playedAt)} — {won ? 'Won' : 'Lost'} v{' '}
                  {opponents.map(nameOf).join(', ')}
                  {change ? ` (${formatDelta(change.delta)})` : ''}
                </div>
                {confirmingGame === game.id ? (
                  <div className="elo-bar">
                    <button
                      type="button"
                      disabled={api.busy}
                      onClick={async () => {
                        await api.deleteGame(game.id);
                        setConfirmingGame(null);
                      }}
                    >
                      Yes, delete this game
                    </button>
                    <button type="button" onClick={() => setConfirmingGame(null)}>
                      Keep it
                    </button>
                  </div>
                ) : (
                  <div className="elo-bar">
                    <button type="button" onClick={() => setConfirmingGame(game.id)}>
                      Delete game
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h2>Player</h2>
      {liveGames > 0 ? (
        <p className="elo-note">
          This player has {liveGames} game{liveGames === 1 ? '' : 's'}. Delete those first to
          remove them.
        </p>
      ) : confirmingPlayer ? (
        <div className="elo-bar">
          <button
            type="button"
            disabled={api.busy}
            onClick={async () => {
              const done = await api.deletePlayer(playerId);
              setConfirmingPlayer(false);
              if (done !== null) onBack();
            }}
          >
            Yes, delete {standing.name}
          </button>
          <button type="button" onClick={() => setConfirmingPlayer(false)}>
            Keep them
          </button>
        </div>
      ) : (
        <div className="elo-bar">
          <button type="button" onClick={() => setConfirmingPlayer(true)}>
            Delete player
          </button>
        </div>
      )}

      <div className="elo-bar">
        <button type="button" onClick={onBack}>
          Back to rankings
        </button>
      </div>
    </div>
  );
}
