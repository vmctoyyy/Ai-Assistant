# Quiet Desk — working notes

A personal daily dashboard for one user, installed as a PWA on an iPhone home
screen. Static site in `docs/`, served by GitHub Pages from `main`.

## Deploy workflow — do this without asking

The user has given standing permission to merge to `main`. Every change ends:

```
git push -u origin <feature-branch>
git checkout main && git merge --ff-only <feature-branch>
git push origin main
git checkout <feature-branch>
```

`main` is what GitHub Pages serves, so work left on a feature branch never
reaches the user's phone. This has already caused one silently missed update.
Report the merge in the summary; do not ask permission for it.

## Non-negotiables

- **No network at runtime.** No CDN scripts, no web fonts, no API calls.
  React and Newsreader are vendored in `docs/vendor` and `docs/assets` and
  served same-origin. The app must cold-start with no signal.
- **Bump `CACHE` in `docs/sw.js`** whenever any file listed in its `ASSETS`
  changes. Without it, installed copies keep serving the old version from
  cache and the user sees nothing change.
- **All paths stay relative.** Pages serves from a subdirectory
  (`/Ai-Assistant/`), so absolute paths break the service worker scope,
  the manifest and the icons.
- **Inputs stay at 16px or larger**, or iOS zooms in on focus.
- **Data lives only on the device** (IndexedDB, localStorage fallback).
  Nothing is uploaded anywhere. Back up & restore is the only way out.

## Architecture

- `docs/logic.js` — pure functions: task model, migration, rollover, ranking,
  suggestions, brief copy, ICS export. No DOM, no storage. Exported as
  `window.QD` in the browser and `module.exports` under node.
- `docs/app.js` — React UI only. All rules belong in `logic.js` so they can
  be tested.
- `test/logic.test.js` — `node test/logic.test.js`. Add assertions here for
  any rule change; it is the only automated safety net.

## Product rules that are easy to break

- **Buckets never change on their own.** Anything that would move a task
  between `today` / `this_week` / `this_month` / `future` must be an explicit
  user action. Date-anchored tasks are offered as suggestions, never moved.
- **Ranking is total and deterministic:** carry-ins oldest first, then
  importance, then `createdAt`, then `id`. The final `id` comparison is what
  stops the list reshuffling between reloads — do not remove it.
- **Appointments do not affect ranking.** A `dueTime` makes a task a fixed
  point in the brief; it does not reorder the flexible list.
- **Tone is flat.** No streaks, badges, praise or guilt. Carry-ins are stated
  by age, never as failure. Generated copy carries no exclamation marks — a
  test asserts this.
- **Reminders are calendar events, not push.** iOS Web Push needs a server
  signing with VAPID keys; this app has no server, and Notification Triggers
  is not in Safari. `buildICS` writes a `VALARM` at `-PT30M`.

## Verifying

Tests are necessary but not sufficient — several real bugs (a sheet with no
scroll, a button under the fixed composer) were only visible in a browser.
Drive the app with Playwright against `python3 -m http.server` in `docs/`,
using an iPhone SE viewport for anything involving the sheet or the composer.
Chromium lives at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

Note: this sandbox blocks `github.io`, `cdnjs`, `fonts.googleapis.com` and
`netlify.com`. The live site cannot be fetched from here — verify deploys via
the GitHub API instead, and say so rather than claiming the page was checked.
