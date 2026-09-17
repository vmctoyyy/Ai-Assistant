# The morning nudge server

The only server Life Today has. It exists because iOS Web Push needs someone
holding a VAPID private key to sign the send — a static site cannot do it.

**It stores a push subscription, a time, some days, a timezone and two dates.
That is the whole record.** There is no endpoint here that accepts a task, a
habit, a goal, a cart or a quote, and none that returns any. Those never leave
the phone.

The app ships with this switched off. `docs/push-config.js` is blank, so until
you deploy and fill it in, the settings panel says the nudge needs its server
set up and the toggle stays out of reach. Nothing else in the app changes.

## What is here

| file | what it is |
|---|---|
| `worker.js` | the Cloudflare Worker: four endpoints and a cron handler |
| `nudge.js` | when to send. Pure, and tested in `test/push.test.js` |
| `webpush.js` | RFC 8291 encryption and RFC 8292 VAPID, over WebCrypto |
| `wrangler.toml` | config; the KV id and secrets are yours to fill in |
| `keygen.mjs` | prints a VAPID pair and a suggested shared secret |

`webpush.js` uses WebCrypto rather than Node's crypto on purpose: Node's
`web-push` package does not run on Workers.

## Deploying

```sh
npm install -g wrangler        # or npx wrangler ... below
cd push
npx wrangler login

# 1. the key-value store
npx wrangler kv namespace create NUDGE
#    paste the printed id into wrangler.toml

# 2. the keys — nothing is written to disk, copy them out of the terminal
node keygen.mjs

# 3. the secrets (paste when prompted)
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put SHARED_SECRET

# 4. ship it
npx wrangler deploy
```

Then put three values into `docs/push-config.js`:

```js
window.QD_PUSH = {
  url: "https://life-today-nudge.<you>.workers.dev",
  publicKey: "<the VAPID_PUBLIC_KEY from keygen>",
  secret: "<the same SHARED_SECRET>"
};
```

Bump `CACHE` in `docs/sw.js` and push, as with any other change.

On the phone: Life Today must be **added to the Home Screen** — iOS gives a
PWA no push at all in a Safari tab. Then Settings → Morning nudge.

## The shared secret is not real access control

`docs/push-config.js` is served publicly and the repository is public, so
anyone who looks can read `SHARED_SECRET`. It stops drive-by scanners and
nothing more. Treat it as a speed bump.

What that exposes is bounded on purpose: there is exactly one record, the
endpoints only write scheduling fields, and nothing can be read back out. The
worst someone could do is delete your subscription, change when your own phone
is nudged, or make your own phone buzz. No data can be extracted, because none
is there.

If that ever stops being acceptable, the fix is a real auth flow, which means a
login, which means an account — a much bigger change than this feature is
worth. Say so and it can be looked at.

## Cron and the window

The cron runs every 15 minutes and `nudge.js` only fires inside a 15-minute
window after the chosen time. **These two numbers must match.** Make the cron
less frequent without widening `WINDOW_MINUTES` and some chosen minutes fall
between runs and never fire; widen the window without the cron and a late run
can send hours after the time you asked for.

A run that is a few minutes late still sends. One that is hours late does not.

## When it stays quiet

- not one of your chosen days
- before your chosen time, or more than 15 minutes after it
- already sent today
- **you already opened the app today** — a day you have started needs no nudge

`shouldSend` returns the reason alongside the decision, so a quiet morning can
be explained rather than guessed at.

## Verifying

```sh
node test/push.test.js
```

29 assertions. The scheduling is tested directly. The encryption is checked by
decrypting what we produce with `http_ece` — an independent implementation, the
one Node's `web-push` uses — rather than against itself, and the VAPID JWT is
verified against its own public key.

**Not tested here:** an actual delivery to Apple's or Google's push service.
That needs a deployed Worker and a real device, and the sandbox this was built
in cannot reach Cloudflare. Use "Send a test" in the settings panel as the
first real check.
