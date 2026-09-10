/**
 * Glue between the pure engine and React. Everything here is presentation
 * bookkeeping — whose hand is on screen, which timer is running, what the last
 * error was. No rules live in this file.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { applyMove, createGame, currentPlayer } from '../engine/rules';
import { IllegalMoveError } from '../engine/types';
import type { GameConfig, GameState, Move } from '../engine/types';

/** Moves that end a turn, and therefore shut somebody else's Last Card window. */
const TURN_MOVES: ReadonlySet<Move['kind']> = new Set([
  'play',
  'draw',
  'playDrawnCard',
  'pass',
  'jumpIn',
]);

export interface LastCardWindow {
  playerId: string;
  endsAt: number;
}

export interface GameApi {
  game: GameState | null;
  /** True once the player whose turn it is has tapped to reveal their hand. */
  revealed: boolean;
  error: string | null;
  lastCardWindow: LastCardWindow | null;
  /** Milliseconds left in whichever timed window is running, or 0. */
  msLeft: number;
  jumpOutMsLeft: number;
  start: (names: string[], config: Partial<GameConfig>) => void;
  dispatch: (move: Move) => boolean;
  reveal: () => void;
  hide: () => void;
  clearError: () => void;
  restart: () => void;
}

/** `?seed=123` pins the deal, so a browser test can rely on a known hand. */
function forcedSeed(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n > 0 ? n >>> 0 : null;
}

export function useGame(): GameApi {
  const [game, setGame] = useState<GameState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCardWindow, setLastCardWindow] = useState<LastCardWindow | null>(null);
  const [jumpOutEndsAt, setJumpOutEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const timing = lastCardWindow !== null || jumpOutEndsAt !== null;
  useEffect(() => {
    if (!timing) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [timing]);

  const msLeft = lastCardWindow ? Math.max(0, lastCardWindow.endsAt - now) : 0;
  const jumpOutMsLeft = jumpOutEndsAt ? Math.max(0, jumpOutEndsAt - now) : 0;

  // Drop a spent Last Card window so the next player is not held up.
  useEffect(() => {
    if (lastCardWindow && msLeft === 0) setLastCardWindow(null);
  }, [lastCardWindow, msLeft]);

  const start = useCallback((names: string[], config: Partial<GameConfig>) => {
    const seed = forcedSeed() ?? ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    setGame(createGame(names, config, seed));
    setRevealed(false);
    setError(null);
    setLastCardWindow(null);
    setJumpOutEndsAt(null);
  }, []);

  const dispatch = useCallback(
    (move: Move): boolean => {
      if (!game) return false;
      let next: GameState;
      try {
        next = applyMove(game, move);
      } catch (e) {
        setError(e instanceof IllegalMoveError ? e.message : String(e));
        return false;
      }

      setError(null);
      setGame(next);

      if (move.kind === 'callLastCard') {
        setLastCardWindow(null);
      } else if (TURN_MOVES.has(move.kind) && 'playerId' in move) {
        const mover = next.players.find((p) => p.id === move.playerId);
        if (mover && mover.lastCardEligible && !mover.lastCardCalled) {
          setLastCardWindow({ playerId: mover.id, endsAt: Date.now() + next.config.lastCardWindowMs });
        } else {
          setLastCardWindow(null);
        }
      }

      if (next.phase === 'finished' && next.jumpOutOpen) {
        setJumpOutEndsAt(Date.now() + next.config.jumpOutWindowMs);
      } else {
        setJumpOutEndsAt(null);
      }

      // Hide the hand again whenever the phone should change hands.
      const handedOver =
        next.currentPlayerIndex !== game.currentPlayerIndex || next.phase === 'finished';
      if (handedOver) setRevealed(false);
      return true;
    },
    [game],
  );

  // Close the jump-out window through the engine once it lapses.
  useEffect(() => {
    if (!game || game.phase !== 'finished' || !game.jumpOutOpen) return;
    if (jumpOutEndsAt === null || jumpOutMsLeft > 0) return;
    setJumpOutEndsAt(null);
    setGame(applyMove(game, { kind: 'closeJumpOut' }));
  }, [game, jumpOutEndsAt, jumpOutMsLeft]);

  const reveal = useCallback(() => setRevealed(true), []);
  const hide = useCallback(() => setRevealed(false), []);
  const clearError = useCallback(() => setError(null), []);
  const restart = useCallback(() => {
    setGame(null);
    setRevealed(false);
    setLastCardWindow(null);
    setJumpOutEndsAt(null);
  }, []);

  return useMemo(
    () => ({
      game,
      revealed,
      error,
      lastCardWindow,
      msLeft,
      jumpOutMsLeft,
      start,
      dispatch,
      reveal,
      hide,
      clearError,
      restart,
    }),
    [
      game,
      revealed,
      error,
      lastCardWindow,
      msLeft,
      jumpOutMsLeft,
      start,
      dispatch,
      reveal,
      hide,
      clearError,
      restart,
    ],
  );
}

/** Convenience for components that only need to know whose turn it is. */
export function turnPlayer(game: GameState) {
  return currentPlayer(game);
}
