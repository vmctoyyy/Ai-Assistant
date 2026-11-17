/**
 * Browser pass over the rankings screens.
 *
 * Driven through ?eloStore=memory, so the real components, the real glue and
 * the real Elo maths all run — only the backend is swapped. The engine tests
 * cannot see a dead button, a select that never populates, or a result shown
 * before it was saved.
 *
 *   npx vite build && node test/elo.smoke.mjs
 */
import { chromium } from 'playwright';
import { launchOptions } from '../../test/browser.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (path === '/favicon.ico') return res.writeHead(204).end();
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

/** Always tap, never click — a tap blurs whatever had focus first. */
async function tap(selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function tapText(text) {
  const el = page.getByRole('button', { name: text, exact: true }).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function addPlayer(name) {
  await tapText('Add player');
  await page.fill('#elo-player-name', name);
  await tapText('Add player'); // the submit button on the form
  await page.waitForSelector('.elo-table', { timeout: 5000 });
}

// --- unconfigured, with no database, must say so rather than pretend -------
await page.goto(`${base}?eloStore=none#rankings`);
await page.waitForSelector('.elo');
const setupText = await page.locator('.elo-box').first().textContent();
check('says plainly it is not set up when there is no database', /not been set up/.test(setupText), setupText);
check('and saves nothing in that state', (await page.locator('.elo-table').count()) === 0);
await tapText('Back to game');
check('can get back to the game from there', (await page.locator('.topbar-title').count()) === 1);

// --- with a store, the real screens ---------------------------------------
await page.goto(`${base}?eloStore=memory#rankings`);
await page.waitForSelector('.elo');
check('empty table invites a first player', /No players yet/.test(await page.locator('.elo-empty').first().textContent()));
check('record game is unavailable with nobody to pick', await page.getByRole('button', { name: 'Record game' }).isDisabled());

await addPlayer('Josh');
await addPlayer('Levon');
const names = await page.locator('.elo-table tbody .elo-linkbtn').allTextContents();
check('both players are listed', names.join(',') === 'Josh,Levon', names.join(','));
const startRatings = await page.locator('.elo-table tbody tr td:nth-child(3)').allTextContents();
check('everyone starts on 1000', startRatings.every((r) => r === '1000'), startRatings.join(','));

// --- duplicate and blank names are refused --------------------------------
await tapText('Add player');
await page.fill('#elo-player-name', 'josh');
await tapText('Add player');
check('a duplicate name is refused, ignoring capitals', (await page.locator('.elo-error').count()) === 1);
await page.fill('#elo-player-name', '   ');
await tapText('Add player');
check('a blank name is refused', /needs a name/.test(await page.locator('.elo-error').textContent()));
await tapText('Cancel');

// --- record a game --------------------------------------------------------
await tapText('Record game');
await page.selectOption('#elo-winner', { label: 'Josh' });
const loserOptions = await page.locator('#elo-loser option').allTextContents();
check('the winner cannot also be picked as the loser', !loserOptions.includes('Josh'), loserOptions.join(','));
await page.selectOption('#elo-loser', { label: 'Levon' });
await tapText('Record result');

await page.waitForSelector('.elo-box');
const result = await page.locator('.elo-box').textContent();
check('shows the result the brief asked for', /Josh 1000 -> 1016 \(\+16\)/.test(result), result);
check('and the loser the other way', /Levon 1000 -> 984 \(-16\)/.test(result), result);
await tapText('Done');

const afterRatings = await page.locator('.elo-table tbody tr td:nth-child(3)').allTextContents();
check('the leaderboard reorders by rating', afterRatings.join(',') === '1016,984', afterRatings.join(','));

// --- profile --------------------------------------------------------------
await tap('.elo-table tbody .elo-linkbtn');
const profile = await page.locator('.elo-box').first().textContent();
check('profile shows the rating', /Rating 1016/.test(profile), profile);
check('profile shows the record and win rate', /1 won, 0 lost — 100% wins/.test(profile), profile);
check('head-to-head lists the opponent', (await page.locator('.elo-table').nth(0).textContent()).includes('Levon'));
check('game history has the game', (await page.locator('.elo-list li').count()) === 1);
const historyRow = await page.locator('.elo-list li').first().textContent();
check('history shows win and rating change', /Won v Levon \(\+16\)/.test(historyRow), historyRow);

// --- a player with games cannot be deleted --------------------------------
check(
  'a player with games cannot be deleted',
  /Delete those first/.test(await page.locator('.elo-note').last().textContent()),
);

// --- deleting a game needs confirming, and ratings recalculate ------------
await tapText('Delete game');
check('deleting asks first', (await page.getByRole('button', { name: 'Yes, delete this game' }).count()) === 1);
await tapText('Yes, delete this game');
await page.waitForSelector('.elo-list', { state: 'detached', timeout: 5000 }).catch(() => {});
check('the game is gone from the history', (await page.locator('.elo-list li').count()) === 0);
const reverted = await page.locator('.elo-box').first().textContent();
check('and the rating goes back to the start', /Rating 1000/.test(reverted), reverted);

// --- now the player can go ------------------------------------------------
await tapText('Delete player');
await tapText('Yes, delete Josh');
await page.waitForSelector('.elo-table', { timeout: 5000 });
const left = await page.locator('.elo-table tbody .elo-linkbtn').allTextContents();
check('the deleted player is hidden from the rankings', left.join(',') === 'Levon', left.join(','));

// --- export downloads a real backup ---------------------------------------
const download = await Promise.all([
  page.waitForEvent('download', { timeout: 5000 }),
  tapText('Export backup'),
]).then(([d]) => d);
const stream = await download.createReadStream();
const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
const backup = JSON.parse(Buffer.concat(chunks).toString());
check('the backup names its format', backup.format === 'last-card-elo', backup.format);
check('and keeps the deleted player', backup.players.some((p) => p.name === 'Josh' && p.deletedAt));
check('and keeps the deleted game', backup.games.length === 1 && backup.games[0].deletedAt !== null);
check('the filename is dated', /^last-card-elo-\d{4}-\d{2}-\d{2}/.test(download.suggestedFilename()), download.suggestedFilename());

check('no page errors were logged', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll Elo screen checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
