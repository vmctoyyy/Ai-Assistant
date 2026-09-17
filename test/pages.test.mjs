/**
 * Two apps, one GitHub Pages site, one service worker scope.
 *
 * Quiet Desk's worker is registered at /Ai-Assistant/, which covers
 * /Ai-Assistant/last-card/ too. Until it was scoped, its navigation handler
 * answered every request under that prefix with the Quiet Desk shell, so the
 * game rendered as the dashboard. Nothing but a real worker catches that, so
 * this installs one and then walks between the two apps.
 *
 *   npm --prefix last-card run build:pages && node test/pages.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DOCS = new URL('../docs/', import.meta.url).pathname;
const PREFIX = '/Ai-Assistant/';
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  let path = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (!path.startsWith(PREFIX)) return res.writeHead(404).end('outside the Pages site');
  path = path.slice(PREFIX.length);
  if (path === '' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DOCS, path));
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
// 127.0.0.1 is a secure context, so service workers register without TLS.
const site = `http://127.0.0.1:${server.address().port}${PREFIX}`;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

// --- install Quiet Desk's worker -----------------------------------------
await page.goto(site);
await page.waitForSelector('body');
const registered = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
check('Quiet Desk registers its service worker', registered);

const controlled = await page.evaluate(async () => {
  if (navigator.serviceWorker.controller) return true;
  // The first load completes before the worker claims the page; reload once.
  return new Promise((r) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => r(true));
    setTimeout(() => r(!!navigator.serviceWorker.controller), 3000);
  });
});
check('the worker is controlling the page', controlled);

await page.reload();
const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
check('its scope covers the whole site', scope.endsWith(PREFIX), scope);

// --- the sibling app must not be hijacked --------------------------------
await page.goto(`${site}last-card/`);
let title = null;
try {
  await page.waitForSelector('.topbar-title', { timeout: 8000 });
  title = await page.locator('.topbar-title').textContent();
} catch {
  // The worker answered with somebody else's shell.
  title = `[no game — served "${await page.title()}" instead]`;
}
check('the game renders, not the dashboard', title === 'Last Card', `got ${title}`);
if (title !== 'Last Card') {
  console.log('\nThe sibling app was hijacked by the service worker. Stopping here.');
  await browser.close();
  server.close();
  process.exit(1);
}
check('the game bundle loaded', (await page.locator('.field').count()) > 0);

// It must still be playable, not just render.
const deal = page.getByRole('button', { name: 'Deal' });
const d = await deal.boundingBox();
await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2);
await page.waitForSelector('.btn-reveal');
const r = await page.locator('.btn-reveal').boundingBox();
await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
const cards = await page.locator('.hand .card').count();
check('a hand is dealt and revealed', cards === 7, `${cards} cards`);

// --- and Quiet Desk still works ------------------------------------------
await page.goto(site);
await page.waitForSelector('body');
const stillQuietDesk = await page.evaluate(() => document.title);
check('Quiet Desk still loads on its own root', /quiet desk/i.test(stillQuietDesk), stillQuietDesk);

// The point of the worker is the offline launch; that must survive the change.
await context.setOffline(true);
await page.goto(site);
const offlineOk = await page.evaluate(() => document.body.innerHTML.length > 100);
check('Quiet Desk still cold-starts with no network', offlineOk);
await context.setOffline(false);

await browser.close();
server.close();
console.log(failures === 0 ? '\nPages layout checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
