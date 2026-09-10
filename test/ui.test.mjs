/* Interaction audit — run: node test/ui.test.mjs
 *
 * Drives the real app in a mobile browser and TAPS every control, because
 * logic tests cannot see hit-testing, focus or layout bugs. Two rules here
 * exist because breaking them shipped a broken build:
 *   - use tap(), not click(): a tap blurs whatever had focus first
 *   - tap chips BEFORE typing: the empty-input path is the one people use
 *
 * Needs playwright (npm i playwright) and serves docs/ on a spare port.
 */
import { spawn } from 'child_process';
import { chromium, devices } from 'playwright';

const PORT = process.env.PORT || 8899;
const BASE = `http://localhost:${PORT}`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)],
  { cwd: new URL('../docs/', import.meta.url).pathname, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);
await new Promise(r => setTimeout(r, 800));

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok?'ok  ':'FAIL'} ${n}${d?' — '+d:''}`); };
/* Expand a collapsed section without collapsing an already-open one — an
   earlier step may have left it either way. */
const expand = async (pg, label) => {
  const d = pg.locator('.disc', { hasText: label });
  if ((await d.getAttribute('aria-expanded')) !== 'true') {
    await d.tap();
    await pg.waitForTimeout(250);
  }
};

for (const dev of ['iPhone SE', 'iPhone 13']) {
  console.log(`\n##### ${dev} #####`);
  const ctx = await b.newContext({ ...devices[dev], hasTouch: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e));
  pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
  const items = () => pg.evaluate(() => new Promise(r => {
    const q = indexedDB.open('quietdesk',1);
    q.onsuccess = () => { const rq = q.result.transaction('kv','readonly').objectStore('kv').get('tasks');
      rq.onsuccess = () => r(rq.result ? rq.result.items : []); };
  }));
  await pg.goto(`${BASE}/index.html`);
  await pg.waitForSelector('.home', { timeout: 10000 });

  console.log('-- home screen --');
  const homeGeo = await pg.evaluate(() => {
    const vp = window.innerHeight;
    const head = document.querySelector('.home-head').getBoundingClientRect();
    return { vp, headPct: Math.round(head.height / vp * 100),
             scrolls: document.documentElement.scrollHeight > vp + 1,
             tiles: document.querySelectorAll('.tile').length,
             tappable: document.querySelectorAll('button.tile').length,
             gridText: document.querySelector('.home-grid').innerText.trim() };
  });
  check('home fills the viewport and does not scroll', !homeGeo.scrolls);
  check('header is the top quarter', Math.abs(homeGeo.headPct - 25) <= 1, homeGeo.headPct + '%');
  check('six tiles, four tappable', homeGeo.tiles === 6 && homeGeo.tappable === 4,
    `${homeGeo.tiles}/${homeGeo.tappable}`);
  check('no text labels under the icons', homeGeo.gridText === '');
  check('date and quote are present',
    !!(await pg.locator('.hh-date').innerText()) && !!(await pg.locator('.hh-quote').innerText()));
  check('the three removed apps are gone from home',
    !/Markets|Habits|Schedule/i.test(await pg.locator('.home').innerText()));

  await pg.locator('button.tile[aria-label="Tasks"]').tap();
  await pg.waitForSelector('.brief', { timeout: 10000 });

  console.log('-- composer: chip taps with an EMPTY input --');
  await pg.locator('.composer input').tap();
  await pg.waitForTimeout(250);
  await pg.locator('.compchips .chip', { hasText: 'Week' }).tap();
  await pg.waitForTimeout(250);
  check('chips survive the tap', await pg.locator('.compchips .chip').count() > 0);
  check('bucket chip registers', await pg.locator('.compchips .chip.on', { hasText: 'Week' }).count() === 1);
  await pg.locator('.compchips .chip', { hasText: 'Must' }).tap();
  await pg.waitForTimeout(200);
  check('importance chip registers', await pg.locator('.compchips .chip.on', { hasText: 'Must' }).count() === 1);
  await pg.locator('.composer input').fill('Dentist');
  await pg.locator('.composer input').press('Enter');
  await pg.waitForTimeout(400);
  let t = (await items())[0];
  check('task lands in chosen bucket', t && t.bucket === 'this_week', t && t.bucket);
  check('task lands with chosen importance', t && t.importance === 'must', t && t.importance);
  check('chips reset to defaults after add',
    await pg.locator('.compchips').count() === 0 || await pg.locator('.compchips .chip.on', { hasText: 'Today' }).count() === 1);

  console.log('-- composer: the Add button --');
  check('Add is disabled while the input is empty', await pg.locator('.addbtn').isDisabled());
  const legible = await pg.evaluate(() => {
    const b = document.querySelector('.addbtn');
    const cs = getComputedStyle(b);
    return { opacity: parseFloat(cs.opacity), colour: cs.color, bg: cs.backgroundColor };
  });
  check('disabled Add stays legible (not a faded solid)', legible.opacity === 1, `opacity ${legible.opacity}`);
  await pg.locator('.composer input').tap();
  await pg.locator('.composer input').fill('Ring the plumber');
  await pg.waitForTimeout(200);
  check('Add enables once there is text', !(await pg.locator('.addbtn').isDisabled()));
  await pg.locator('.addbtn').tap();
  await pg.waitForTimeout(400);
  const added = await items();
  check('Add button adds the task', !!added.find(x => x.title === 'Ring the plumber'));
  check('Add clears the input', (await pg.locator('.composer input').inputValue()) === '');
  check('Add keeps focus for the next task',
    await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Add a task'));
  check('composer never overflows its own width', await pg.evaluate(() => {
    const c = document.querySelector('.composer').getBoundingClientRect();
    return [...document.querySelectorAll('.composer .inner > *')]
      .every(el => Math.round(el.getBoundingClientRect().right) <= Math.round(c.right) + 1);
  }));
  // tidy up so later checks start from a known state
  for (const t of added) {
    await pg.locator(`button[aria-label="Delete: ${t.title}"]`).first().tap().catch(() => {});
    await pg.waitForTimeout(150);
  }

  console.log('-- sheet: every control by tap --');
  await pg.getByRole('button', { name: 'Go to the full list' }).tap();
  await pg.waitForTimeout(250);
  await expand(pg, 'This week');
  await pg.locator('button[aria-label="Options for Dentist"]').tap();
  await pg.waitForSelector('.sheet');
  const when = () => pg.locator('.sheetfield', { hasText: 'WHEN' });
  const imp = () => pg.locator('.sheetfield', { hasText: 'IMPORTANCE' });
  check('footer visible without scrolling', await pg.locator('.sheetfoot').isVisible());
  const geo = await pg.evaluate(() => {
    const s = document.querySelector('.sheet').getBoundingClientRect();
    const f = document.querySelector('.sheetfoot').getBoundingClientRect();
    return { inSheet: f.bottom <= Math.ceil(s.bottom) + 1, onScreen: f.bottom <= window.innerHeight + 1 };
  });
  check('footer sits inside the sheet', geo.inSheet);
  check('footer is on screen', geo.onScreen);

  await imp().locator('.chip', { hasText: 'Nice' }).tap(); await pg.waitForTimeout(150);
  check('importance chip', await imp().locator('.chip.on').innerText() === 'Nice');
  await when().locator('.chip', { hasText: 'Today' }).tap(); await pg.waitForTimeout(150);
  check('bucket chip', await when().locator('.chip.on').innerText() === 'Today');
  await when().locator('.togglebtn', { hasText: 'Date' }).tap(); await pg.waitForTimeout(200);
  check('date toggle', await pg.locator('input[aria-label="Date"]').count() === 1);
  await when().locator('.togglebtn', { hasText: 'Time' }).tap(); await pg.waitForTimeout(200);
  check('time toggle', await pg.locator('input[aria-label="Time"]').count() === 1);
  check('remind button present', await pg.locator('.remindrow .btn').count() === 1);
  // footer must STILL be reachable now the body is taller
  const geo2 = await pg.evaluate(() => {
    const f = document.querySelector('.sheetfoot').getBoundingClientRect();
    const el = document.elementFromPoint(f.x + f.width - 30, f.y + f.height/2);
    return { onScreen: f.bottom <= window.innerHeight + 1, hit: el ? el.textContent.slice(0,12) : 'NOTHING' };
  });
  check('footer still on screen when body grows', geo2.onScreen);
  check('Save is the topmost element at its own centre', geo2.hit === 'Save', geo2.hit);

  await pg.locator('input[aria-label="Task name"]').fill('Dentist checkup');
  await pg.getByRole('button', { name: 'Save', exact: true }).tap();
  await pg.waitForTimeout(400);
  t = (await items())[0];
  check('Save persists everything', t && t.title === 'Dentist checkup' && t.importance === 'nice'
    && t.bucket === 'today' && !!t.dueDate && !!t.dueTime,
    t ? `${t.title}/${t.importance}/${t.bucket}/${t.dueDate}/${t.dueTime}` : 'missing');
  check('sheet closed', await pg.locator('.sheet').count() === 0);

  console.log('-- cancel & delete --');
  await pg.locator('button[aria-label="Options for Dentist checkup"]').tap();
  await pg.waitForSelector('.sheet');
  await pg.locator('input[aria-label="Task name"]').fill('NOPE');
  await pg.getByRole('button', { name: 'Cancel' }).tap();
  await pg.waitForTimeout(300);
  check('Cancel discards', (await items())[0].title === 'Dentist checkup');
  await pg.locator('button[aria-label="Options for Dentist checkup"]').tap();
  await pg.waitForSelector('.sheet');
  await pg.getByRole('button', { name: 'Delete', exact: true }).tap();
  await pg.waitForTimeout(200);
  check('delete arms', await pg.locator('.linkbtn.armed').count() === 1);
  await pg.locator('.linkbtn.armed').tap();
  await pg.waitForTimeout(400);
  check('delete removes', (await items()).length === 0);

  console.log('-- ticking off in a bucket does not make it vanish --');
  await pg.locator('.composer input').tap();
  await pg.waitForTimeout(200);
  await pg.locator('.compchips .chip', { hasText: 'Week' }).tap();
  await pg.waitForTimeout(150);
  await pg.locator('.composer input').fill('Sort the garage');
  await pg.locator('.addbtn').tap();
  await pg.waitForTimeout(400);
  const weekSec = pg.locator('.sec').filter({ has: pg.locator('.disc', { hasText: 'This week' }) });
  if (await pg.locator('.brief').count()) {
    await pg.getByRole('button', { name: 'Go to the full list' }).tap();
    await pg.waitForTimeout(250);
  }
  await expand(pg, 'This week');
  check('task shows in This week', await weekSec.locator('.row .txt').count() === 1,
    JSON.stringify(await weekSec.locator('.row .txt').allInnerTexts()));
  await weekSec.locator('.row .tickbtn').first().tap();
  await pg.waitForTimeout(400);
  check('ticked task is STILL on screen', await weekSec.locator('.row').count() === 1);
  check('ticked task is struck through', await weekSec.locator('.row.done').count() === 1);
  check('header reads all done, not empty',
    (await weekSec.locator('.meta').innerText()) === 'all done',
    await weekSec.locator('.meta').innerText());
  await weekSec.locator('.row .tickbtn').first().tap();
  await pg.waitForTimeout(400);
  check('tapping again brings it back', await weekSec.locator('.row.done').count() === 0);
  check('the title is NOT a tick target', await weekSec.locator('.rowbody').getAttribute('aria-label') !== null
    && (await weekSec.locator('.rowbody').getAttribute('aria-label')).startsWith('Options for'));
  await weekSec.locator('.rowbody').first().tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  check('tapping the title opens options instead of ticking', await pg.locator('.sheet h2').innerText() === 'Task options');
  check('and it did not tick anything off', await weekSec.locator('.row.done').count() === 0);
  await pg.getByRole('button', { name: 'Cancel' }).tap();
  await pg.waitForTimeout(250);
  check('header counts it again', (await weekSec.locator('.meta').innerText()) === '1');
  await weekSec.locator('button[aria-label^="Delete:"]').first().tap();
  await pg.waitForTimeout(300);

  console.log('-- swipe to delete --');
  await pg.locator('.composer input').fill('Swipe me away');
  await pg.locator('.addbtn').tap();
  await pg.waitForTimeout(300);
  const swipeRow = pg.locator('.row').filter({ hasText: 'Swipe me away' });
  /* The bubble scrolls, not the page, so a row can sit outside the visible
     area — bring it into view before aiming pointer events at it. */
  await swipeRow.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(150);
  const sb = await swipeRow.boundingBox();
  const sy = sb.y + sb.height / 2;
  await pg.mouse.move(sb.x + sb.width * 0.55, sy);
  await pg.mouse.down();
  for (let i = 1; i <= 12; i++) await pg.mouse.move(sb.x + sb.width * 0.55 - i * 12, sy);
  await pg.mouse.up();
  await pg.waitForTimeout(450);
  check('a full swipe deletes the row',
    !(await items()).find(x => x.title === 'Swipe me away'));
  await pg.locator('.composer input').fill('Short drag');
  await pg.locator('.addbtn').tap();
  await pg.waitForTimeout(300);
  const dragRow = pg.locator('.row').filter({ hasText: 'Short drag' });
  await dragRow.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(150);
  const db = await dragRow.boundingBox();
  await pg.mouse.move(db.x + db.width * 0.55, db.y + db.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(db.x + db.width * 0.55 - 20, db.y + db.height / 2);
  await pg.mouse.up();
  await pg.waitForTimeout(350);
  check('a short drag deletes nothing', !!(await items()).find(x => x.title === 'Short drag'));
  check('a short drag opens no sheet', await pg.locator('.sheet').count() === 0);
  check('a short drag ticks nothing', await pg.locator('.row.done').count() === 0);
  for (const t of await items()) {
    await pg.locator(`button[aria-label="Delete: ${t.title}"]`).first().tap().catch(() => {});
    await pg.waitForTimeout(150);
  }

  console.log('-- brain dump & backup --');
  await pg.locator('.composer .btn', { hasText: 'Brain dump' }).tap();
  await pg.waitForSelector('.sheet');
  await pg.locator('.sheet textarea').fill('One\nTwo\nThree');
  await pg.waitForTimeout(150);
  await pg.getByRole('button', { name: /Add 3 tasks/ }).tap();
  await pg.waitForTimeout(400);
  check('brain dump adds', (await items()).length === 3);
  await pg.getByRole('button', { name: 'Back up & restore' }).tap();
  await pg.waitForSelector('.sheet');
  check('backup footer visible', await pg.locator('.sheetfoot').isVisible());
  check('backup buttons', (await pg.locator('.sheetfoot .btn').allInnerTexts()).join(',') === 'Close,Copy,Save file');
  await pg.getByRole('button', { name: 'Close' }).tap();
  await pg.waitForTimeout(250);
  check('backup closes', await pg.locator('.sheet').count() === 0);
  console.log('-- quotes, recap, shopping --');
  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  await pg.locator('button.tile[aria-label="Quotes"]').tap();
  await pg.waitForSelector('.qt-text', { timeout: 5000 });
  const todaysQuote = await pg.locator('.qt-text').innerText();
  check('quotes shows today\'s quote first', todaysQuote.length > 0);
  const beforeCount = await pg.locator('.quote-row').count();
  await pg.locator('input[aria-label="Quote"]').fill('A quiet room in morning light.');
  await pg.locator('input[aria-label="Source"]').fill('Me');
  await pg.locator('.quote-add .btn').tap();
  await pg.waitForTimeout(400);
  check('adding a quote replaces the built-ins with my list',
    await pg.locator('.quote-row').count() === 1, `was ${beforeCount}`);
  check('my quote is stored', (await pg.evaluate(() => new Promise(r => {
    const q = indexedDB.open('quietdesk',1);
    q.onsuccess = () => { const rq = q.result.transaction('kv','readonly').objectStore('kv').get('quotes');
      rq.onsuccess = () => r(rq.result ? rq.result.list.length : 0); };
  }))) === 1);
  await pg.locator('.quote-row .iconbtn').first().tap();
  await pg.waitForTimeout(400);
  check('deleting my last quote falls back to the built-ins',
    await pg.locator('.quote-row').count() > 20, String(await pg.locator('.quote-row').count()));

  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  await pg.locator('button.tile[aria-label="Shopping"]').tap();
  await pg.waitForTimeout(400);
  /* A controlled <input type=color> ignores a plainly assigned value, so
     drive it through the native setter the way a real pick would. */
  const setColour = (sel, hex) => pg.locator(sel).first().evaluate((el, hex) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, hex);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, hex);
  const cartState = () => pg.evaluate(() => new Promise(r => {
    const q = indexedDB.open('quietdesk', 1);
    q.onsuccess = () => { const rq = q.result.transaction('kv','readonly').objectStore('kv').get('carts');
      rq.onsuccess = () => r(rq.result || { carts: [], shops: [] }); };
  }));

  await pg.getByRole('button', { name: 'Shops' }).first().tap();
  await pg.waitForSelector('.shop-new', { timeout: 5000 });
  await pg.locator('input[aria-label="New shop name"]').fill('Warehouse');
  await setColour('.colour-input', '#e4002b');
  await pg.getByRole('button', { name: 'Save shop' }).tap();
  await pg.waitForTimeout(350);
  check('a saved shop keeps the colour picked', (await cartState()).shops[0].colour === '#e4002b',
    (await cartState()).shops[0].colour);

  await pg.locator('.backbtn').tap();
  await pg.waitForTimeout(300);
  await pg.getByRole('button', { name: 'Add cart' }).tap();
  await pg.waitForSelector('.shop-chips', { timeout: 5000 });
  check('saved shops are offered as chips',
    (await pg.locator('.shop-chip').allInnerTexts()).join() === 'Warehouse');
  check('chip ink is readable on a dark colour',
    await pg.locator('.shop-chip').first().evaluate(el => getComputedStyle(el).color) === 'rgb(255, 252, 247)');
  await pg.locator('.shop-chip').first().tap();
  await pg.waitForTimeout(450);
  check('picking a shop creates and opens the cart',
    (await pg.locator('.cart-banner-name').innerText()) === 'Warehouse');

  for (const it of ['Extension cord', 'Batteries']) {
    await pg.locator('input[aria-label="Add an item"]').fill(it);
    await pg.locator('.shop-add .btn').tap();
    await pg.waitForTimeout(160);
  }
  check('items add to the cart', await pg.locator('.cart-pad .row').count() === 2);
  await pg.locator('.cart-pad .row .tickbtn').first().tap();
  await pg.waitForTimeout(350);
  check('ticking crosses off without deleting', await pg.locator('.cart-pad .row.done').count() === 1);
  const ticked = (await cartState()).carts[0].items.find(i => i.checked);
  check('a ticked item is stamped for the midnight sweep', !!ticked.checkedAt);

  await pg.locator('.cart-banner .iconbtn').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  check('emptying asks first, and says what goes',
    (await pg.locator('.sheet h2').innerText()) === 'Empty this cart?' &&
    /2 items/.test(await pg.locator('.confirm-lead').innerText()),
    await pg.locator('.confirm-lead').innerText());
  check('the confirmation is not a routine one',
    (await pg.locator('.sheetfoot .btn').allInnerTexts()).join() === 'Keep it,Empty it');
  await pg.getByRole('button', { name: 'Keep it' }).tap();
  await pg.waitForTimeout(300);
  check('backing out of the dialog keeps the items',
    (await cartState()).carts[0].items.length === 2);

  await pg.locator('.cart-banner .backbtn').tap();
  await pg.waitForTimeout(350);
  await pg.getByRole('button', { name: 'Shops' }).first().tap();
  await pg.waitForTimeout(300);
  await pg.getByRole('button', { name: 'Edit' }).first().tap();
  await pg.waitForTimeout(250);
  await setColour('.shop-edit .colour-input', '#00aa00');
  await pg.waitForTimeout(400);
  const afterEdit = await cartState();
  check('recolouring a shop leaves existing carts alone',
    afterEdit.carts[0].colour === '#e4002b' && afterEdit.shops[0].colour === '#00aa00',
    `cart ${afterEdit.carts[0].colour} / shop ${afterEdit.shops[0].colour}`);
  await pg.getByRole('button', { name: 'Done' }).tap();
  await pg.waitForTimeout(250);
  await pg.getByRole('button', { name: 'Delete' }).first().tap();
  await pg.waitForTimeout(200);
  await pg.getByRole('button', { name: 'Tap again' }).tap();
  await pg.waitForTimeout(400);
  const afterDelete = await cartState();
  check('deleting a shop does not touch its carts',
    afterDelete.shops.length === 0 && afterDelete.carts.length === 1 &&
    afterDelete.carts[0].items.length === 2);

  await pg.locator('.backbtn').tap();
  await pg.waitForTimeout(300);
  check('the closed bubble previews what is left to get',
    (await pg.locator('.cart-line').allInnerTexts()).join() === 'Batteries',
    (await pg.locator('.cart-line').allInnerTexts()).join());
  await pg.locator('.cart-menu').first().tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  check('removing a cart asks first',
    (await pg.locator('.sheet h2').innerText()) === 'Remove this cart?');
  await pg.getByRole('button', { name: 'Remove it' }).tap();
  await pg.waitForTimeout(400);
  check('confirming removes the cart', (await cartState()).carts.length === 0);

  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  await pg.locator('button.tile[aria-label="Recap"]').tap();
  await pg.waitForSelector('.recap-lead', { timeout: 5000 });
  check('recap opens and reports a count',
    /finished in the last seven days/.test(await pg.locator('.recap-lead').innerText()),
    await pg.locator('.recap-lead').innerText());
  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  check('back always returns home', await pg.locator('.home').count() === 1);
  console.log('  errors:', errs.length ? errs : 'none');
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
stop();
process.exit(fail ? 1 : 0);
