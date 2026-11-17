import { Pip } from './Pips';

/**
 * The title screen.
 *
 * The app used to open straight into player setup, which meant the rankings
 * were reached from inside a half-filled form. This is the home now: the two
 * things you can do, and nothing else.
 */
export function Menu({ onPlay, onRankings }: { onPlay: () => void; onRankings: () => void }) {
  return (
    <div className="screen menu">
      <div className="menu-body">
        <h1 className="menu-title">Last Card</h1>
        <p className="menu-suits" aria-hidden="true">
          <Pip suit="heart" className="menu-pip is-red" />
          <Pip suit="spade" className="menu-pip" />
          <Pip suit="diamond" className="menu-pip is-red" />
          <Pip suit="club" className="menu-pip" />
        </p>
      </div>

      <footer className="actions">
        <button type="button" className="btn btn-primary btn-menu" onClick={onPlay}>
          Play
        </button>
        <button type="button" className="btn btn-secondary btn-menu" onClick={onRankings}>
          Rankings
        </button>
      </footer>
    </div>
  );
}
