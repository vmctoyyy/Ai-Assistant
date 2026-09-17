# Quiet Desk — working notes

A personal daily dashboard for one user, installed as a PWA on an iPhone home
screen. Static site in `docs/`, served by GitHub Pages.

**Pages deploys from the working branch `claude/personal-daily-dashboard-jibuyn`,
not from `main`.** Verified against the deployments API: every `github-pages`
deployment carries that branch as its ref, and none has ever been cut for a
`main` commit. So the push to the branch is what reaches the phone. Do not
"fix" this by pushing only to `main` — that would deploy nothing.

The app is a home screen plus five apps: **Tasks**, **Recap**, **Quotes**,
**Shopping** (carts), **Goals**, and one non-tappable placeholder. Goals was
rebuilt around momentum; the percentage-complete version and the `done`
completions ledger it needed are both gone, and `done` is a dead storage key. Home is a fixed
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

- **No network at runtime, with one named exception.** No CDN scripts, no web
  fonts, no API calls for anything the app does. React and Newsreader are
  vendored in `docs/vendor` and `docs/assets` and served same-origin. The app
  must cold-start and work completely with no signal.
  The exception is the **morning nudge** (`docs/nudge-client.js`), which talks
  to the Worker in `/push`. Every one of those calls is optional, deferred to
  an idle callback, and swallows its own failure: with the server down, not
  deployed, or no signal at all, the app behaves exactly as it always has.
  There are assertions for that. Nothing else may take a dependency on it.
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
- **`docs/` now serves two apps.** Quiet Desk is at the root and Last Card at
  `docs/last-card/` (built from `last-card/`, never edited by hand — run
  `npm --prefix last-card run build:pages`). The service worker's scope is the
  whole site, so it must claim only Quiet Desk's own paths: the app root and
  `vendor/`, `assets/`, `icons/`. Its navigation handler used to answer every
  in-scope navigation with the Quiet Desk shell, which made the sibling app
  render as the dashboard. `test/sw.test.js` and `test/pages.test.mjs` exist to
  stop that coming back; run both after touching `docs/sw.js`.

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

- **A date decides the bucket; nothing else does.** `effectiveBucket` reads
  the date when there is one and the manual `bucket` field only when there is
  not, so a stale manual bucket can never contradict a date. This *reverses*
  the original "buckets never change on their own" rule, deliberately and on
  request — `pickAnchored`, which used to offer dated tasks filed elsewhere
  for the user to accept, is gone because a dated task is now already where
  its date puts it. Undated tasks are unchanged: the user picks, nothing moves.
- **Nothing is written when a bucket is computed.** The stored `bucket` is
  left exactly as it was and the reading is derived at render time, which is
  what lets a task drift Future → This month → This week → Today on its own
  with no migration and no nightly job. Do not "fix" this by persisting the
  computed value. Every filter goes through `effectiveBucket(t, today)`, so
  `inBucket` now takes `today` as a third argument.
- **The week is Monday to Sunday, the month is the calendar month.** Nothing
  else in the app had a week boundary — `sinceLabel` and the recap both use
  rolling seven-day windows — so there was no Sunday-first convention to
  contradict. The cascade order matters: a week running past the end of the
  month keeps its own days, so a Thursday that falls on the 2nd of next month
  is still "this week". `bucketForDate` used to use rolling ≤7/≤31 windows;
  it does not any more, which moved some brain-dump parse expectations.
- **A date already gone keeps the task in Today, marked.** `isOverdue` is
  date-based and only applies to open tasks. Late work leads the day, oldest
  first, ahead of everything including timed work, and never sinks into the
  waiting band. The mark is `overdueLabel` — "due yesterday", "due Saturday" —
  stated by age exactly as a carry-in is, in the warm accent. **There is no
  red in this palette**; the spec's "small red label" was answered in the
  accent on purpose, and a test asserts the colour is warm. When a task is
  late the row drops its ordinary due line, because the tag already names the
  day and printing both says it twice.
- **A dated task is never also a carry-in.** `isCarryIn` is undated-only now;
  overdue expresses the same fact better for dated work, and labelling both
  would say it twice.
- **Clearing a date hands the task back to its manual bucket**, set to
  wherever the date had it (`applyPatch`), so it neither jumps nor vanishes
  from the list being looked at. The sheet does the same to its chips.
- **Ranking is total and deterministic:** late work first, then a time
  (chronological), then carry-ins oldest first, then importance, then
  `createdAt`, then `id`. The final `id` comparison is what stops the list
  reshuffling between reloads — do not remove it.
