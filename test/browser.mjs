/**
 * Finding Chromium.
 *
 * The sandbox ships a browser under PLAYWRIGHT_BROWSERS_PATH, but its build
 * number moves and so does its directory layout — chromium-1194/chrome-linux
 * became chromium-1243/chrome-linux64, which broke every browser suite in the
 * repository at once the next time the container was rebuilt. Nothing here
 * hardcodes either any more.
 *
 * Returns a path to pass as `executablePath`, or null to let Playwright
 * resolve the browser itself.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LAYOUTS = ['chrome-linux64', 'chrome-linux'];

export function findChromium() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return null;

  const builds = readdirSync(root)
    .filter((name) => name.startsWith('chromium-') && !name.includes('headless'))
    .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)));

  for (const build of builds) {
    for (const layout of LAYOUTS) {
      const exe = join(root, build, layout, 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/** Options for chromium.launch(), with the browser found if one is needed. */
export function launchOptions(extra = {}) {
  const executablePath = findChromium();
  return executablePath ? { ...extra, executablePath } : { ...extra };
}
