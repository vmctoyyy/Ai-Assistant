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

  console.log('-- sheet: every control by tap --');
  await pg.getByRole('button', { name: 'Go to the full list' }).tap();
  await pg.waitForTimeout(250);
  await pg.locator('.disc', { hasText: 'This week' }).tap();
  await pg.waitForTimeout(250);
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
  console.log('  errors:', errs.length ? errs : 'none');
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
stop();
process.exit(fail ? 1 : 0);
