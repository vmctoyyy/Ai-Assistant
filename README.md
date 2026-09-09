# Ai-Assistant

## Quiet Desk

A personal daily dashboard for iPhone. Three priorities, a running task list,
today's schedule, four daily habits, and manually entered market prices.

Everything is stored on the device in IndexedDB. There is no account, no server
and no network call after the first load — the app works fully offline.

The app lives in [`docs/`](docs/) and is a static site with no build step.

```
docs/
  index.html              app shell, all styling
  app.js                  the React app (UI)
  logic.js                task model, ranking, brief copy — pure, no DOM
  sw.js                   service worker (precaches everything for offline)
  manifest.webmanifest    name, icons, standalone display
  vendor/                 React 18 UMD builds, served same-origin
  assets/                 Newsreader (display face), served same-origin
  icons/                  app icon at each size iOS asks for
```

### Publishing it

**GitHub Pages**, from this repository, is the simplest route: no extra account
and no third-party app authorization. It requires the repository to be public —
Pages will not serve a private repository on a free plan.

**Settings → Pages → Source: Deploy from a branch → `main` / `/docs`.** The site
appears at `https://<user>.github.io/Ai-Assistant/` a minute or two later, and
redeploys on every push to `main`.

Everything in `docs/` uses relative paths, so serving from a subdirectory like
`/Ai-Assistant/` works without changes: the service worker scope, the manifest
`start_url` and the icon paths all resolve under it. `docs/.nojekyll` stops
GitHub running the site through Jekyll.

To keep the repository private instead, Cloudflare Pages and Netlify both build
private repos on their free tiers. Set framework preset **None**, build command
**blank**, output directory **`docs`**.

HTTPS is required either way — the service worker that makes the app work
offline will not register over plain HTTP.

### Installing it on an iPhone

Open the URL in **Safari** (not Chrome — only Safari can install to the home
screen on iOS), then **Share → Add to Home Screen**. It launches full screen
with no browser chrome, and works with no signal.

### Backing it up

Because the data lives only on the phone, deleting the app deletes the data.
**Back up & restore** at the bottom of the page exports everything as JSON and
takes it back again.

### The morning brief

On the first open of each local day the app shows a brief instead of the list:
a greeting with the day's count, one "start here" sentence naming the
top-ranked task and why it is first, the ranked list, any carry-ins from
previous days, and suggestions pulled up from other buckets when today is thin.
Later opens that day go straight to the list; the brief stays reachable from
the "Today's brief" link in the header.

Tasks carry a `bucket` (`today` / `this_week` / `this_month` / `future`) and an
`importance` (`must` / `should` / `nice`). Ordering is automatic and total —
carry-ins oldest first, then importance, then age, then id — so the list never
reshuffles between reloads on the same day. Buckets only ever change when the
user changes them.

Each task row has an options button that opens a sheet for renaming, changing
importance, moving it to another bucket, adding a short note, or deleting it.
Moving a task out of `today` and back later resets its carry-in clock, so a
returning task is not mistaken for one that has been waiting all along.

The ranking, suggestion, stale-check, migration and copy rules live in
`docs/logic.js` with no DOM or storage dependencies, and are covered by
`test/logic.test.js`:

```
node test/logic.test.js
```

### Changing it

Edit `docs/app.js` or the styles in `docs/index.html` directly — there is
nothing to compile. After changing any file listed in `ASSETS` in `docs/sw.js`,
bump the `CACHE` version string in that file, or installed copies will keep
serving the old version from cache.
