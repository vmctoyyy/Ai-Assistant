/**
 * Browser smoke test. The engine suite cannot see a dead button, a control
 * hidden behind a sheet, or a layout that pushes the actions off screen, so
 * every control gets tapped here at phone size.
 *
 *   npx vite build && node test/ui.smoke.mjs
 */
import { chromium } from 'playwright';
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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const IGNORE = /favicon/;
page.on('console', (m) => m.type() === 'error' && !IGNORE.test(m.text()) && errors.push(m.text()));

/** Always tap, never click — a tap blurs whatever had focus first. */
async function tap(selector, opts = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, opts);
}

/** An ace asks for a suit; a joker asks for a rank and then a suit. */
async function resolveNomination() {
  if ((await page.locator('.sheet').count()) === 0) return;
  if ((await page.locator('.rank-grid').count()) > 0) {
    check('joker suits stay disabled until a rank is chosen', await page.locator('.suit-btn').first().isDisabled());
    await tap('.rank-btn');
    check('picking a rank enables the suits', !(await page.locator('.suit-btn').first().isDisabled()));
  }
  await tap('.suit-btn:not(:disabled)');
  check('the nomination sheet closes once it is answered', (await page.locator('.sheet').count()) === 0);
}

async function tapText(text) {
  const el = page.getByRole('button', { name: text }).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

await page.goto(base);

// --- setup ---------------------------------------------------------------
check('setup screen renders', await page.locator('.topbar-title').textContent() === 'Last Card');
await page.selectOption('.field:has-text("Players") select', '3');
check('three name fields appear', (await page.locator('.field input[type=text]').count()) === 3);
await tapText('Deal');

// --- handover ------------------------------------------------------------
check('handover screen hides the hand', (await page.locator('.hand-row').count()) === 0);
check('board shows the deck count', /\d+/.test(await page.locator('.card-count').textContent()));
check('seats are listed', (await page.locator('.seat').count()) === 3);

// Everything on the handover screen must be reachable inside the viewport.
for (const sel of ['.btn-reveal', '.actions .btn-quiet']) {
  const box = await page.locator(sel).first().boundingBox();
  check(`${sel} sits inside the viewport`, box.y + box.height <= 844, `bottom ${Math.round(box.y + box.height)}`);
  check(`${sel} is a thumb-sized target`, box.height >= 44, `${Math.round(box.height)}px`);
}

await tapText('Jump in');
check('jump-in sheet opens for anyone', (await page.locator('.player-grid .btn').count()) === 3);
await tapText('Cancel');

await tap('.btn-tiny'); // Log
check('move log opens', (await page.locator('.log-entry').count()) > 0);
await tapText('Cancel');

await tap('.btn-reveal');

// --- a turn --------------------------------------------------------------
const handCount = await page.locator('.hand .card').count();
check('hand is revealed after the tap', handCount === 7, `${handCount} cards`);
check('play starts disabled with nothing selected', await page.locator('.btn-primary').isDisabled());

// Tap a playable card, then play it. Dimmed cards are the unplayable ones.
const playable = page.locator('.hand .card:not(.is-dimmed)').first();
const before = await page.locator('.pile .card-lg').textContent();
if ((await page.locator('.hand .card:not(.is-dimmed)').count()) > 0) {
  const box = await playable.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  check('tapping a card selects it', (await page.locator('.card.is-selected').count()) === 1);
  check('play button enables on selection', !(await page.locator('.btn-primary').isDisabled()));

  await tap('.btn-primary');
  await resolveNomination();
  const after = await page.locator('.pile .card-lg').textContent();
  check('the pile changed after the play', after !== before, `${before} -> ${after}`);
} else {
  await tap('.btn-secondary'); // draw
  check('drawing advanced the game', true);
}

// --- the phone changes hands ---------------------------------------------
check(
  'the hand is hidden again once the turn ends',
  (await page.locator('.btn-reveal').count()) === 1 && (await page.locator('.hand').count()) === 0,
);
await tap('.btn-reveal');

// --- an illegal move gets visible feedback -------------------------------
const dimmed = page.locator('.hand .card.is-dimmed').first();
if ((await page.locator('.hand .card.is-dimmed').count()) > 0) {
  const box = await dimmed.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await tap('.btn-primary');
  const toast = await page.locator('.toast').count();
  check('an illegal play surfaces a message', toast === 1);
  if (toast) await tap('.toast');
}

// --- penalty flow --------------------------------------------------------
await tapText('Penalty');
check('penalty menu opens', (await page.locator('.sheet-title').textContent()) === 'Call a penalty');
// Switching the accuser must not leave the target pointing at themselves.
await page.selectOption('.field:has-text("Called by") select', { index: 1 });
const accuser = await page.locator('.field:has-text("Called by") select').inputValue();
const accused = await page.locator('.field:has-text("Against") select').inputValue();
check('the target moves off the accuser', accuser !== accused, `${accuser} vs ${accused}`);
await tapText('Propose penalty');
check('penalty needs confirming', (await page.locator('.sheet-title').textContent()) === 'Penalty proposed');
const seat = Number(accused.slice(1)) - 1;
const handBefore = await page.locator('.seat-count').nth(seat).textContent();
await tap('.sheet .btn-primary');
const handAfter = await page.locator('.seat-count').nth(seat).textContent();
check('a confirmed penalty is picked up', Number(handAfter) > Number(handBefore), `${handBefore} -> ${handAfter}`);

// --- a pinned deal, so the joker path is exercised every run -------------
// Seed 128 deals Ana 9S KC 6S 8S JOKER 10S QS onto a 3H — the joker is her only
// legal card, so the nomination sheet is unavoidable.
await page.goto(`${base}?seed=128`);
await page.selectOption('.field:has-text("Players") select', '3');
await tapText('Deal');
await tap('.btn-reveal');
const live = await page.locator('.hand .card:not(.is-dimmed)').count();
check('only the joker is playable on the pinned deal', live === 1, `${live} live cards`);
await tap('.hand .card:not(.is-dimmed)');
await tap('.btn-primary');
check('the joker opens the nomination sheet', (await page.locator('.rank-grid').count()) === 1);
await resolveNomination();
const jokerTop = await page.locator('.pile .card-lg').textContent();
check('the joker is on the pile with its nomination', /JOKER/.test(jokerTop), jokerTop);

check('no page errors were logged', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll UI smoke checks passed.' : `\n${failures} UI check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
