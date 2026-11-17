/**
 * The four suits, drawn rather than typed.
 *
 * As characters, ♥ and ♦ come through as colour emoji on some platforms — a
 * different weight from ♠ and ♣, and immune to `color`. U+FE0E and
 * `font-variant-emoji` are both ignored by at least one engine. Paths render
 * the same everywhere, take a colour, and cost nothing extra to ship.
 */
const PATHS: Record<string, string> = {
  heart: 'M12 21.3C7 17.6 2.5 14 2.5 9.8 2.5 6.9 4.8 5 7.2 5c1.9 0 3.6 1.1 4.8 2.9C13.2 6.1 14.9 5 16.8 5c2.4 0 4.7 1.9 4.7 4.8 0 4.2-4.5 7.8-9.5 11.5z',
  spade:
    'M12 2.4C9.9 5.7 7.2 7.8 5.6 9.5c-1.4 1.5-2.1 2.8-2.1 4.4 0 2.4 1.8 4.2 4.1 4.2 1.3 0 2.4-.6 3.2-1.5-.2 1.8-.9 3.3-2 4.5h6.4c-1.1-1.2-1.8-2.7-2-4.5.8.9 1.9 1.5 3.2 1.5 2.3 0 4.1-1.8 4.1-4.2 0-1.6-.7-2.9-2.1-4.4C16.8 7.8 14.1 5.7 12 2.4z',
  diamond: 'M12 2.2 20.6 12 12 21.8 3.4 12z',
  club: 'M12 2.6c2 0 3.7 1.6 3.7 3.6 0 .6-.2 1.2-.4 1.7.5-.2 1-.3 1.6-.3 2 0 3.7 1.6 3.7 3.6s-1.7 3.6-3.7 3.6c-1.3 0-2.5-.7-3.1-1.7.1 2.4.8 4.3 2 5.5H8.2c1.2-1.2 1.9-3.1 2-5.5-.6 1-1.8 1.7-3.1 1.7-2 0-3.7-1.6-3.7-3.6s1.7-3.6 3.7-3.6c.6 0 1.1.1 1.6.3-.2-.5-.4-1.1-.4-1.7 0-2 1.7-3.6 3.7-3.6z',
};

export function Pip({ suit, className }: { suit: keyof typeof PATHS; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[suit]} />
    </svg>
  );
}
