# Quiet Desk — working notes

A personal daily dashboard for one user, installed as a PWA on an iPhone home
screen. Static site in `docs/`, served by GitHub Pages from `main`.

The app is a home screen plus four apps: **Tasks**, **Recap**, **Quotes**,
**Shopping List**, and two non-tappable placeholders. Home is a fixed
non-scrolling page — a 25% header (date + the day's quote) over a 75% grid of
six icons. Only app screens scroll.

**Markets, Today's Schedule and Habits were removed** from the UI. Their
storage keys (`markets`, `schedule`, `habits`) are read once at boot, carried
untouched in `retired`, and included in backups — never written, never reset.
Habit history in particular is meant to survive for a possible return, so do
not add them to `resetAll`.

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
  be tested. `APP_TILES` near the top holds each home icon's entire visual;
  swapping a placeholder for real artwork means editing only that array.
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
- **Brain dump parsing is rule-based and offline.** `parseTaskLine` reads
  times, dates, notes, importance and bucket out of a line. It recognises a
  fixed set of shapes and leaves anything else in the title — it must never
  guess. Month and weekday patterns are spelled out in full so "Monitor" is
  not read as Monday and "Separate" as September. The sheet shows a preview
  with the date spelled out before anything is saved; do not remove it.
- **Only the check circle completes a task.** Tapping the title opens the
  options sheet. A stray tap on a wide row must never tick something off, so
  do not put `onToggle` back on the row body. The `.tickbtn` / `.rowbody`
  split is what the tests target.
- **Ticking a task off never removes it from view.** Completed tasks stay on
  screen, struck through, in every bucket until the midnight rollover clears
  them — an accidental tap must be undoable by tapping again. `inBucket` is
  open items only; pair it with `completedInBucket` wherever tasks are listed.
- **Batch creation staggers `createdAt`.** Tasks made in one go otherwise
  share a millisecond, and the ranking tie-break falls through to the random
  id, losing the order they were typed in.
- **The day's quote is deterministic from the date.** `quoteForDay` indexes
  by days since a fixed epoch, so it holds all day and turns at midnight. An
  empty saved list falls back to the 30 built-ins; one saved quote replaces
  them entirely.
- **Recap needs the archive.** Completed tasks are cleared at midnight, so
  `archiveCompleted` files them into the `recap` key first — at boot when a
  day has turned, and in the rollover effect. Remove that and Recap silently
  empties.
- **The morning brief belongs to Tasks.** It opens the first time Tasks is
  opened each day (`openApp`), not when the app launches. The rollover
  deliberately leaves `lastBriefShownOn` on yesterday so the next visit shows
  it.
- **Reminders are calendar events, not push.** iOS Web Push needs a server
  signing with VAPID keys; this app has no server, and Notification Triggers
  is not in Safari. `buildICS` writes a `VALARM` at `-PT30M`.

## Verifying

Two suites, both required:

```
node test/logic.test.js                    # pure rules
npm i playwright && CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node test/ui.test.mjs                    # taps every control in a browser
```

Logic tests cannot see hit-testing, focus or layout bugs. Every UI bug that
has reached the user got past a green logic suite. When touching the sheet or
the composer, run the UI audit.

Two rules in `test/ui.test.mjs` exist because breaking them shipped a broken
build to the user's phone:

- **Use `tap()`, never `click()`.** A tap blurs whatever had focus first.
  A whole row of composer chips was dead on a real phone while `click()`
  tests passed, because the input blurred and unmounted the chips before the
  tap landed.
- **Tap chips BEFORE typing.** Tests that typed first kept the chip row open
  and hid the bug entirely. The empty-input path is the one people use.

When deleting a feature's CSS, check what else lived in that block. Removing
the schedule and markets sections took `.field`, `.btn`, `.disc`, `.meta` and
`.chev` with them — shared controls that happened to sit there — and every
input in the app fell back to a browser default border. The tests all passed;
a screenshot caught it.

Watch for guards that disable a gesture wholesale: `if (e.target.closest("button"))`
in the swipe handler made swipe-to-delete unreachable for months, because the
row's tap targets are themselves buttons. Scope such guards to the specific
control (`.iconbtn`), not to a tag name.

Also: `env(safe-area-inset-*)` is `0` in Chromium but ~34px on a real iPhone,
so anything positioned against it is untested by default. Prefer layouts that
do not depend on it — a flex header/body/footer rather than `position:sticky`
with a negative offset. `-webkit-overflow-scrolling:touch` mis-hit-tests on
iOS Safari; do not reintroduce it.

Note: this sandbox blocks `github.io`, `cdnjs`, `fonts.googleapis.com` and
`netlify.com`. The live site cannot be fetched from here — verify deploys via
the GitHub API instead, and say so rather than claiming the page was checked.
