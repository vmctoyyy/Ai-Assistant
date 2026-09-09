/* Run: node test/logic.test.js */
var assert = require("assert");
var QD = require("../docs/logic.js");

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

var TODAY = "2026-09-09";
function ms(key, hour) { var d = QD.keyToDate(key); d.setHours(hour || 9); return d.getTime(); }
function task(id, o) {
  o = o || {};
  return QD.normTask({
    id: id, title: o.title || id,
    bucket: o.bucket || "today",
    importance: o.importance || "should",
    createdAt: o.createdAt !== undefined ? o.createdAt : ms(TODAY, 9),
    updatedAt: o.updatedAt,
    completedAt: o.completedAt || null,
    firstTodayOn: o.firstTodayOn !== undefined ? o.firstTodayOn : (o.bucket && o.bucket !== "today" ? null : TODAY),
    notTodayOn: o.notTodayOn || null,
    staleAskedOn: o.staleAskedOn || null
  }, TODAY);
}
var ids = function (a) { return a.map(function (x) { return x.id; }); };

console.log("\nranking");
t("carry-ins come first, oldest first", function () {
  var items = [
    task("must-today", { importance: "must" }),
    task("carry-new", { firstTodayOn: "2026-09-08" }),
    task("carry-old", { firstTodayOn: "2026-09-05" })
  ];
  assert.deepStrictEqual(ids(QD.rankToday(items, TODAY)), ["carry-old", "carry-new", "must-today"]);
});
t("a must outranks a should outranks a nice", function () {
  var items = [task("c", { importance: "nice" }), task("a", { importance: "must" }), task("b", {})];
  assert.deepStrictEqual(ids(QD.rankToday(items, TODAY)), ["a", "b", "c"]);
});
t("same importance falls back to createdAt, oldest first", function () {
  var items = [
    task("newer", { createdAt: ms(TODAY, 14) }),
    task("older", { createdAt: ms(TODAY, 7) })
  ];
  assert.deepStrictEqual(ids(QD.rankToday(items, TODAY)), ["older", "newer"]);
});
t("identical tasks break ties by id, so order never shuffles", function () {
  var mk = function () {
    return [task("zeta"), task("alpha"), task("mid")];
  };
  var first = ids(QD.rankToday(mk(), TODAY));
  for (var i = 0; i < 50; i++) {
    var shuffled = mk().sort(function () { return Math.random() - 0.5; });
    assert.deepStrictEqual(ids(QD.rankToday(shuffled, TODAY)), first);
  }
  assert.deepStrictEqual(first, ["alpha", "mid", "zeta"]);
});
t("completed and non-today tasks are excluded", function () {
  var items = [
    task("open"),
    task("done", { completedAt: ms(TODAY, 10) }),
    task("weekly", { bucket: "this_week" })
  ];
  assert.deepStrictEqual(ids(QD.rankToday(items, TODAY)), ["open"]);
});

console.log("\nsuggestions");
t("thin today pulls this_week musts before shoulds, capped at 3", function () {
  var items = [
    task("t1"),
    task("w-should-a", { bucket: "this_week", createdAt: ms("2026-09-01") }),
    task("w-must-a", { bucket: "this_week", importance: "must", createdAt: ms("2026-09-03") }),
    task("w-must-b", { bucket: "this_week", importance: "must", createdAt: ms("2026-09-02") }),
    task("w-should-b", { bucket: "this_week", createdAt: ms("2026-09-04") })
  ];
  assert.deepStrictEqual(ids(QD.pickSuggestions(items, TODAY)), ["w-must-b", "w-must-a", "w-should-a"]);
});
t("full today (3+) gets no suggestions", function () {
  var items = [task("a"), task("b"), task("c"), task("w", { bucket: "this_week" })];
  assert.deepStrictEqual(QD.pickSuggestions(items, TODAY), []);
});
t("falls through to this_month only when this_week has nothing", function () {
  var monthOnly = [task("m", { bucket: "this_month" })];
  assert.deepStrictEqual(ids(QD.pickSuggestions(monthOnly, TODAY)), ["m"]);
  var both = [task("w", { bucket: "this_week" }), task("m", { bucket: "this_month" })];
  assert.deepStrictEqual(ids(QD.pickSuggestions(both, TODAY)), ["w"]);
});
t('"Not today" removes it for the rest of that day only', function () {
  var items = [task("w", { bucket: "this_week", notTodayOn: TODAY })];
  assert.deepStrictEqual(QD.pickSuggestions(items, TODAY), []);
  assert.deepStrictEqual(ids(QD.pickSuggestions(items, "2026-09-10")), ["w"]);
});
t("nice items are never suggested", function () {
  var items = [task("w", { bucket: "this_week", importance: "nice" })];
  assert.deepStrictEqual(QD.pickSuggestions(items, TODAY), []);
});

