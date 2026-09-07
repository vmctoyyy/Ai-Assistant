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
  app.js                  the React app
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

### Changing it

Edit `docs/app.js` or the styles in `docs/index.html` directly — there is
nothing to compile. After changing any file listed in `ASSETS` in `docs/sw.js`,
bump the `CACHE` version string in that file, or installed copies will keep
serving the old version from cache.