- **A time leads the day once it is close.** Today ranks in four bands
  (`todayBand`): 0 already late, 1 a time within `LEAD_MINUTES` (3h) or past,
  2 the flexible work, 3 a time still further off. Band 1 leads in clock order; the flexible work follows on the old carry-in →
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
  is run. There are two dedicated blocks at the end of `test/ui.test.mjs` using
  `page.clock.setFixedTime` in UTC that own those assertions — one for the
  lead-in, one for date-driven bucketing. **The same trap applies to dates**:
  a hardcoded date lands in a different bucket as real days pass, so anywhere
  outside those blocks use the browser's own today.
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
- **A goal owns nothing, and momentum is derived.** A goal names existing
  tasks and habits through their `goalId` and reads what they have done. It
  has no target, no deadline and no completion criteria — deliberately; it is
  a direction, not a contract. Deleting one *unlinks* its tasks and habits
  rather than deleting them, and takes only its own record.
- **Never show the number.** Momentum reads as a band — Dormant / Warm /
  Ember / Alight — carried by the bubble's own warmth. A score or a percentage
  is the progress bar coming back in disguise, and a test asserts no `%`
  appears on either goal screen. Only Alight gets fire, kept to amber and
  gold; heat never leaves the Goals screen.
- **Every number that shapes the feel lives in `MOMENTUM`** in `logic.js`:
  points (8/6/4 by importance, 5 flat for a habit), the daily ladder
  (3 at full, 3 at half, the rest at a quarter with a floor of 1), the 25/day
  ceiling, the single grace day and the 4/day decay. They are a first
  calibration meant to be retuned after a fortnight — change them there.
  Note the spec's own note that "about a week of silence returns a full goal
  to Dormant" does not hold at 4/day: a week removes 28, and 100 → Dormant
  needs 81, so about three weeks. Decay would need to be ~14/day to match.
- **`points` is stored per row, and `base` beside it.** `base` is the value
  before the day's ladder and ceiling; without it, an undo after a reload
  would recalculate from the already-capped figure and quietly shrink the
  rest of the day. `repointDay` re-walks a goal's day in completion order
  whenever a row is added or removed, so removing the second completion
  correctly re-scores the fifth.
- **The checkpoint is settled to the end of *yesterday*, never today.** Today
  is still earning, so it is left out of the cache and folded in live by
  `goalMomentum`. A new goal's `momentumAsOf` is the day *before* it was
  created, or its first day would be skipped.
- **Only a closed day can be a quiet day.** `rollMomentum` takes the real
  `today` and skips decay on it, so cooling appears the following morning
  rather than the instant midnight passes. That parameter is not the end of
  the roll — keying it off the roll's end made settling to yesterday skip
  yesterday's decay, and the cache silently disagreed with a replay. There
  are assertions that settling matches replaying, that settling twice is a
  no-op, and that settling daily matches settling once a week.
- **A paused goal neither earns nor cools.** Pausing settles first, so it
  freezes the value it actually had rather than a stale checkpoint.
- **Activity before the goal existed is refused** (`addActivity` drops it).
- **A habit's `goalId` is inherited by every instance it mints**, set once on
  the habit. Changing it reaches future instances only.
- **A habit's own generated task is not offered in the task picker.** It is
  minted fresh each morning and cleared at the rollover — link the habit.
- **The row control on a goal screen unlinks, and says so.** `TaskRow` takes
  `removeLabel`; without it the aria-label read "Delete: …" while the button
  unlinked, which told a screen reader the wrong thing.
- **Streaks are the one exception to the flat-tone rule, and they are
  deliberate.** The user asked for a Snapchat streak by name, was told it
  contradicts every tone rule in this file and the momentum spec's own "no
  streak language framed as something to protect", and chose it anyway. So
  `goalStreak` counts consecutive fed days, warns with an hourglass and hours
  remaining while the day runs out, and goes to zero when a day is missed.
  **The loss-aversion is confined to the streak badge.** Nothing narrates the
  break — the number simply is not there any more — and the recap prose and
  the boost block stay calm. Do not let it spread.
- **Two registers on purpose.** The recap paragraph is flowing prose, built
  from whole-clause templates picked deterministically from the date
  (`recapGoalProse`), so wording moves day to day and never changes under a
  re-read. The goal screen is clipped bullets. Do not make either read like
  the other. Only goals fed *today* appear in the prose; a quiet goal is
  simply absent and the section vanishes entirely when nothing was fed — that
  absence is not a message, so there is no empty state for it.
- **The activity log is kept oldest-first by `normGoals`, and the readers
  rely on it.** `recentActivity` walks back from the end and stops once it
  has its five; `activityOn` walks back and breaks the moment the log drops
  below the day asked for. Neither reads the whole history. If the sort order
  ever changes, both quietly return the wrong rows — there is an assertion on
  the ordering for that reason.
