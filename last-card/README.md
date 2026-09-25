# Last Card — Phase 1

A pass-and-play web version of Last Card for 2–6 people on one phone. Two
standard decks plus four jokers (108 cards), so duplicate cards are normal —
which is what makes jump-ins and the 8s rule mean anything.

Phase 1 is local only: no networking, no backend, no accounts. The point of it
is a correct, fully tested rules engine. The engine is pure TypeScript with no
React or DOM anywhere in it, so Phase 2 can run the same code on a server to
validate moves.

## Running it

```
cd last-card
npm install
npm run dev          # http://localhost:5173
```

## Publishing it

```
npm run build:pages     # -> ../docs/last-card/, which GitHub Pages serves
npm run build:artifact  # -> dist-artifact/last-card.html, one self-contained file
```

`build:pages` output is committed, because Pages serves straight from `docs/`.
Never hand-edit `docs/last-card/` — rebuild it.

It ships as an installable app: `public/manifest.webmanifest`, an
`apple-touch-icon` set, and `public/sw.js` for offline play, so "Add to Home
Screen" gives a real icon and a standalone window rather than a browser tab.
The icons are generated — `node tools/make-icons.mjs` re-renders them through
headless Chromium after a design change; do not edit the PNGs.

**Both apps share one origin, so they share one `CacheStorage`.** Each worker
must sweep only its own cache prefix on activate. Deleting every unrecognised
key — the obvious way to write that cleanup — makes whichever app activates
last wipe the other's offline copy. `test/sw.test.js` asserts both directions.

Quiet Desk sits at the root of the same Pages site and registers a service
worker whose scope covers the whole thing, this app included. It is scoped to
only claim its own paths; `test/sw.test.js` and `test/pages.test.mjs` in the
repository root guard that, the latter by installing the real worker and then
walking into this app.

## Testing

```
npm test             # 70 engine tests (vitest)
npm run test:ui      # builds, then taps every control in a real browser
npm run test:all     # both
npm run typecheck
```

From the repository root, `node test/sw.test.js` and `node test/pages.test.mjs`
cover the two apps sharing one service worker scope.

`npm run test:ui` needs the Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; change `executablePath`
in `test/ui.smoke.mjs` if yours lives elsewhere.

The engine suite is the safety net for rules. The browser smoke test exists
because a green rules suite cannot see a dead button, a control pushed off the
bottom of a phone screen, or a sheet that opens with everything in it disabled —
it taps rather than clicks, checks tap targets are at least 44px, and pins one
deal with `?seed=128` so the joker nomination sheet is exercised on every run.

## Layout

```
last-card/
  src/
    engine/          pure rules — no React, no DOM, no clock, no Math.random
      types.ts       Card, GameState, Move, GameConfig
      deck.ts        deck construction, seeded shuffle, card predicates
      rules.ts       createGame, legalMoves, applyMove, cardPlayability
      testkit.ts     scenario builders used by the tests
      engine.test.ts
    state/
      useGame.ts     React glue: whose hand is showing, timers, error toasts
    ui/              dumb rendering
  test/ui.smoke.mjs  browser pass
```

The engine's public surface:

```ts
createGame(playerNames, config?, seed?): GameState
legalMoves(state, playerId): Move[]
applyMove(state, move): GameState        // throws IllegalMoveError
cardPlayability(state, card, calledCard?): { ok, reason? }
```

`applyMove` never mutates — a test asserts the input state is byte-identical
afterwards. Shuffling runs off a seed carried on the state, so a game replays
exactly from its move list and nothing in the engine reads the clock.

`legalMoves` returns move **templates**: plays involving an ace or a joker come
back without a nomination, and the caller fills in `calledSuit` / `calledCard`.

## Rule ambiguities and the calls made on them

The brief left a number of things open. Each of these is a judgement call, not
something the rules settled — they are the first places to look if the game
plays wrong at a real table.

1. **Plain cards during a pick-up.** The brief says 2s, 5s, 7s, 10s and jacks
   may be played on any suit during a chain, "plus any card that would already
   be legally playable". Read literally that lets a plain 6♠ on a 6♥ dodge the
   whole chain, and nothing says what becomes of the pick-up when it does.
   **Call:** during a chain you may play only 2/5/7/10/J plus the cards that are
   always playable (ace, joker, one-eyed K♦) — otherwise you pick up. The
   literal reading is available as `allowPlainCardDuringPickup: true`.

2. **Winning on a power card.** "The win doesn't count" could mean the card goes
   down and play continues, which would leave a player sitting there with an
   empty hand. **Call:** the move is refused outright with a message, so the
   player picks something else or draws.

3. **How much you pick up after a missed Last Card call.** The brief says "must
   pick up" without a number. **Call:** one card
   (`missedLastCardPenalty`). The cards are still played; only the win is
   cancelled.

4. **What a jump-out does to the beaten winner.** "Reopens the game" does not
   say what the player with no cards left does next. **Call:** they pick up one
   card (`jumpOutPenalty`) and rejoin, and play continues from the jumper.

5. **Regular kings are not power cards.** The brief lists "King (regular) — no
   effect", so you may go out on K♠/K♥/K♣. The one-eyed K♦ *is* a power card and
   you may not go out on it.

