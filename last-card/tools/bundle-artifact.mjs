/**
 * Folds the Vite build into one self-contained HTML file for publishing.
 * No doctype/html/head/body wrapper — the Artifact host supplies those.
 *
 *   npx vite build && node tools/bundle-artifact.mjs
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');
const files = await readdir(assets);

const css = await readFile(join(assets, files.find((f) => f.endsWith('.css'))), 'utf8');
const js = await readFile(join(assets, files.find((f) => f.endsWith('.js'))), 'utf8');

// A literal </script> anywhere in the bundle would close the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<title>Last Card</title>
<style>
${css}
</style>

<div id="root"></div>

<script type="module">
${safeJs}
</script>
`;

const out = join(root, 'dist-artifact');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'last-card.html'), html);
console.log(`wrote dist-artifact/last-card.html — ${(html.length / 1024).toFixed(0)} kB`);
