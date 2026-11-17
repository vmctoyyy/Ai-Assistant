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
await page.waitForSelector('.elo-screen');
const setupText = await page.locator('.elo-box').first().textContent();
check('says plainly it is not set up when there is no database', /not been set up/.test(setupText), setupText);
check('and saves nothing in that state', (await page.locator('.elo-table').count()) === 0);
await tapText('Back');
check('can get back to the game from there', (await page.locator('.topbar-title').count()) === 1);

// --- with a store, the real screens ---------------------------------------
await page.goto(`${base}?eloStore=memory#rankings`);
await page.waitForSelector('.elo-screen');
check('empty table invites a first player', /No players yet/.test(await page.locator('.elo-empty').first().textContent()));
check('record game is unavailable with nobody to pick', await page.getByRole('button', { name: 'Record game' }).isDisabled());

await addPlayer('Josh');
await addPlayer('Levon');
const names = await page.locator('.elo-table tbody .elo-linkbtn').allTextContents();
check('both players are listed', names.join(',') === 'Josh,Levon', names.join(','));
const startRatings = await page.locator('.elo-table tbody .elo-rating').allTextContents();
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

await page.waitForSelector('.elo-result');
const rows = await page.locator('.elo-result-row').allTextContents();
const flat = rows.join(' | ').replace(/\s+/g, ' ');
check('shows the winner moving up', /Josh ?1000 → 1016\+16/.test(flat.replace(/ /g, '')) || /Josh.*1000.*1016.*\+16/.test(flat), flat);
// A real minus sign (U+2212), not a hyphen: under tabular figures a hyphen is
// padded to a digit's width and reads as "- 16".
check('and the loser moving down', /Levon.*1000.*984.*\u221216/.test(flat), flat);
check('the minus is a real minus, not a hyphen', !/\u2212?-\d/.test(flat), flat);
check('the gain and the loss are told apart visually', (await page.locator('.elo-up').count()) === 1 && (await page.locator('.elo-down').count()) === 1);
await tapText('Done');

const afterRatings = await page.locator('.elo-table tbody .elo-rating').allTextContents();
check('the leaderboard reorders by rating', afterRatings.join(',') === '1016,984', afterRatings.join(','));

// --- profile --------------------------------------------------------------
await tap('.elo-table tbody .elo-linkbtn');
await page.waitForSelector('.elo-hero');
check('profile leads with the rating', (await page.locator('.elo-hero-rating').textContent()) === '1016');
const meta = (await page.locator('.elo-hero-meta').textContent()).replace(/\s+/g, ' ');
check('profile shows the record and win rate', /1 won · 0 lost/.test(meta) && /100% wins/.test(meta), meta);
check('head-to-head lists the opponent', (await page.locator('.elo-table').nth(0).textContent()).includes('Levon'));
check('game history has the game', (await page.locator('.elo-list li').count()) === 1);
const historyRow = (await page.locator('.elo-list li').first().textContent()).replace(/\s+/g, ' ');
check('history shows the outcome and opponent', /Won v Levon/.test(historyRow), historyRow);
check('history shows the rating change', /\+16/.test(historyRow), historyRow);

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
const reverted = await page.locator('.elo-hero-rating').textContent();
check('and the rating goes back to the start', reverted === '1000', reverted);

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
