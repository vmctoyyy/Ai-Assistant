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
/* Screens and sheets now animate in on the iOS curve, so anything that
   measures geometry has to wait for them to come to rest — a sheet read the
   instant it appears is still translated off the bottom of the screen. */
const settled = async (pg) => {
  await pg.evaluate(() => Promise.all(
    document.getAnimations().map(a => a.finished.catch(() => {}))));
};
/* Controlled date/time/number/colour inputs ignore a plainly assigned value —
   React never sees it — so drive them the way a real pick would. */
const setNativeOn = (pg, sel, v) => pg.locator(sel).first().evaluate((el, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
/* The Tasks footer rests as a three-button bar, so anything that wants the
   quick-add input has to open it first. Idempotent: already open is fine. */
const openAdd = async (pg) => {
  if (await pg.locator('.composer input').count() === 0) {
    await pg.locator('.hot', { hasText: 'Add task' }).tap();
    await pg.waitForSelector('.composer input', { timeout: 5000 });
  }
};
/* ...and the reverse, for the two bar buttons that are only there at rest.
   The composer also folds itself away on an empty input after a moment, so
   the close button can detach mid-tap — retry rather than fail on the race. */
const showBar = async (pg) => {
  for (let i = 0; i < 4; i++) {
    if (await pg.locator('.hotbar').count()) return;
    await pg.locator('.composer .closebtn').tap({ timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(300);
  }
  await pg.waitForSelector('.hotbar', { timeout: 5000 });
};
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
  await settled(pg);

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

  console.log('-- the hot bar --');
  check('the footer rests as three buttons', await pg.locator('.hotbar .hot').count() === 3);
  check('and they are the three the bar is for',
    (await pg.locator('.hotbar .hot').allInnerTexts()).join('|') === 'Add task|Habits|Brain dump');
  check('no input until one is asked for', await pg.locator('.composer input').count() === 0);
  const barGeo = await pg.evaluate(() => {
    const bar = document.querySelector('.hotbar').getBoundingClientRect();
    return [...document.querySelectorAll('.hotbar .hot')].every(el => {
      const r = el.getBoundingClientRect();
      return r.height >= 44 && r.width > 40 &&
        Math.round(r.right) <= Math.round(bar.right) + 1 && r.left >= bar.left - 1;
    });
  });
  check('every button is a real tap target and fits the bar', barGeo);

  console.log('-- composer: chip taps with an EMPTY input --');
  await pg.locator('.hot', { hasText: 'Add task' }).tap();
  await pg.waitForTimeout(250);
  check('Add task opens the composer', await pg.locator('.composer input').count() === 1);
  check('and puts the cursor in it, so the keyboard comes up',
    await pg.evaluate(() => document.activeElement &&
      document.activeElement.getAttribute('aria-label') === 'Add a task'));
  await pg.waitForTimeout(200);
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
  await openAdd(pg);
  check('Add is disabled while the input is empty', await pg.locator('.addbtn').isDisabled());
  const legible = await pg.evaluate(() => {
    const b = document.querySelector('.addbtn');
    const cs = getComputedStyle(b);
    return { opacity: parseFloat(cs.opacity), colour: cs.color, bg: cs.backgroundColor };
  });
  check('disabled Add stays legible (not a faded solid)', legible.opacity === 1, `opacity ${legible.opacity}`);
  await openAdd(pg);
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



  console.log('-- breathing room at the screen edges --');
  await showBar(pg);
  const edges = await pg.evaluate(() => {
    const vh = innerHeight;
    const bub = document.querySelector('.bubble').getBoundingClientRect();
    const back = document.querySelector('.backbtn').getBoundingClientRect();
    const hot = document.querySelector('.hotbar .hot').getBoundingClientRect();
    const r = parseFloat(getComputedStyle(document.querySelector('.bubble')).borderTopLeftRadius);
    return {
      radius: r,
      bubbleTop: Math.round(bub.top), bubbleSide: Math.round(bub.left),
      bubbleBottom: Math.round(vh - bub.bottom),
      headInset: Math.round(back.top - bub.top),
      footInset: Math.round(bub.bottom - hot.bottom)
    };
  });
  check('the bubble is held off every screen edge', edges.bubbleTop >= 12 &&
    edges.bubbleSide >= 12 && edges.bubbleBottom >= 12,
    `top ${edges.bubbleTop} side ${edges.bubbleSide} bottom ${edges.bubbleBottom}`);
  /* Content nearer the edge than two thirds of the corner radius sits inside
     the curve's sweep, which is what made the header read as crowded. */
  check('the header clears the corner sweep', edges.headInset >= edges.radius * 0.6,
    `${edges.headInset}px inside a ${edges.radius}px corner`);
  check('and so does the footer', edges.footInset >= edges.radius * 0.6,
    `${edges.footInset}px inside a ${edges.radius}px corner`);

  /* env(safe-area-inset-*) is 0 in Chromium and ~34-59px on a real iPhone, so
     the device's own layout is never exercised by default. Force the insets
     on and check the shell still holds up — this is the one class of bug that
     reaches the phone and never the suite. */
  const safeArea = await pg.addStyleTag({ content:
    '.screen{padding-top:59px !important;padding-bottom:34px !important}' });
  await pg.waitForTimeout(350);
  const inset = await pg.evaluate(() => {
    const vh = innerHeight, vw = innerWidth;
    const bub = document.querySelector('.bubble').getBoundingClientRect();
    const body = document.querySelector('.screen-body');
    const hot = document.querySelector('.hotbar').getBoundingClientRect();
    return {
      fitsTop: bub.top >= 59, fitsBottom: vh - bub.bottom >= 34,
      footOnScreen: hot.bottom <= vh + 1,
      bodyStillScrolls: body.scrollHeight > 0 && body.clientHeight > 0,
      noOverflow: document.documentElement.scrollWidth <= vw + 1,
      bubbleHasHeight: bub.height > 200
    };
  });
  check('with an iPhone\'s insets the bubble still clears the notch', inset.fitsTop);
  check('and the home indicator', inset.fitsBottom);
  check('the footer stays on screen', inset.footOnScreen);
  check('the body keeps its scroller', inset.bodyStillScrolls);
  check('nothing overflows sideways', inset.noOverflow);
  check('the bubble does not collapse', inset.bubbleHasHeight);
  await safeArea.evaluate(el => el.remove());
  await pg.waitForTimeout(250);

  console.log('-- add task: the full sheet --');
  /* Tap the way in BEFORE typing, and with an empty input, for the same
     reason the chip checks do: that is the path that broke on a real phone. */
  await showBar(pg);
  await openAdd(pg);
  await pg.waitForTimeout(250);
  check('the quick add offers a way to the full sheet',
    await pg.locator('.compmore .linkbtn').count() === 1);
  await pg.locator('.compmore .linkbtn').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  check('it opens as a new task, not an edit',
    (await pg.locator('.sheet h2').innerText()) === 'New task',
    await pg.locator('.sheet h2').innerText());
  check('a task with no name cannot be added',
    await pg.locator('.sheet').getByRole('button', { name: 'Add task', exact: true }).isDisabled());
  check('and says why', /needs a name/i.test(await pg.locator('.sheet').innerText()));
  check('nothing about deleting a task that does not exist yet',
    await pg.locator('.sheet .linkbtn.danger').count() === 0);
  check('and no "added" line either',
    await pg.locator('.sheet .addedline').count() === 0);
  check('the date, time and note fields are all here',
    await pg.locator('.sheet .togglebtn').filter({ hasText: 'Date' }).count() === 1 &&
    await pg.locator('.sheet .togglebtn').filter({ hasText: 'Time' }).count() === 1 &&
    await pg.locator('.sheet input[aria-label="Note"]').count() === 1);
  await pg.locator('.sheet').getByRole('button', { name: 'Cancel' }).tap();
  await pg.waitForTimeout(300);
  check('cancelling adds nothing', !(await items()).find(x => x.title === ''));

  /* Now the real path: type in the composer, carry it into the sheet. */
  await openAdd(pg);
  await pg.locator('.composer input').fill('Pick up the prescription');
  await pg.waitForTimeout(150);
  await pg.locator('.compchips .chip', { hasText: 'Must' }).tap();
  await pg.waitForTimeout(150);
  await pg.locator('.compmore .linkbtn').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  check('what was typed comes with it',
    (await pg.locator('input[aria-label="Task name"]').inputValue()) === 'Pick up the prescription',
    await pg.locator('input[aria-label="Task name"]').inputValue());
  check('and so does the importance already chosen',
    (await pg.locator('.sheetfield', { hasText: 'IMPORTANCE' }).locator('.chip.on').innerText()) === 'Must');

  await pg.locator('.sheet .togglebtn').filter({ hasText: 'Date' }).tap();
  await pg.waitForTimeout(250);
  await setNativeOn(pg, 'input[aria-label="Date"]', '2026-09-14');
  await pg.locator('.sheet .togglebtn').filter({ hasText: 'Time' }).tap();
  await pg.waitForTimeout(250);
  await setNativeOn(pg, 'input[aria-label="Time"]', '14:30');
  await pg.locator('input[aria-label="Note"]').fill('Chemist on the corner');
  await pg.waitForTimeout(200);
  check('no reminder offered before the task exists',
    await pg.locator('.sheet .remindrow').count() === 0);
  await pg.locator('.sheet').getByRole('button', { name: 'Add task', exact: true }).tap();
  await pg.waitForTimeout(500);

  const made = (await items()).find(x => x.title === 'Pick up the prescription');
  check('the task is created with everything set in one go', !!made);
  check('  date', made && made.dueDate === '2026-09-14', made && made.dueDate);
  check('  time', made && made.dueTime === '14:30', made && made.dueTime);
  check('  note', made && made.notes === 'Chemist on the corner', made && made.notes);
  check('  importance', made && made.importance === 'must', made && made.importance);
  check('the sheet closed behind it', await pg.locator('.sheet').count() === 0);
  check('and the composer reset to the bar', await pg.locator('.hotbar').count() === 1);
  const back = await items();
  check('only one task was made', back.filter(x => x.title === 'Pick up the prescription').length === 1);
  await pg.locator('button[aria-label="Delete: Pick up the prescription"]').first().tap();
  await pg.waitForTimeout(300);

  console.log('-- sheet: every control by tap --');
  await pg.getByRole('button', { name: 'Go to the full list' }).tap();
  await pg.waitForTimeout(250);
  await expand(pg, 'This week');
  await pg.locator('button[aria-label="Options for Dentist"]').tap();
  await pg.waitForSelector('.sheet');
  await settled(pg);
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
  await openAdd(pg);
  await pg.locator('.composer input').tap();
  await pg.waitForTimeout(200);
  await pg.locator('.compchips .chip', { hasText: 'Week' }).tap();
  await pg.waitForTimeout(150);
  await openAdd(pg);
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
  await openAdd(pg);
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
  await openAdd(pg);
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
  await showBar(pg);
  await pg.locator('.hot', { hasText: 'Brain dump' }).tap();
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
  check('the one-off shop offers a save tick, off by default',
    await pg.locator('.sheet .togglebtn').getAttribute('aria-checked') === 'false');
  check('and says it will not be saved',
    /will not appear in your saved shops/.test(await pg.locator('.sheet .fieldnote').last().innerText()));
  await pg.locator('.shop-chip').first().tap();
  await pg.waitForTimeout(450);
  check('picking a shop creates and opens the cart',
    (await pg.locator('.cart-banner-name').innerText()) === 'Warehouse');

  /* a one-off cart WITH the tick on should leave a shop behind */
  await pg.locator('.cart-banner .backbtn').tap();
  await pg.waitForTimeout(300);
  await pg.getByRole('button', { name: 'Add cart' }).tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await pg.locator('.sheet input[aria-label="Shop name"]').fill('Bunnings');
  await setColour('.sheet .colour-input', '#0d5257');
  await pg.locator('.sheet .togglebtn').tap();
  await pg.waitForTimeout(200);
  check('ticking save changes what the sheet promises',
    /waiting as a chip/.test(await pg.locator('.sheet .fieldnote').last().innerText()));
  await pg.getByRole('button', { name: 'Create cart' }).tap();
  await pg.waitForTimeout(450);
  const saved = await cartState();
  check('the ticked one-off shop is saved',
    saved.shops.some(s => s.name === 'Bunnings' && s.colour === '#0d5257'),
    JSON.stringify(saved.shops.map(s => s.name)));
  check('and its cart was still created', saved.carts.some(c => c.shop === 'Bunnings'));
  check('saving the shop did not drop the other cart', saved.carts.length === 2,
    String(saved.carts.length));
  await pg.locator('.cart-banner .backbtn').tap();
  await pg.waitForTimeout(300);
  await pg.locator('.cart-open', { hasText: 'Warehouse' }).tap();
  await pg.waitForTimeout(400);

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
  /* Name the row rather than taking the first — there is more than one now. */
  const warehouseRow = pg.locator('.shop-row', { hasText: 'Warehouse' });
  await warehouseRow.getByRole('button', { name: 'Edit' }).tap();
  await pg.waitForTimeout(250);
  await setColour('.shop-edit .colour-input', '#00aa00');
  await pg.waitForTimeout(400);
  const afterEdit = await cartState();
  const whCart = afterEdit.carts.find(c => c.shop === 'Warehouse');
  const whShop = afterEdit.shops.find(sh => sh.name === 'Warehouse');
  check('recolouring a shop leaves existing carts alone',
    whCart.colour === '#e4002b' && whShop.colour === '#00aa00',
    `cart ${whCart.colour} / shop ${whShop.colour}`);
  await pg.getByRole('button', { name: 'Done' }).tap();
  await pg.waitForTimeout(250);
  await warehouseRow.getByRole('button', { name: 'Delete' }).tap();
  await pg.waitForTimeout(200);
  await warehouseRow.getByRole('button', { name: 'Tap again' }).tap();
  await pg.waitForTimeout(400);
  const afterDelete = await cartState();
  check('deleting a shop does not touch its carts',
    !afterDelete.shops.some(sh => sh.name === 'Warehouse') &&
    afterDelete.carts.some(c => c.shop === 'Warehouse' && c.items.length === 2),
    JSON.stringify({ shops: afterDelete.shops.map(x => x.name),
                     carts: afterDelete.carts.map(c => c.shop + ':' + c.items.length) }));

  await pg.locator('.backbtn').tap();
  await pg.waitForTimeout(300);
  const warehouseBubble = pg.locator('.cart-bubble', { hasText: 'Warehouse' });
  check('the closed bubble previews what is left to get',
    (await warehouseBubble.locator('.cart-line').allInnerTexts()).join() === 'Batteries',
    (await warehouseBubble.locator('.cart-line').allInnerTexts()).join());
  await warehouseBubble.locator('.cart-menu').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  check('removing a cart asks first',
    (await pg.locator('.sheet h2').innerText()) === 'Remove this cart?');
  await pg.getByRole('button', { name: 'Remove it' }).tap();
  await pg.waitForTimeout(400);
  const afterRemove = await cartState();
  check('confirming removes that cart and only that one',
    !afterRemove.carts.some(c => c.shop === 'Warehouse') &&
    afterRemove.carts.some(c => c.shop === 'Bunnings'),
    JSON.stringify(afterRemove.carts.map(c => c.shop)));

  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  await pg.locator('button.tile[aria-label="Recap"]').tap();
  await pg.waitForSelector('.recap-lead', { timeout: 5000 });
  check('recap opens and reports a count',
    /finished in the last seven days/.test(await pg.locator('.recap-lead').innerText()),
    await pg.locator('.recap-lead').innerText());

  console.log('-- habits --');
  /* The run arrives here from Recap, so get back to the grid first. */
  if (await pg.locator('.home').count() === 0) {
    await pg.locator('.backbtn').tap();
    await pg.waitForSelector('.home', { timeout: 5000 });
  }
  /* Native setters again: time, date and number inputs are controlled, so a
     plainly assigned .value never reaches React and every field reads back
     as its default — which looks exactly like an app bug. */
  const setNative = (sel, v) => pg.locator(sel).first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  const habitState = () => pg.evaluate(() => new Promise(r => {
    const q = indexedDB.open('quietdesk', 1);
    q.onsuccess = () => { const rq = q.result.transaction('kv','readonly').objectStore('kv').get('habitsv2');
      rq.onsuccess = () => r(rq.result || { habits: [], gen: {} }); };
  }));
  const dayBtn = (d) => pg.locator('.daypick .day').filter({ hasText: new RegExp('^' + d + '$') });

  await pg.locator('button.tile[aria-label="Tasks"]').tap();
  await pg.waitForTimeout(400);
  if (await pg.locator('.brief').count()) {
    await pg.getByRole('button', { name: 'Go to the full list' }).tap();
    await pg.waitForTimeout(250);
  }
  await showBar(pg);
  await pg.locator('.hot', { hasText: 'Habits' }).tap();
  await pg.waitForSelector('.habit-lead', { timeout: 5000 });
  check('the bar opens Habits', await pg.locator('.habit-lead').count() === 1);
  check('the empty state does not ask for the whole week',
    /one or two/i.test(await pg.locator('.habit-empty').innerText()));

  await pg.getByRole('button', { name: 'Add habit' }).tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  check('a new habit starts on weekly', await pg.locator('.daypick').count() === 1);
  check('and will not save while it has no days',
    await pg.getByRole('button', { name: 'Save', exact: true }).isDisabled());
  check('and says why', /at least one day/i.test(await pg.locator('.slot-warn').innerText()));

  await pg.locator('input[aria-label="Habit name"]').fill('Gym');
  for (const d of ['Mo', 'Tu', 'Th']) { await dayBtn(d).tap(); await pg.waitForTimeout(120); }
  check('day taps register', await pg.locator('.daypick .day.on').count() === 3,
    String(await pg.locator('.daypick .day.on').count()));
  await setNative('input[aria-label="Start time"]', '05:00');
  await pg.waitForTimeout(150);

  await pg.getByRole('button', { name: '+ Add another time' }).tap();
  await pg.waitForTimeout(250);
  check('a habit can carry a second time', await pg.locator('.slot').count() === 2);
  const slot2 = pg.locator('.slot').nth(1);
  for (const d of ['Sa', 'Su']) {
    await slot2.locator('.day').filter({ hasText: new RegExp('^' + d + '$') }).tap();
    await pg.waitForTimeout(120);
  }
  await slot2.locator('input[aria-label="Start time"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '08:00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pg.waitForTimeout(200);
  check('the preview spells out what will be saved',
    (await pg.locator('.habit-preview').innerText()).includes('Mon/Tue/Thu 05:00, Sat/Sun 08:00'),
    await pg.locator('.habit-preview').innerText());
  check('Save is reachable now it is valid',
    !(await pg.getByRole('button', { name: 'Save', exact: true }).isDisabled()));
  await pg.getByRole('button', { name: 'Save', exact: true }).tap();
  await pg.waitForTimeout(450);

  const hs = await habitState();
  check('the habit is stored with both slots',
    hs.habits.length === 1 && hs.habits[0].schedule.length === 2,
    JSON.stringify(hs.habits.map(x => x.name)));
  check('and reads back as a summary on the list',
    (await pg.locator('.habit-when').innerText()) === 'Mon/Tue/Thu 05:00, Sat/Sun 08:00',
    await pg.locator('.habit-when').innerText());

  console.log('-- habits: a daily one reaches today --');
  await pg.getByRole('button', { name: 'Add habit' }).tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  await pg.locator('input[aria-label="Habit name"]').fill('Take the pills');
  for (const d of ['Mo','Tu','We','Th','Fr','Sa','Su']) {
    await dayBtn(d).tap(); await pg.waitForTimeout(90);
  }
  await setNative('input[aria-label="Start time"]', '07:30');
  await pg.waitForTimeout(150);
  await pg.getByRole('button', { name: 'Save', exact: true }).tap();
  await pg.waitForTimeout(500);
  const minted = (await items()).filter(x => x.title === 'Take the pills');
  check('a habit that runs today puts a task up straight away', minted.length === 1);
  check('the instance carries the time', minted[0] && minted[0].dueTime === '07:30',
    minted[0] && minted[0].dueTime);
  check('and is stamped with the habit it came from', !!(minted[0] && minted[0].habitId));

  await pg.locator('.backbtn').tap();
  await pg.waitForTimeout(400);
  check('back from Habits returns to Tasks, not home', await pg.locator('.hotbar').count() === 1);
  const pillRow = pg.locator('.row').filter({ hasText: 'Take the pills' });
  check('the task is on the list', await pillRow.count() === 1);
  check('and is marked as coming from a habit',
    await pillRow.locator('.habitmark').count() === 1);
  check('a hand-made task carries no such mark',
    await pg.locator('.row').filter({ hasText: 'Sort the garage' }).locator('.habitmark').count() === 0);
  /* Where a timed task sits now depends on the time of day, so that is
     asserted against a frozen clock further down rather than here, where the
     suite runs on whatever the real time happens to be. What matters in this
     flow is that the minted task landed in Today at all. */
  check('the minted task lands in Today, not a later bucket',
    await pg.locator('.sec').first().locator('.row').filter({ hasText: 'Take the pills' }).count() === 1);

  console.log('-- habits: ticking, pausing, removing --');
  await pillRow.locator('.tickbtn').tap();
  await pg.waitForTimeout(350);
  check('ticking an instance leaves it on screen',
    await pg.locator('.row.done').filter({ hasText: 'Take the pills' }).count() === 1);
  check('and does not touch the habit', (await habitState()).habits.length === 2);

  await showBar(pg);
  await pg.locator('.hot', { hasText: 'Habits' }).tap();
  await pg.waitForSelector('.habit-lead', { timeout: 5000 });
  const pillBubble = pg.locator('.habit-bubble').filter({ hasText: 'Take the pills' });
  check('a habit running today says so',
    /on today's list/i.test(await pillBubble.innerText()), await pillBubble.innerText());
  await pillBubble.locator('.habit-toggle').tap();
  await pg.waitForTimeout(350);
  check('pausing is one tap', await pillBubble.locator('.habit-toggle').innerText() === 'Off');
  const paused = (await habitState()).habits.find(x => x.name === 'Take the pills');
  check('a paused habit keeps its schedule', paused && paused.active === false && paused.schedule.length === 1);

  await pg.locator('.habit-bubble').filter({ hasText: 'Gym' }).locator('.habit-body').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  check('tapping a habit opens it for editing',
    (await pg.locator('input[aria-label="Habit name"]').inputValue()) === 'Gym');
  check('its slots come back in full', await pg.locator('.slot').count() === 2);
  await pg.locator('.slot').nth(1).locator('.iconbtn').tap();
  await pg.waitForTimeout(200);
  check('a slot can be removed', await pg.locator('.slot').count() === 1);
  await pg.getByRole('button', { name: 'Save', exact: true }).tap();
  await pg.waitForTimeout(450);
  const gym = (await habitState()).habits.find(x => x.name === 'Gym');
  check('the edit sticks', gym && gym.schedule.length === 1, gym && String(gym.schedule.length));

  await pg.locator('.habit-bubble').filter({ hasText: 'Gym' }).locator('.habit-body').tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  await pg.getByRole('button', { name: 'Remove' }).tap();
  await pg.waitForTimeout(200);
  check('removing arms first', /tap again/i.test(await pg.locator('.btn.danger').innerText()));
  await pg.locator('.btn.danger.armed').tap();
  await pg.waitForTimeout(450);
  check('and then removes just that one',
    (await habitState()).habits.map(x => x.name).join() === 'Take the pills',
    (await habitState()).habits.map(x => x.name).join());

  console.log('-- habits: the other recurrences --');
  await pg.getByRole('button', { name: 'Add habit' }).tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await settled(pg);
  await pg.locator('input[aria-label="Habit name"]').fill('Car show');
  await pg.locator('.sheet .chip', { hasText: 'Dates' }).tap();
  await pg.waitForTimeout(250);
  check('picking Dates swaps the day picker for a date list',
    await pg.locator('.daypick').count() === 0 && await pg.locator('.datepick').count() === 1);
  await setNative('input[aria-label="Add a date"]', '2026-10-17');
  await pg.waitForTimeout(200);
  await pg.getByRole('button', { name: 'Add date' }).tap();
  await pg.waitForTimeout(250);
  check('the date is added and spelled out',
    /Sat 17 Oct/.test(await pg.locator('.datechip').innerText()),
    await pg.locator('.datechip').innerText());
  await pg.locator('.sheet .chip', { hasText: 'Monthly' }).tap();
  await pg.waitForTimeout(250);
  check('Monthly asks for a day of the month',
    await pg.locator('input[aria-label="Day of the month"]').count() === 1);
  await pg.locator('.sheet .chip', { hasText: 'Yearly' }).tap();
  await pg.waitForTimeout(250);
  check('Yearly asks for months too', await pg.locator('.monthpick').count() === 1);
  check('and will not save on months alone',
    await pg.getByRole('button', { name: 'Save', exact: true }).isDisabled() ||
    await pg.locator('.slot-warn').count() === 1);
  await pg.locator('.monthpick .day', { hasText: 'Sep' }).tap();
  await pg.waitForTimeout(200);
  await pg.getByRole('button', { name: 'Save', exact: true }).tap();
  await pg.waitForTimeout(450);
  check('a yearly habit saves once it has a month and a day',
    (await habitState()).habits.some(x => x.name === 'Car show'));

  check('no control in the habit sheet is under the tap threshold', await pg.evaluate(() => {
    return [...document.querySelectorAll('.habit-bubble button, .hotbar .hot')]
      .every(el => el.getBoundingClientRect().height >= 36);
  }));

  /* Habits hands back to Tasks; Tasks hands back to the grid. */
  await pg.locator('.backbtn').tap();
  await pg.waitForTimeout(400);
  check('back from Habits lands on Tasks', await pg.locator('.hotbar').count() === 1);

  await pg.locator('.backbtn').tap();
  await pg.waitForSelector('.home', { timeout: 5000 });
  check('back always returns home', await pg.locator('.home').count() === 1);
  console.log('  errors:', errs.length ? errs : 'none');
  await ctx.close();
}

/* ---- a later time waits at the bottom ----
   Its own context with a frozen clock in UTC, so "is 21:00 still hours away"
   has the same answer whenever the suite is run. Without this the checks pass
   or fail depending on the time of day. */
console.log('\n##### a later time waits its turn #####');
{
  const ctx = await b.newContext({ ...devices['iPhone 13'], hasTouch: true, timezoneId: 'UTC' });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const morning = new Date('2026-09-11T09:00:00Z');
  await pg.clock.setFixedTime(morning);
  await pg.goto(`${BASE}/index.html`);
  await pg.waitForSelector('.home', { timeout: 10000 });
  await settled(pg);
  await pg.locator('button.tile[aria-label="Tasks"]').tap();
  await pg.waitForTimeout(500);
  if (await pg.locator('.brief').count()) {
    await pg.getByRole('button', { name: 'Go to the full list' }).tap();
    await pg.waitForTimeout(300);
  }

  await showBar(pg);
  await pg.locator('.hot', { hasText: 'Brain dump' }).tap();
  await pg.waitForSelector('.sheet', { timeout: 5000 });
  await pg.locator('.sheet textarea').fill('Take medication 21:00\nTake medication 07:30\nWater the plants');
  await pg.waitForTimeout(200);
  await pg.getByRole('button', { name: /Add 3 tasks/ }).tap();
  await pg.waitForTimeout(500);

  const order = () => pg.locator('.sec').first().locator('.row .txt').allInnerTexts()
    .then(rows => rows.map(r => r.split('\n')[0].trim()));
  const morningOrder = await order();
  check('at 09:00 the evening dose is last',
    morningOrder[morningOrder.length - 1] === 'Take medication', morningOrder.join(' | '));
  check('and the morning dose still leads', morningOrder[0] === 'Take medication',
    morningOrder.join(' | '));
  check('the untimed task sits above the evening one',
    morningOrder.indexOf('Water the plants') < morningOrder.length - 1,
    morningOrder.join(' | '));
  check('exactly one row is marked as waiting', await pg.locator('.row.waiting').count() === 1,
    String(await pg.locator('.row.waiting').count()));
  check('the waiting row is the 21:00 one',
    (await pg.locator('.row.waiting .duetag').innerText()).includes('21:00'),
    await pg.locator('.row.waiting .duetag').innerText());
  check('a waiting row reads quieter than the rest', await pg.evaluate(() => {
    const w = getComputedStyle(document.querySelector('.row.waiting .txt')).color;
    const n = getComputedStyle(document.querySelector('.row:not(.waiting):not(.done) .txt')).color;
    return w !== n;
  }));
  check('but it is still fully tappable', await pg.evaluate(() => {
    const r = document.querySelector('.row.waiting .tickbtn').getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!(el && el.closest('.tickbtn'));
  }));

  /* Evening: the same task, three hours out. The app re-reads the clock on
     focus, which is what a phone does when you pick it back up. */
  await pg.clock.setFixedTime(new Date('2026-09-11T18:30:00Z'));
  await pg.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pg.waitForTimeout(400);
  const eveningOrder = await order();
  check('by 18:30 it has come up to the top', eveningOrder[0] === 'Take medication',
    eveningOrder.join(' | '));
  check('and no longer reads as waiting', await pg.locator('.row.waiting').count() === 0);
  check('the morning dose, now overdue, is still there too',
    eveningOrder.filter(x => x === 'Take medication').length === 2, eveningOrder.join(' | '));
  check('ticking the evening dose off still works', await (async () => {
    const row = pg.locator('.row').filter({ hasText: 'Take medication' }).first();
    await row.locator('.tickbtn').tap();
    await pg.waitForTimeout(350);
    return await pg.locator('.row.done').count() === 1;
  })());
  console.log('  errors:', errs.length ? errs : 'none');
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
stop();
process.exit(fail ? 1 : 0);
