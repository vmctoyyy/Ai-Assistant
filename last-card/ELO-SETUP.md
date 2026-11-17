# Elo rankings — backend setup

The rankings need a database. Until you do the steps below, the Rankings
screen says it is not set up and saves nothing — the same way the morning
nudge stays dormant until `docs/push-config.js` is filled in.

This is about 10 minutes, all in a browser, and it is free at this size.

## 1. Make a Firebase project

1. Go to **console.firebase.google.com** and sign in with a Google account.
2. **Create a project**. Any name. Turn Google Analytics **off** — nothing
   here uses it.

## 2. Add a web app and copy the config

1. On the project's home page, click the **web** icon (`</>`).
2. Give it a nickname. Do **not** tick "Firebase Hosting" — the app is already
   hosted on GitHub Pages.
3. It shows you a `firebaseConfig` block. Copy those six values.

## 3. Create the database

1. In the left menu: **Build → Firestore Database → Create database**.
2. Choose **Production mode** (the rules below replace the defaults anyway).
3. Pick the location nearest you. **This cannot be changed later.**

## 4. Paste the rules

Firestore Database → **Rules** tab. Replace everything with this, then
**Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // The rankings. Open to anyone, because the feature has no login.
    match /eloPlayers/{playerId} {
      allow read: if true;
      allow create, update: if true;
      allow delete: if false;        // records are never destroyed
    }

    match /eloGames/{gameId} {
      allow read: if true;
      allow create, update: if true;
      allow delete: if false;        // records are never destroyed
    }

    // Everything else in this project stays shut.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 5. Paste the config into the app

Open `last-card/src/elo/config.ts` and fill in the six blank values from
step 2. They are not secrets — a Firebase web config identifies the project,
it does not authorise anything. What decides who can do what is the rules
above.

Then rebuild and deploy:

```
npm --prefix last-card run build:pages
git add -A && git commit -m "Connect the rankings database" && git push
```

---

## What those rules actually allow — read this bit

They are deliberately wide open, because you asked for no login. Plainly:

**Anyone who has the page address can:**

- read every player name and every recorded game;
- add players and games;
- edit or hide any existing player or game, including ones they did not add.

**Nobody can:**

- permanently destroy anything — `allow delete: if false` is enforced by the
  database, not just by the app, so even a hostile script cannot erase the
  history;
- touch any other collection in the project.

**So the realistic risk is vandalism, not theft.** There is nothing private
here — names and win/loss records — but someone who found the address could
add nonsense or hide real games. Because nothing can be destroyed, the fix is
always the same: **Export backup**, and restore from a good one if needed.
Take a backup now and then; it is one button.

**If that is not good enough later**, the smallest change that helps is
Firebase **Anonymous Authentication** plus `if request.auth != null` on the
write rules. That stops drive-by scripts without adding a login screen. It is
not built, and it would not stop anyone who has actually opened the page.

## Cost

Firestore's free tier is 50,000 reads, 20,000 writes and 1 GiB a day. A group
recording a few games a week will not get near it. The app reads both
collections once per device per session and then listens for changes, so cost
scales with how many people have it open, not with how many games there are.

## If it stops working

The Rankings screen shows the error rather than pretending. The usual causes:

- **"Could not read the players/games from Firestore"** — the rules were not
  published, or the project id in `config.ts` is wrong.
- **Nothing saves, no error** — should not happen; every write is awaited and
  a failure is shown. If you see it, say so, because that is a bug.
