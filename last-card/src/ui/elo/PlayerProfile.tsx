import { useState } from 'react';

import { forDisplay, winPercent } from '../../elo/elo';
import { prettyDelta } from './delta';
import type { EloApi } from '../../state/useElo';

function when(millis: number): string {
  return new Date(millis).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
      <div className="scroll">
        <p className="elo-empty">That player is no longer in the rankings.</p>
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          Back to rankings
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
    <>
      <div className="scroll">
        <div className="elo-hero">
          <span className="elo-hero-rating">{forDisplay(standing.rating)}</span>
          <span className="elo-hero-meta">
            <div>
              {standing.wins} won · {standing.losses} lost
            </div>
            <div>
              {percent === null ? 'No games yet' : `${percent.toFixed(0)}% wins`} · rank{' '}
              {standing.rank}
            </div>
          </span>
        </div>

        <h2 className="elo-h2">Head to head</h2>
        {h2h.length === 0 ? (
          <p className="elo-empty">No games yet.</p>
        ) : (
          <table className="elo-table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th className="elo-num">W/L</th>
              </tr>
            </thead>
            <tbody>
              {h2h.map((row) => (
                <tr key={row.opponentId}>
                  <td className="elo-name">{row.opponentName}</td>
                  <td className="elo-record">
                    {row.wins}–{row.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="elo-h2">Games</h2>
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
                  <div className="elo-game">
                    <span className="elo-game-what">
                      <span className="elo-outcome">{won ? 'Won' : 'Lost'}</span> v{' '}
                      {opponents.map(nameOf).join(', ')}
                      <span className="elo-game-when">{when(game.playedAt)}</span>
                    </span>
                    {change ? (
                      <span className={`elo-delta ${change.delta >= 0 ? 'elo-up' : 'elo-down'}`}>
                        {prettyDelta(change.delta)}
                      </span>
                    ) : null}
                  </div>

                  {confirmingGame === game.id ? (
                    <div className="elo-inline">
                      <button
                        type="button"
                        className="btn btn-shout btn-tiny"
                        disabled={api.busy}
                        onClick={async () => {
                          await api.deleteGame(game.id);
                          setConfirmingGame(null);
                        }}
                      >
                        Yes, delete this game
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-tiny"
                        onClick={() => setConfirmingGame(null)}
                      >
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <div className="elo-inline">
                      <button
                        type="button"
                        className="btn btn-quiet btn-tiny"
                        onClick={() => setConfirmingGame(game.id)}
                      >
                        Delete game
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <h2 className="elo-h2">This player</h2>
        {liveGames > 0 ? (
          <p className="elo-note">
            {standing.name} has {liveGames} game{liveGames === 1 ? '' : 's'} on record. Delete
            those first to remove them.
          </p>
        ) : confirmingPlayer ? (
          <div className="elo-inline">
            <button
              type="button"
              className="btn btn-shout btn-tiny"
              disabled={api.busy}
              onClick={async () => {
                const done = await api.deletePlayer(playerId);
                setConfirmingPlayer(false);
                if (done !== null) onBack();
              }}
            >
              Yes, delete {standing.name}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              onClick={() => setConfirmingPlayer(false)}
            >
              Keep them
            </button>
          </div>
        ) : (
          <div className="elo-inline">
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              onClick={() => setConfirmingPlayer(true)}
            >
              Delete player
            </button>
          </div>
        )}
      </div>

      <footer className="actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to rankings
        </button>
      </footer>
    </>
  );
}