console.log("\nstale prompt");
t("surfaces a this_week task untouched 10+ days", function () {
  var items = [task("old", { bucket: "this_week", updatedAt: ms("2026-08-28") })];
  assert.strictEqual(QD.pickStale(items, TODAY, {}).id, "old");
});
t("ignores anything touched inside 10 days", function () {
  var items = [task("recent", { bucket: "this_week", updatedAt: ms("2026-09-02") })];
  assert.strictEqual(QD.pickStale(items, TODAY, {}), null);
});
t("asks at most once a week", function () {
  var items = [task("old", { bucket: "this_week", updatedAt: ms("2026-08-01") })];
  assert.strictEqual(QD.pickStale(items, TODAY, { lastStaleAskOn: "2026-09-05" }), null);
  assert.strictEqual(QD.pickStale(items, TODAY, { lastStaleAskOn: "2026-09-01" }).id, "old");
});
t("only looks at this_week", function () {
  var items = [task("m", { bucket: "this_month", updatedAt: ms("2026-08-01") })];
  assert.strictEqual(QD.pickStale(items, TODAY, {}), null);
});

console.log("\nmigration from v1");
t("Top 3 slots become must, list becomes should, all in today", function () {
  var v1 = {
    day: "2026-09-08",
    top: [{ id: "p1", text: "Renew car insurance", done: false, at: 1 }, null,
          { id: "p3", text: "Call the bank", done: false, at: 2 }],
    list: [{ id: "l1", text: "Buy milk", done: false, at: 3 }],
    doneYesterday: 4
  };
  var out = QD.migrate(v1, TODAY);
  assert.strictEqual(out.version, 2);
  assert.deepStrictEqual(ids(out.items), ["p1", "p3", "l1"]);
  assert.deepStrictEqual(out.items.map(function (t) { return t.importance; }), ["must", "must", "should"]);
  assert.ok(out.items.every(function (t) { return t.bucket === "today"; }));
  assert.ok(out.items.every(function (t) { return t.firstTodayOn === "2026-09-08"; }));
  assert.strictEqual(out.doneYesterday, 4);
});
t("v1 titles come from text; carry-in status survives", function () {
  var out = QD.migrate({ day: "2026-09-05", top: [], list: [{ id: "x", text: "Old thing", at: 1 }] }, TODAY);
  assert.strictEqual(out.items[0].title, "Old thing");
  assert.strictEqual(QD.isCarryIn(out.items[0], TODAY), true);
});
t("migrating twice is a no-op", function () {
  var once = QD.migrate({ day: TODAY, top: [], list: [{ id: "a", text: "A", at: 1 }] }, TODAY);
  var twice = QD.migrate(once, TODAY);
  assert.deepStrictEqual(twice.items, once.items);
});
t("empty and junk input give a valid empty state", function () {
  [null, undefined, 42, "nope", {}].forEach(function (junk) {
    var out = QD.migrate(junk, TODAY);
    assert.strictEqual(out.version, 2);
    assert.deepStrictEqual(out.items, []);
  });
});

console.log("\nediting");
t("renaming keeps everything else and bumps updatedAt", function () {
  var a = task("a", { importance: "must", updatedAt: ms("2026-09-01") });
  var b = QD.applyPatch(a, { title: "Renamed" }, TODAY, 999);
  assert.strictEqual(b.title, "Renamed");
  assert.strictEqual(b.importance, "must");
  assert.strictEqual(b.bucket, "today");
  assert.strictEqual(b.firstTodayOn, a.firstTodayOn);
  assert.strictEqual(b.updatedAt, 999);
});
t("deprioritising re-ranks without touching the carry-in clock", function () {
  var a = task("a", { importance: "must", firstTodayOn: "2026-09-05" });
  var b = QD.applyPatch(a, { importance: "nice" }, TODAY, 999);
  assert.strictEqual(b.importance, "nice");
  assert.strictEqual(b.firstTodayOn, "2026-09-05");
  assert.strictEqual(QD.isCarryIn(b, TODAY), true);
});
t("leaving today clears the carry-in clock", function () {
  var a = task("a", { firstTodayOn: "2026-09-05" });
  var b = QD.applyPatch(a, { bucket: "this_week" }, TODAY, 999);
  assert.strictEqual(b.firstTodayOn, null);
  assert.strictEqual(QD.isCarryIn(b, TODAY), false);
});
t("coming back to today is new, not an instant carry-in", function () {
  var a = task("a", { bucket: "this_week", firstTodayOn: null });
  var b = QD.applyPatch(a, { bucket: "today" }, TODAY, 999);
  assert.strictEqual(b.firstTodayOn, TODAY);
  assert.strictEqual(QD.isCarryIn(b, TODAY), false);
});
t("an old task promoted from this_week does not jump the queue", function () {
  var older = task("promoted", { bucket: "this_week", createdAt: ms("2026-08-01") });
  var carry = task("carry", { firstTodayOn: "2026-09-08" });
  var items = [QD.applyPatch(older, { bucket: "today" }, TODAY, 999), carry];
  assert.deepStrictEqual(ids(QD.rankToday(items, TODAY)), ["carry", "promoted"]);
});
t("staying in the same bucket leaves the clock alone", function () {
  var a = task("a", { firstTodayOn: "2026-09-05" });
  var b = QD.applyPatch(a, { bucket: "today", title: "Same bucket" }, TODAY, 999);
  assert.strictEqual(b.firstTodayOn, "2026-09-05");
});