6. **A joker must name a card that could have been played.** "May be played as
   any legal card in the game" — the weight is on *legal*. The first build read
   the joker as a pure wild and let the nomination be anything, which put a J♦
   on a 6♥ in a real game. The nomination is now held to ordinary matching: it
   must match the active rank or suit, or be a 2/5/7/10/J while a pick-up is
   running. It carries the power of whatever it names, so a joker called a 2
   adds 2 to the chain and one called a 7 blocks it.
   The always-playable exemptions deliberately do **not** carry over — a joker
   may not be called an ace or the one-eyed K♦. Both are legal on anything, so
   allowing them would reopen the same hole one step further along: call it an
   ace, and it goes down on anything and names any suit.
   The joker itself is still never the blocker — some legal nomination always
   exists — so it never sits dead in a hand. `legalNominations(state)` returns
   the full set, and the picker greys out the rest rather than accepting a
   choice and then rejecting it.

7. **The one-eyed king takes exactly one card.** If two K♦ go down together,
   only the card that was on the pile before the group is picked up — the second
   king does not take the first.

8. **Multi-card effects stack.** Two 2s is a pick-up of 4; two 10s skip two
   players; two jacks reverse twice (so, not at all), or skip twice heads-up.

9. **During a pick-up, a 10 or a jack carries you past it rather than skipping
   a turn.** The card's skip is spent on *you* — you do not pick up, and the
   chain passes on intact, as in the worked example where `10♣` is followed by
   the next player's `J♥`. A jack still reverses direction at three or more
   players, and the chain then passes on in the new direction.
   The first build applied the jack's heads-up skip during a chain too, so two
   players in, a jack skipped the opponent and landed the pick-up straight back
   on the player who had just escaped it. It does not skip a turn during a
   pick-up at any table size.
   Extra cards in the group carry one more player past the chain each — two
   tens duck you and the player after you. That is **capped so the chain can
   never come back round to whoever ducked it**: heads-up there is nobody to
   carry past, so a second ten simply adds nothing rather than punishing you
   for playing it. Outside a pick-up nothing changes: tens skip a turn each,
   and a jack reverses, or skips heads-up.

10. **Group ordering is the player's choice.** In a multi-card play the *first*
    card must be legal against the pile and the *last* one sets the suit going
    forward. A group led by an illegal card is refused rather than silently
    reordered.

11. **A nuclear pick-up can still be blocked.** Nothing says 25 is unstoppable,
    so a 7, an ace or the one-eyed king still cancels it. The "+100 in point
    games" is noted on the state as `nuclear` but there is no scoring in Phase 1.

12. **An ace during a chain keeps its own suit.** Any `calledSuit` sent with it
    is ignored, per the brief.

13. **The turn-up.** The deal keeps turning cards until a non-power card
    appears, so nobody has to resolve a power card before the first turn; the
    rejected cards are shuffled back into the draw pile.

14. **Who confirms a penalty.** The brief says players may defend themselves, so
    a penalty is a *proposal* that freezes the game until it is applied or
    dismissed. On one phone the app does not try to police which pair of hands
    presses which button — it shows the accusation, the reason and the amount,
    and the table decides. Amounts are editable, so a 15 negotiated down to 6
    is just typed in.

15. **Jump-ins carry the card's power**, including adding to a live chain, and
    the match is on the *physical* card — so a jump-in on a joker needs another
    joker, not the card the joker was called as.

16. **The Last Card window closes on any turn action by another player** — a
    draw or a decline-to-play counts, not only a card going down.

17. **Hand size.** Not specified; 7 each, configurable in setup.

18. **"You cannot Pick-and-Play to win."** Given the rest of the rules, a
    pick-and-play can only empty a hand that was already empty, which is only
    reachable when a blocked win coincided with an exhausted draw pile. That is
    enforced. The half of the rule that actually bites is enforced too: drawing
    clears any Last Card call, so a hand attained by Pick and Play has to wait
    for the following turn.

19. **A set of identical ranks counts as a Last Card hand**, per the aim of the
    game — including, technically, a hand of two jokers.

20. **The 8s rule counts physical rank.** Jokers cannot reach eight (there are
    only four), and detection is automatic the instant the hand appears — even
    on someone else's turn, and even if the eighth card arrived through a
    penalty pick-up.

## Known limits of the UI

- **Jokers are played on their own.** The engine will happily accept a joker
  called as a 2♦ inside a group of 2s; the card picker does not offer it,
  because nominating mid-selection made the sheet unusable on a phone.
- **Jump-ins go through a "who is jumping in?" sheet.** Showing a live jump-in
  button per player would leak hands on a shared phone, so the claim is made
  first and only the matching cards are then revealed.
- **The Last Card window is a real countdown** that holds the reveal button shut
  for three seconds. The engine does not depend on it — it marks the miss when
  the next player actually moves — so a slow hand-over cannot break the rule.

## Phase 2 — networked play

Started. The engine already runs anywhere, so the server side is mostly a
matter of deciding who may know what.

`src/engine/view.ts` is the first piece: `viewFor(state, playerId)` returns
only what one device is entitled to see. Pass-and-play could hand the whole
`GameState` to the screen, because the screen *was* the privacy boundary; over
a network it is not, and three things leak if this is done carelessly — other
players' hands, the draw pile (whose order is the next several draws), and the
RNG seed (which is every future shuffle). `hiddenFrom()` names what must not
appear, and the tests serialise each player's view at every step of a whole
game and look for it.

Still to come: a room/session protocol, a Cloudflare Worker with one Durable
Object per room holding the authoritative `GameState` and validating every
move through `applyMove`, and a client that renders a `PlayerView` instead of
a `GameState`. Note this sandbox cannot reach Cloudflare — the Worker in
`/push` has never run from here either — so the Worker can be built and tested
locally but not deployed or verified live from this environment.

## Out of scope for Phase 1

Networking, accounts, persistence, scoring across games, AI opponents, and any
animation beyond a card lifting when you select it.
