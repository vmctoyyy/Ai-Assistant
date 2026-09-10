import type { GameState } from '../engine/types';
import { suitSymbol } from '../engine/deck';
import { currentPlayer, topCard } from '../engine/rules';
import { CardBack, CardView } from './CardView';

/**
 * The shared table: what is on the pile, what suit is live, how big the
 * pick-up has got, which way play is going and how many cards everyone holds.
 */
export function Board({ game }: { game: GameState }) {
  const top = topCard(game);
  const turn = currentPlayer(game);

  return (
    <section className="board">
      <div className="board-piles">
        <div className="pile">
          <CardBack count={game.drawPile.length} />
          <span className="pile-label">deck</span>
        </div>
        <div className="pile">
          {top ? <CardView card={top.card} as={top.as} size="lg" /> : null}
          <span className="pile-label">
            suit in play <strong className={`suit-${game.activeSuit}`}>{suitSymbol(game.activeSuit)}</strong>
          </span>
        </div>
      </div>

      {game.pickupCount > 0 ? (
        <div className={`pickup ${game.nuclear ? 'is-nuclear' : ''}`}>
          <span className="pickup-total">{game.pickupCount}</span>
          <span className="pickup-label">
            {game.nuclear ? 'nuclear pick-up' : 'to pick up'}
          </span>
        </div>
      ) : null}

      <ul className="seats">
        {game.players.map((p) => (
          <li key={p.id} className={p.id === turn.id ? 'seat is-turn' : 'seat'}>
            <span className="seat-name">{p.name}</span>
            <span className="seat-count">{p.hand.length}</span>
            {p.lastCardCalled ? <span className="seat-flag">Last Card</span> : null}
            {p.lastCardMissed ? <span className="seat-flag is-missed">missed the call</span> : null}
          </li>
        ))}
      </ul>

      <p className="direction">
        {game.direction === 1 ? '↻ play moves down the list' : '↺ play moves up the list'}
      </p>
    </section>
  );
}