- **The recap prose is memoised, not persisted.** The spec asked for it to be
  "cached with the rest of the recap" and, two lines later, for "no new stored
  fields". It is a pure function of the log and the date, so the memo gives
  the caching without the stored field, and any past day can still be
  regenerated exactly.
- **The prose may name a band and say "four days in a row".** The spec's "no
  counts or band names" reads as "no numeric readouts", since its own worked
  example uses both; the rule is really no data-as-labels.
- **A rise in band gets a clause; a drop never does.**
- **Task titles in prose keep the user's words**, except a leading "The", "A"
  or "An", which reads wrong mid-sentence (`inSentence`). Nothing else is
  touched, or "MRI in Napier" and "Anna's birthday" get mangled.
- **"Ways to boost this" only ever lists things already linked and not yet
  done**, and never says what finishing one would do to the momentum. When
  there is nothing outstanding the block is absent — it must never suggest
  making more work. Those two guardrails are what keep it an offer rather
  than the progress bar in new clothes.
- **The record is the point of the feature.** It survives the underlying task
  being edited or deleted because each row snapshots the title at completion
  time, and it pages (`goalRecord(activity, goalId, offset, limit)`) because
  it is the part that grows without limit.
- **Per-task reminders are calendar events, not push.** Notification Triggers
  is not in Safari, and a push reminder for a specific task would mean the
  task's text and time living on a server. `buildICS` writes a `VALARM` at
  `-PT30M` and that stays the answer.
- **The morning nudge is the one push, and it knows nothing.** The server in
  `/push` holds a subscription, a time, some days, an IANA timezone and two
  dates — never a task, habit, goal, cart or quote, and it has no endpoint
  that could accept one. A UI assertion checks that nothing leaving the device
  carries app data. The notification body is a fixed calm line chosen by date:
  no counts, because the server cannot see anything to count.
- **It is skipped on a day already begun.** If the app has been opened, the
  nudge has no job to do. That is the point of the `/opened` ping.
- **The cron interval and `WINDOW_MINUTES` must stay equal** (15). Cron less
  often and chosen minutes fall between runs; window wider and a late run
  fires hours after the time asked for. There is an assertion that exactly one
  run in a whole day can fire.
- **`docs/push-config.js` ships blank and the feature stays dormant.** Until
  it is filled in the settings panel explains itself and the toggle is out of
  reach — the app is never left pointing at a server that is not there.
- **The shared secret in that file is public and is not access control.** The
  repo and the file are both public. It is a speed bump; what it exposes is
  bounded because there is one record holding only scheduling. See
  `push/README.md` before treating it as security.
- **`push/webpush.js` is WebCrypto, not Node crypto**, because Node's
  `web-push` does not run on Workers. Its encryption is verified in
  `test/push.test.js` by decrypting with `http_ece` — an independent
  implementation — rather than against itself. Delivery to a real push service
  is *not* tested: that needs a deployed Worker and a device.

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

Also: `env(safe-area-inset-*)` is `0` in Chromium but ~34-59px on a real
iPhone, so anything positioned against it is untested by default. The UI suite
now forces the insets on with an injected style and re-checks the shell — the
bubble still clearing the notch and the home indicator, the footer still on
screen, the body still scrolling, nothing overflowing sideways. Keep that
block; it is the only thing exercising the device's real layout.

**`.screen-body` carries no padding of its own.** Every block a screen puts
in it sets its own `1.125rem` horizontal inset, and a block that forgets runs
to the bubble edge and clips — which is what happened to the goal header, and
was already quietly true of the whole Habits screen. Assertions measure the
*content* (`.goal-h`, `.meter`, `.link-row`), not the container: a full-width
wrapper that carries the padding is doing its job and its own box legitimately
spans the width.

**Content must clear the bubble's corner sweep.** The 30px radius means
anything within about two thirds of that of the top or bottom edge reads as
crowded against the screen, which the user noticed. `.screen` holds the bubble
12px off every edge and `.screen-top` / `.composer` hold their content 20px
inside it; there are assertions on both, expressed against the live radius so
they follow `--bubble-r` if it changes. Prefer layouts that
do not depend on it — a flex header/body/footer rather than `position:sticky`
with a negative offset. `-webkit-overflow-scrolling:touch` mis-hit-tests on
iOS Safari; do not reintroduce it.

Note: this sandbox blocks `github.io`, `cdnjs`, `fonts.googleapis.com` and
`netlify.com`. The live site cannot be fetched from here — verify deploys via
the GitHub API instead, and say so rather than claiming the page was checked.
