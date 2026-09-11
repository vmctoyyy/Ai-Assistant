# Quiet Desk — working notes

A personal daily dashboard for one user, installed as a PWA on an iPhone home
screen. Static site in `docs/`, served by GitHub Pages.

**Pages deploys from the working branch `claude/personal-daily-dashboard-jibuyn`,
not from `main`.** Verified against the deployments API: every `github-pages`
deployment carries that branch as its ref, and none has ever been cut for a
`main` commit. So the push to the branch is what reaches the phone. Do not
"fix" this by pushing only to `main` — that would deploy nothing.

The app is a home screen plus four apps: **Tasks**, **Recap**, **Quotes**,
**Shopping** (carts), and two non-tappable placeholders. Home is a fixed
non-scrolling page — a 25% header (date + the day's quote) over a 75% grid of
six icons. **Habits** is a fifth app reached from the Tasks hot bar rather than
the home grid — that was the user's explicit choice, so do not promote it to a
tile without asking.

An app opens as a **bubble**: a rounded card inset from the viewport edges,
never full-bleed. `.bubble` is the scroll container, so `.screen-body` is the
only thing that scrolls and the composer is an in-flow footer on the bubble's
bottom edge rather than a fixed overlay. Sheets are bubbles too, rounded on
all four corners. Nothing in the app should meet a viewport edge with a
square corner.

**Markets, Today's Schedule and the old Habits app were removed** from the UI.
Their storage keys (`markets`, `schedule`, `habits`) are read once at boot,
carried untouched in `retired`, and included in backups — never written, never
reset. The old 4-toggle habit dot history is meant to survive, so do not add
them to `resetAll`. The Habits feature that came back later is a different
model under `habitsv2` and must never write to `habits`.

## Deploy workflow — do this without asking

The user has given standing permission to merge to `main`. Every change ends:

```
git push -u origin <feature-branch>     # this is the one that deploys
git checkout main && git merge <feature-branch>
git push origin main
git checkout <feature-branch>
```

The **first** line is what reaches the user's phone, since Pages builds the
working branch (see above). Keeping `main` in step is still worth doing so the
default branch is not stale, but it is bookkeeping, not the deploy — do not
report a merge to `main` as the thing that shipped. Report the merge in the
summary; do not ask permission for it.

(An earlier version of this file claimed Pages served `main`. It never has.
The "silently missed update" that story was attached to was really the service
worker not applying itself, which is fixed under Non-negotiables below.)

## Non-negotiables

- **No network at runtime.** No CDN scripts, no web fonts, no API calls.
  React and Newsreader are vendored in `docs/vendor` and `docs/assets` and
  served same-origin. The app must cold-start with no signal.
- **Bump `CACHE` in `docs/sw.js`** whenever any file listed in its `ASSETS`
  changes. Without it, installed copies keep serving the old version from
  cache and the user sees nothing change.
- **Updates apply themselves.** The app reloads once when a new service
  worker takes control, and asks for an update on launch and on every return
  to the foreground. Before this, a shipped change could be live and still
  invisible until a full relaunch, which cost the user a round trip. The
  `hadController` guard stops the very first install reloading a page that is
  already current — do not remove it. Note this means a fresh context never
  reloads, so testing the update path needs a load, a reload (to become
  controlled), and only then the new version.
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
- **Ranking is total and deterministic:** a time first (chronological), then
  carry-ins oldest first, then importance, then `createdAt`, then `id`. The
  final `id` comparison is what stops the list reshuffling between reloads —
  do not remove it.
- **A time leads the day once it is close.** Today ranks in three bands
  (`todayBand`): a time that is due, overdue or within `LEAD_MINUTES` (3h)
  leads in clock order; the flexible work follows on the old carry-in →
  importance → `createdAt` → `id` chain; a time still further off waits at the
  *bottom*, in clock order, marked `.waiting` so it reads quieter. A 21:00
  medication is not 09:00's business, and keeping it in the eyeline all day is
  how it stops being read at all. An overdue time never sinks — a missed dose
  stays in front of you.
  Only a time that applies *today* counts (`isFixedToday`): a task sitting in
  `today` but dated next Tuesday does not jump the queue. Other buckets follow
  `timeAnchor`, ordered by date then time, with no lead-in.
- **`rankToday`'s `nowMin` is optional, and omitting it means "no yet".** With
  no clock every timed task leads, which is the two-band behaviour the brief
  wants — the brief shows the whole shape of the day, so `fixedPoints` and the
  brief's own `rankToday` call stay clock-free. Only the Tasks list passes the
  clock. Because of this, **never assert clock-dependent order in a UI test
  running on the real clock** — whether 07:30 leads depends on when the suite
  is run. There is a dedicated block at the end of `test/ui.test.mjs` with
  `page.clock.setFixedTime` in UTC that owns those assertions.
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
- **Creating a cart and saving its shop is one write.** The "Save this shop
  for next time" tick makes `createCart` touch both `carts` and `shops`; two
  separate `setCarts` calls would each read the same stale record and the
  second would drop the first. `addShopIfNew` matches on name so ticking twice
  leaves one chip, and never recolours a shop that already exists.
- **A cart's colour is a copy, not a link.** `makeCart` copies a saved
  shop's name and colour at creation. Editing or deleting the shop must never
  reach back into carts already made — there are assertions for both.
- **Ticked cart items are swept at midnight, not on tick.** `sweepCarts`
  drops items whose `checkedAt` falls on an earlier day, and runs on open and
  at rollover — a PWA gets no time to run while closed. It early-returns when
  `lastSweptOn` is today, so seed fixtures with an *earlier* date or the sweep
  correctly does nothing and the test looks broken.
- **Emptying a cart and removing a cart get a real dialog**, not the inline
  "tap again" used elsewhere. Both are unrecoverable, so the dialog names what
  goes and how much of it. Do not downgrade them to the routine affordance.
- **Text on a user-chosen colour uses `contrastInk`**, never a fixed ink.
- **A habit is a rule, not a task.** `generateHabitTasks` mints task
  instances into `today` on open and at rollover, keyed in a `gen` ledger by
  habit + slot + day. The ledger is what makes deleting a generated task
  stick: without it the next open would put it straight back. Saving a habit
  mints anything it has already missed today, so one added at nine still shows
  its Wednesday task.
- **Unfinished habit instances clear at the rollover** (`dropStaleHabitTasks`)
  rather than carrying in. Yesterday's gym is not today's gym, and a missed
  routine that piles up week on week turns the list into the scoreboard this
  app deliberately is not. Ordinary carry-ins are untouched.
- **Editing a habit never reaches back into tasks it already minted**, and
  ticking an instance off is just that day. There are assertions for both.
- **A slot that could never fire is rejected, not stored** — a weekly slot
  with no days, a dates slot with no dates. A monthly slot on the 31st lands
  on the last day of a shorter month rather than skipping February.
- **Days are stored 0–6 from Sunday but always read Mon–Sun** (`weekOrder`).
  Sorting them numerically for display gives "Sun/Sat", which is wrong.
- **Reminders are calendar events, not push.** iOS Web Push needs a server
  signing with VAPID keys; this app has no server, and Notification Triggers
  is not in Safari. `buildICS` writes a `VALARM` at `-PT30M`.

The Tasks footer rests as a three-button **hot bar** — Add task, Habits, Brain
dump — and becomes the quick-add composer when the first is tapped. Opening it
calls `ReactDOM.flushSync` before `focus()`, because iOS only raises the
keyboard for a focus that is still inside the tap that asked for it; leave that
in place. The UI suite's `openAdd()` / `showBar()` helpers exist because the
input and the two bar buttons are never on screen at the same time; `showBar()`
retries, because the composer folds itself away on an empty input and the close
button can detach mid-tap.

**`TaskSheet` builds a task as well as edits one**, under `isNew`. The quick
add stays the fast path — type, Add, keyboard holds for the next one — and its
"Date, time & note" link hands whatever is already typed to the full sheet, so
nothing is lost and nobody has to add a task and go back in to say when it is.
In `isNew` the sheet drops what cannot apply yet: no delete, no "added" line,
no reminder (`buildICS` reads the *stored* title, so exporting an event for a
task that does not exist would carry the wrong one). Do not duplicate the
date/time/note controls into the composer — it sits above the keyboard and
there is not room; the sheet is where that density belongs.

Note the sheet's confirm button is labelled "Add task" in `isNew`, the same
accessible name as the composer's own Add button. They are never both reachable
(the sheet is `aria-modal`), but UI tests must scope to `.sheet` or the locator
is ambiguous.

The Tasks footer shows the running build, read from the live cache name
rather than a constant, so "which version am I on" is answerable without
guessing. On a first install the cache does not exist yet when the boot
effect runs, which is why it reads again on `serviceWorker.ready`.

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

A controlled `<input type="color">` ignores a directly assigned `.value` —
React does not see it. Tests must drive it through the native value setter
plus an `input` event, as `test/ui.test.mjs` does. A test that skips this
reports every colour as the fallback and looks like an app bug.

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