console.log("\nrollover");
t("completed clear and are counted; buckets are never moved", function () {
  var state = { version: 2, lastRollOn: "2026-09-08", doneYesterday: 0, items: [
    task("done1", { completedAt: ms("2026-09-08", 10) }),
    task("done2", { completedAt: ms("2026-09-08", 11) }),
    task("open", { firstTodayOn: "2026-09-08" }),
    task("weekly", { bucket: "this_week" })
  ]};
  var out = QD.rollDay(state, TODAY);
  assert.strictEqual(out.doneYesterday, 2);
  assert.deepStrictEqual(ids(out.items), ["open", "weekly"]);
  assert.strictEqual(out.items[1].bucket, "this_week");
  assert.strictEqual(QD.isCarryIn(out.items[0], TODAY), true);
});
t("same day is untouched", function () {
  var state = { version: 2, lastRollOn: TODAY, doneYesterday: 7, items: [] };
  assert.strictEqual(QD.rollDay(state, TODAY), state);
});

console.log("\nbrief copy");
t("greeting counts today's tasks", function () {
  assert.strictEqual(QD.greetingLine(0), "Nothing on today's list.");
  assert.strictEqual(QD.greetingLine(1), "One thing on today.");
  assert.strictEqual(QD.greetingLine(4), "Four things on today.");
  assert.strictEqual(QD.greetingLine(14), "14 things on today.");
});
t("start-here names the single must-do", function () {
  var r = QD.rankToday([task("a", { title: "Renew car insurance", importance: "must" }), task("b")], TODAY);
  var s = QD.startHere(r, TODAY);
  assert.strictEqual(s.title, "Renew car insurance");
  assert.strictEqual(s.after, " — it is the only must-do today.");
});
t("start-here explains a carry-in by age", function () {
  var r = QD.rankToday([task("a", { title: "Call the bank", firstTodayOn: "2026-09-08" })], TODAY);
  assert.strictEqual(QD.startHere(r, TODAY).after, " — it has been on the list since yesterday.");
});
t("start-here handles no must-dos", function () {
  var r = QD.rankToday([task("a"), task("b")], TODAY);
  assert.strictEqual(QD.startHere(r, TODAY).after, " — nothing today is marked must-do, so this is the oldest.");
});
t("start-here is null on an empty day", function () {
  assert.strictEqual(QD.startHere([], TODAY), null);
});
t("copy carries no exclamation marks and stays one sentence", function () {
  var cases = [
    [task("a", { importance: "must" })],
    [task("a", { importance: "must" }), task("b", { importance: "must" })],
    [task("a", { firstTodayOn: "2026-08-30" })],
    [task("a")], [task("a"), task("b")]
  ];
  cases.forEach(function (items) {
    var s = QD.startHere(QD.rankToday(items, TODAY), TODAY);
    var line = s.before + s.title + s.after;
    assert.ok(line.indexOf("!") === -1, "exclamation in: " + line);
    assert.strictEqual(line.match(/\./g).length, 1, "not one sentence: " + line);
  });
});
t("all-done reads as fact, not praise", function () {
  var items = [task("a", { completedAt: ms(TODAY, 10) })];
  assert.strictEqual(QD.allDoneLine(items, TODAY), "Everything on today's list is done.");
  assert.strictEqual(QD.allDoneLine([], TODAY), "Nothing on today's list.");
});

console.log("\nsinceLabel");
t("reads naturally across the week", function () {
  assert.strictEqual(QD.sinceLabel("2026-09-08", TODAY), "yesterday");
  assert.strictEqual(QD.sinceLabel("2026-09-06", TODAY), "Sunday");
  assert.strictEqual(QD.sinceLabel("2026-08-30", TODAY), "30 Aug");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
