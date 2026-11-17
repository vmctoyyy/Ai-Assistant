/**
 * The sign, for display.
 *
 * `formatDelta` returns a plain hyphen because it is data. Under
 * `tabular-nums` a hyphen is padded to a full digit's width and reads as a
 * gap — "- 17" rather than "-17" — so the real minus sign (U+2212), which is
 * drawn to that width on purpose, is substituted on the way to the screen.
 */
import { formatDelta } from '../../elo/elo';

export function prettyDelta(delta: number): string {
  return formatDelta(delta).replace('-', '\u2212');
}
