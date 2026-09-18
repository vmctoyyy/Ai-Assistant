/**
 * Renders the app icon at every size iOS and Android ask for.
 *
 * There is no image library in this sandbox, but there is a browser — so the
 * icon is drawn as HTML and screenshotted. Re-run after changing the design:
 *
 *   node tools/make-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
await mkdir(out, { recursive: true });

// iOS masks the corners itself and shows no transparency, so the felt runs
// full bleed. The card sits inside the middle 80% so a maskable crop on
// Android cannot clip it.
const icon = (size) => `
<style>
  html, body { margin: 0; padding: 0; }
  .icon {
    width: ${size}px; height: ${size}px;
    display: grid; place-items: center;
    background: radial-gradient(118% 80% at 50% 4%, #1a4d35 0%, #14402c 46%, #0b2418 100%);
    overflow: hidden;
  }
  .card {
    width: ${size * 0.46}px; height: ${size * 0.64}px;
    border-radius: ${Math.max(2, size * 0.06)}px;
    background: linear-gradient(160deg, #fffdf7 0%, #f6f1e4 100%);
    transform: rotate(-7deg);
    display: grid; place-items: center;
    box-shadow: 0 ${size * 0.035}px ${size * 0.07}px rgba(0, 0, 0, 0.42);
  }
  .pip {
    width: ${size * 0.26}px; height: ${size * 0.26}px;
    fill: #16181a;
  }
</style>
<div class="icon">
  <div class="card">
    <svg class="pip" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2c-1.9 3.2-4.4 5.2-6.3 7.1-1.6 1.6-2.4 3-2.4 4.7 0 2.6 2 4.5 4.5 4.5 1.4 0 2.6-.6 3.4-1.5-.2 1.9-.9 3.5-2.1 4.8h5.8c-1.2-1.3-1.9-2.9-2.1-4.8.8.9 2 1.5 3.4 1.5 2.5 0 4.5-1.9 4.5-4.5 0-1.7-.8-3.1-2.4-4.7C16.4 7.4 13.9 5.4 12 2.2z"/>
    </svg>
  </div>
</div>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const size of [120, 152, 167, 180, 192, 512, 1024]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(icon(size));
  const buf = await page.locator('.icon').screenshot({ omitBackground: false });
  await writeFile(join(out, `icon-${size}.png`), buf);
  await page.close();
  console.log(`icon-${size}.png`);
}

await browser.close();

console.log('done — these are generated, do not edit them by hand');
