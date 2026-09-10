import { useState } from 'react';

import type { GameConfig } from '../engine/types';

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];

export function Setup({ onStart }: { onStart: (names: string[], config: Partial<GameConfig>) => void }) {
  const [count, setCount] = useState(3);
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [deckCount, setDeckCount] = useState<1 | 2>(2);
  const [handSize, setHandSize] = useState(7);

  const active = names.slice(0, count).map((n, i) => n.trim() || DEFAULT_NAMES[i]);

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="topbar-title">Last Card</h1>
      </header>

      <div className="scroll setup">
        <label className="field">
          <span>Players</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {Array.from({ length: count }, (_, i) => (
          <label className="field" key={i}>
            <span>Name {i + 1}</span>
            <input
              type="text"
              value={names[i]}
              onChange={(e) =>
                setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))
              }
            />
          </label>
        ))}

        <label className="field">
          <span>Decks</span>
          <select value={deckCount} onChange={(e) => setDeckCount(Number(e.target.value) as 1 | 2)}>
            <option value={2}>Two — 108 cards, 8s rule live</option>
            <option value={1}>One — 54 cards, no 8s, no jump-ins</option>
          </select>
        </label>

        <label className="field">
          <span>Cards each</span>
          <input
            type="number"
            inputMode="numeric"
            min={3}
            max={10}
            value={handSize}
            onChange={(e) => setHandSize(Number(e.target.value))}
          />
        </label>

        <p className="setup-note">
          One phone, passed around. Each player taps to reveal their own hand, and it is hidden
          again the moment their turn ends.
        </p>
      </div>

      <footer className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onStart(active, { deckCount, handSize })}
        >
          Deal
        </button>
      </footer>
    </div>
  );
}
