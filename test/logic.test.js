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
    staleAskedOn: o.staleAskedOn || null,
    dueDate: o.dueDate || null,
    dueTime: o.dueTime || null
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

console.log("\ncompleted items stay until midnight");
t("a task ticked off in any bucket stays visible today", function () {
  ["today", "this_week", "this_month", "future"].forEach(function (bucket) {
    var done = task("d", { bucket: bucket, completedAt: ms(TODAY, 10) });
    assert.deepStrictEqual(ids(QD.completedInBucket([done], bucket, TODAY)), ["d"],
      "vanished from " + bucket);
  });
});
t("it is out of the open list but still on screen", function () {
  var items = [
    task("open", { bucket: "this_week" }),
    task("done", { bucket: "this_week", completedAt: ms(TODAY, 10) })
  ];
  assert.deepStrictEqual(ids(QD.inBucket(items, "this_week")), ["open"], "open list");
  assert.deepStrictEqual(ids(QD.completedInBucket(items, "this_week", TODAY)), ["done"]);
});
t("un-ticking puts it straight back", function () {
  var done = task("d", { bucket: "this_week", completedAt: ms(TODAY, 10) });
  var back = QD.applyPatch(done, { completedAt: null }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.inBucket([back], "this_week")), ["d"]);
  assert.deepStrictEqual(QD.completedInBucket([back], "this_week", TODAY), []);
});
t("they clear at the midnight rollover, not before", function () {
  var state = { version: 2, lastRollOn: TODAY, doneYesterday: 0, items: [
    task("w", { bucket: "this_week", completedAt: ms(TODAY, 10) }),
    task("m", { bucket: "this_month", completedAt: ms(TODAY, 11) }),
    task("keep", { bucket: "this_week" })
  ]};
  assert.strictEqual(QD.rollDay(state, TODAY), state, "same day leaves them alone");
  var next = QD.rollDay(state, "2026-09-10");
  assert.deepStrictEqual(ids(next.items), ["keep"]);
  assert.strictEqual(next.doneYesterday, 2, "and they are counted on the way out");
});
t("yesterday's completions do not linger on screen", function () {
  var old = task("d", { bucket: "this_week", completedAt: ms("2026-09-08", 10) });
  assert.deepStrictEqual(QD.completedInBucket([old], "this_week", TODAY), []);
});
t("ticked items list in the order they were ticked", function () {
  var items = [
    task("second", { bucket: "this_week", completedAt: ms(TODAY, 14) }),
    task("first", { bucket: "this_week", completedAt: ms(TODAY, 9) })
  ];
  assert.deepStrictEqual(ids(QD.completedInBucket(items, "this_week", TODAY)), ["first", "second"]);
});
t("a bucket's completions never leak into another bucket", function () {
  var items = [task("w", { bucket: "this_week", completedAt: ms(TODAY, 10) })];
  assert.deepStrictEqual(QD.completedInBucket(items, "this_month", TODAY), []);
  assert.deepStrictEqual(QD.completedInBucket(items, "today", TODAY), []);
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

console.log("\nappointments");
t("date and time are optional and independent", function () {
  var a = QD.makeTask("Dentist", { today: TODAY });
  assert.strictEqual(a.dueDate, null);
  assert.strictEqual(a.dueTime, null);
  var b = QD.applyPatch(a, { dueTime: "10:30" }, TODAY, 1);
  assert.strictEqual(QD.dueLabel(b.dueDate, b.dueTime, TODAY), "10:30");
  var c = QD.applyPatch(a, { dueDate: "2026-09-11" }, TODAY, 1);
  assert.strictEqual(QD.dueLabel(c.dueDate, c.dueTime, TODAY), "Friday");
});
t("due label reads naturally near and far", function () {
  var L = function (d, t) { return QD.dueLabel(d, t, TODAY); };
  assert.strictEqual(L("2026-09-09", "09:00"), "09:00 \u00b7 today");
  assert.strictEqual(L("2026-09-10", null), "tomorrow");
  assert.strictEqual(L("2026-09-08", null), "yesterday");
  assert.strictEqual(L("2026-09-12", "14:15"), "14:15 \u00b7 Saturday");
  assert.strictEqual(L("2026-10-02", null), "2 Oct");
  assert.strictEqual(L(null, null), "");
});
t("ticking a field off clears it", function () {
  var a = QD.applyPatch(QD.makeTask("Dentist", { today: TODAY }),
    { dueDate: "2026-09-11", dueTime: "10:30" }, TODAY, 1);
  var b = QD.applyPatch(a, { dueDate: null, dueTime: null }, TODAY, 2);
  assert.strictEqual(b.dueDate, null);
  assert.strictEqual(b.dueTime, null);
  assert.strictEqual(QD.dueLabel(b.dueDate, b.dueTime, TODAY), "");
});
t("malformed dates and times are rejected, not stored", function () {
  ["11/09/2026", "2026-9-1", "tomorrow", "", 42, null].forEach(function (bad) {
    assert.strictEqual(QD.validDate(bad), null, String(bad));
  });
  ["25:00x", "9:30am", "", 42, null].forEach(function (bad) {
    assert.strictEqual(QD.validTime(bad), null, String(bad));
  });
  assert.strictEqual(QD.validTime("10:30:00"), "10:30");
  assert.strictEqual(QD.validDate("2026-09-11"), "2026-09-11");
});
t("appointment fields survive a save/reload round trip", function () {
  var a = QD.applyPatch(QD.makeTask("Dentist", { today: TODAY }),
    { dueDate: "2026-09-11", dueTime: "10:30" }, TODAY, 1);
  var out = QD.migrate({ version: 2, items: [a], doneYesterday: 0, lastRollOn: TODAY }, TODAY);
  assert.strictEqual(out.items[0].dueDate, "2026-09-11");
  assert.strictEqual(out.items[0].dueTime, "10:30");
});
t("an appointment never changes bucket on its own", function () {
  var appt = QD.applyPatch(task("appt", { bucket: "this_week" }), { dueTime: "07:00" }, TODAY, 1);
  assert.strictEqual(appt.bucket, "this_week");
});
t("a time leads the day, ahead of an untimed must", function () {
  var plain = task("plain", { importance: "must" });
  var appt = QD.applyPatch(task("appt", { importance: "nice" }), { dueTime: "07:00" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.rankToday([plain, appt], TODAY)), ["appt", "plain"]);
});
t("timed tasks run in clock order, whatever their importance", function () {
  var nine = QD.applyPatch(task("nine", { importance: "nice" }), { dueTime: "09:00" }, TODAY, 1);
  var five = QD.applyPatch(task("five", { importance: "nice" }), { dueTime: "05:00" }, TODAY, 1);
  var noon = QD.applyPatch(task("noon", { importance: "must" }), { dueTime: "12:00" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.rankToday([nine, noon, five], TODAY)),
    ["five", "nine", "noon"]);
});
t("a time beats a carry-in, and the untimed rest keeps the old chain", function () {
  var old1 = task("carry", { importance: "nice" });
  old1.firstTodayOn = QD.shiftKey(TODAY, -1);
  var must = task("must", { importance: "must" });
  var timed = QD.applyPatch(task("timed", { importance: "nice" }), { dueTime: "06:00" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.rankToday([must, old1, timed], TODAY)),
    ["timed", "carry", "must"]);
});
t("a task dated another day is not in today at all", function () {
  var plain = task("plain", { importance: "must" });
  var later = QD.applyPatch(task("later", { importance: "nice" }),
    { dueDate: QD.shiftKey(TODAY, 3), dueTime: "06:00" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.rankToday([later, plain], TODAY)), ["plain"]);
  assert.deepStrictEqual(ids(QD.inBucket([later, plain], "this_week", TODAY)), ["later"]);
});
t("ranking stays a total order once times are in play", function () {
  var a = QD.applyPatch(task("a"), { dueTime: "08:00" }, TODAY, 1);
  var b = QD.applyPatch(task("b"), { dueTime: "08:00" }, TODAY, 1);
  b.createdAt = a.createdAt;
  var one = ids(QD.rankToday([a, b], TODAY));
  var two = ids(QD.rankToday([b, a], TODAY));
  assert.deepStrictEqual(one, two);
});
t("other buckets put their timed tasks first too", function () {
  var plain = task("plain", { bucket: "this_week", importance: "must" });
  var fri = QD.applyPatch(task("fri", { importance: "nice" }),
    { dueDate: QD.shiftKey(TODAY, 2), dueTime: "08:00" }, TODAY, 1);
  var thu = QD.applyPatch(task("thu", { importance: "nice" }),
    { dueDate: QD.shiftKey(TODAY, 1), dueTime: "08:00" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.inBucket([plain, fri, thu], "this_week", TODAY)),
    ["thu", "fri", "plain"]);
});

console.log("\naddedLabel");
t("says when a task was added, quietly", function () {
  assert.strictEqual(QD.addedLabel(ms(TODAY, 9), TODAY), "Added today");
  assert.strictEqual(QD.addedLabel(ms("2026-09-08", 9), TODAY), "Added yesterday");
  assert.strictEqual(QD.addedLabel(ms("2026-09-06", 9), TODAY), "Added on Sunday");
  assert.strictEqual(QD.addedLabel(ms("2026-08-30", 9), TODAY), "Added 30 Aug");
  assert.strictEqual(QD.addedLabel(ms("2025-12-24", 9), TODAY), "Added 24 Dec 2025");
});

console.log("\nfixed points & the plan line");
var render = function (seg) {
  return seg.map(function (x) { return x.em !== undefined ? x.em : x.t; }).join("");
};
function coffeeDay(extra) {
  return [
    task("c", { title: "Coffee", dueDate: TODAY, dueTime: "12:30" }),
    task("x", { title: "Renew car insurance", importance: "must", createdAt: ms(TODAY, 8) }),
    task("y", { title: "Buy milk", createdAt: ms(TODAY, 9) })
  ].concat(extra || []);
}
t("a timed today task becomes a fixed point, untimed ones stay flexible", function () {
  var items = coffeeDay();
  assert.deepStrictEqual(ids(QD.fixedPoints(items, TODAY)), ["c"]);
  assert.deepStrictEqual(ids(QD.flexibleToday(items, TODAY)), ["x", "y"]);
});
t("the plan line names the appointment and what to do either side", function () {
  var p = QD.planLine(coffeeDay(), TODAY);
  assert.strictEqual(render(p.lead), "Coffee at 12:30 is your only fixed point today.");
  assert.strictEqual(render(p.advice), "Renew car insurance before it, Buy milk after.");
});
t("fixed points sort by clock, not importance", function () {
  var items = [
    task("late", { title: "Gym", importance: "must", dueTime: "18:00" }),
    task("early", { title: "Coffee", importance: "nice", dueTime: "08:00" })
  ];
  assert.deepStrictEqual(ids(QD.fixedPoints(items, TODAY)), ["early", "late"]);
  assert.strictEqual(render(QD.planLine(items, TODAY).lead),
    "Two fixed points today: Coffee at 08:00 and Gym at 18:00.");
});
t("one flexible task gets a before, none gets a plain statement", function () {
  var one = [task("c", { title: "Coffee", dueTime: "12:30" }), task("x", { title: "Buy milk" })];
  assert.strictEqual(render(QD.planLine(one, TODAY).advice), "Buy milk before it.");
  var none = [task("c", { title: "Coffee", dueTime: "12:30" })];
  assert.strictEqual(render(QD.planLine(none, TODAY).advice), "Nothing else on the list around it.");
});
t("with no fixed point the plan line is the old one-sentence start-here", function () {
  var p = QD.planLine([task("a", { title: "Buy milk", importance: "must" })], TODAY);
  assert.strictEqual(render(p.lead), "Start with Buy milk — it is the only must-do today.");
  assert.strictEqual(p.advice, null);
});
t("a task timed for a future date is not today's fixed point", function () {
  var items = [task("c", { title: "Coffee", dueDate: "2026-09-12", dueTime: "12:30" })];
  assert.deepStrictEqual(QD.fixedPoints(items, TODAY), []);
  assert.deepStrictEqual(QD.flexibleToday(items, TODAY), [],
    "nor is it loose in today — its date puts it later in the week");
  assert.deepStrictEqual(ids(QD.inBucket(items, "this_week", TODAY)), ["c"]);
});
t("plan-line copy stays calm: no exclamations, at most two sentences", function () {
  [coffeeDay(), [task("c", { title: "Coffee", dueTime: "12:30" })],
   [task("c", { dueTime: "08:00" }), task("d", { dueTime: "18:00" }), task("e")],
   [task("a", { importance: "must" })], []].forEach(function (items) {
    var p = QD.planLine(items, TODAY);
    if (!p) return;
    var line = render(p.lead) + (p.advice ? " " + render(p.advice) : "");
    assert.ok(line.indexOf("!") === -1, "exclamation: " + line);
    assert.ok(line.match(/\./g).length <= 2, "too many sentences: " + line);
  });
});

console.log("\ndate-driven bucketing");
/* TODAY is Wed 2026-09-09: its calendar week runs Mon 7 - Sun 13, its month
   ends Wed 30 Sep. */
t("a date decides the bucket, whatever the manual one says", function () {
  var t1 = task("w", { bucket: "this_week", dueDate: TODAY });
  assert.strictEqual(QD.effectiveBucket(t1, TODAY), "today");
  assert.deepStrictEqual(ids(QD.rankToday([t1], TODAY)), ["w"]);
  assert.deepStrictEqual(QD.inBucket([t1], "this_week", TODAY), [],
    "and it is no longer where the manual bucket filed it");
});
t("a task filed in today but dated later leaves today", function () {
  var t1 = task("x", { bucket: "today", dueDate: "2026-09-12" });
  assert.strictEqual(QD.effectiveBucket(t1, TODAY), "this_week");
  assert.deepStrictEqual(QD.rankToday([t1], TODAY), []);
});
t("the stored bucket is left alone — only the reading changes", function () {
  var t1 = task("w", { bucket: "this_week", dueDate: TODAY });
  QD.effectiveBucket(t1, TODAY);
  QD.rankToday([t1], TODAY);
  assert.strictEqual(t1.bucket, "this_week", "nothing was written");
});
t("an undated task still follows its manual bucket", function () {
  ["today", "this_week", "this_month", "future"].forEach(function (b) {
    assert.strictEqual(QD.effectiveBucket(task("t", { bucket: b }), TODAY), b);
  });
});
t("the week is Monday to Sunday", function () {
  assert.strictEqual(QD.startOfWeek(TODAY), "2026-09-07", "Monday");
  assert.strictEqual(QD.nextWeekStart(TODAY), "2026-09-14");
  assert.strictEqual(QD.bucketForDate("2026-09-13", TODAY), "this_week", "Sunday closes it");
  assert.strictEqual(QD.bucketForDate("2026-09-14", TODAY), "this_month", "Monday opens the next");
  assert.strictEqual(QD.startOfWeek("2026-09-13"), "2026-09-07", "a Sunday belongs to its Monday");
});
t("the month boundary is the calendar month", function () {
  assert.strictEqual(QD.monthEnd(TODAY), "2026-09-30");
  assert.strictEqual(QD.bucketForDate("2026-09-30", TODAY), "this_month");
  assert.strictEqual(QD.bucketForDate("2026-10-01", TODAY), "future");
});
t("a week running past the end of the month keeps its own days", function () {
  var MON = "2026-09-28";          /* Mon 28 Sep; the week ends Sun 4 Oct */
  assert.strictEqual(QD.bucketForDate("2026-10-02", MON), "this_week",
    "October the 2nd is still this week");
  assert.strictEqual(QD.bucketForDate("2026-10-06", MON), "future",
    "past the week and past the month");
});
t("a task drifts inward on its own as the days pass", function () {
  var d = "2026-09-30";
  assert.strictEqual(QD.bucketForDate(d, "2026-08-20"), "future");
  assert.strictEqual(QD.bucketForDate(d, "2026-09-09"), "this_month");
  assert.strictEqual(QD.bucketForDate(d, "2026-09-28"), "this_week");
  assert.strictEqual(QD.bucketForDate(d, "2026-09-30"), "today");
  assert.strictEqual(QD.bucketForDate(d, "2026-10-01"), "today", "and stays, as overdue");
});

console.log("\noverdue");
t("a past date lands in today, marked, never hidden", function () {
  var late = task("late", { bucket: "future", dueDate: "2026-09-05" });
  assert.strictEqual(QD.effectiveBucket(late, TODAY), "today");
  assert.strictEqual(QD.isOverdue(late, TODAY), true);
  assert.deepStrictEqual(ids(QD.rankToday([late], TODAY)), ["late"]);
});
t("a completed one is not overdue", function () {
  var done = task("done", { dueDate: "2026-09-05", completedAt: ms(TODAY, 10) });
  assert.strictEqual(QD.isOverdue(done, TODAY), false);
});
t("it is stated by age, not as a failure", function () {
  assert.strictEqual(QD.overdueLabel(task("a", { dueDate: "2026-09-08" }), TODAY), "due yesterday");
  assert.strictEqual(QD.overdueLabel(task("a", { dueDate: "2026-09-06" }), TODAY), "due Sunday");
  assert.strictEqual(QD.overdueLabel(task("a", { dueDate: TODAY }), TODAY), "", "not late yet");
});
t("late work leads the day, oldest first, ahead of everything", function () {
  var older = task("older", { dueDate: "2026-09-05", importance: "nice" });
  var newer = task("newer", { dueDate: "2026-09-08", importance: "nice" });
  var must = task("must", { importance: "must" });
  var soon = QD.applyPatch(task("soon"), { dueTime: "09:30" }, TODAY, 1);
  assert.deepStrictEqual(ids(QD.rankToday([must, soon, newer, older], TODAY, 9 * 60)),
    ["older", "newer", "soon", "must"]);
});
t("a late task never sinks to the bottom, whatever its old time said", function () {
  var late = QD.normTask({ id: "late", title: "late", bucket: "today",
    dueDate: "2026-09-08", dueTime: "21:00", createdAt: ms(TODAY, 9) }, TODAY);
  var chore = task("chore");
  assert.deepStrictEqual(ids(QD.rankToday([late, chore], TODAY, 9 * 60)), ["late", "chore"]);
  assert.strictEqual(QD.isWaiting(late, TODAY, 9 * 60), false);
});
t("a dated task is never also called a carry-in", function () {
  var late = task("late", { dueDate: "2026-09-05", firstTodayOn: "2026-09-05" });
  assert.strictEqual(QD.isOverdue(late, TODAY), true);
  assert.strictEqual(QD.isCarryIn(late, TODAY), false, "one fact, one label");
  var plain = task("plain", { firstTodayOn: "2026-09-05" });
  assert.strictEqual(QD.isCarryIn(plain, TODAY), true, "undated ones still carry in");
});

console.log("\ntaking a date off");
t("the task falls back to wherever the date had it", function () {
  var t1 = task("t", { bucket: "today", dueDate: "2026-09-12" });
  assert.strictEqual(QD.effectiveBucket(t1, TODAY), "this_week");
  var off = QD.applyPatch(t1, { dueDate: null }, TODAY, 1);
  assert.strictEqual(off.dueDate, null);
  assert.strictEqual(off.bucket, "this_week", "it does not jump, and does not vanish");
  assert.strictEqual(QD.effectiveBucket(off, TODAY), "this_week");
});
t("an overdue one falls back to today rather than disappearing", function () {
  var late = task("late", { bucket: "future", dueDate: "2026-09-05" });
  var off = QD.applyPatch(late, { dueDate: null }, TODAY, 1);
  assert.strictEqual(off.bucket, "today");
  assert.strictEqual(off.firstTodayOn, TODAY, "and it is new to today, not a carry-in");
});
t("and can then be re-picked by hand", function () {
  var off = QD.applyPatch(task("t", { dueDate: "2026-09-12" }), { dueDate: null }, TODAY, 1);
  var moved = QD.applyPatch(off, { bucket: "future" }, TODAY, 2);
  assert.strictEqual(QD.effectiveBucket(moved, TODAY), "future");
});
t("suggestions only ever offer undated work", function () {
  var dated = task("d", { bucket: "this_week", dueDate: "2026-09-12", importance: "must" });
  var plain = task("p", { bucket: "this_week", importance: "must" });
  assert.deepStrictEqual(ids(QD.pickSuggestions([dated, plain], TODAY)), ["p"]);
});

console.log("\ncalendar reminder");
t("builds a valid event with a 30-minute alarm", function () {
  var c = task("c", { title: "Coffee", dueDate: "2026-09-12", dueTime: "12:30" });
  var ics = QD.buildICS(c, TODAY, Date.UTC(2026, 8, 9, 20, 0, 0));
  ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20260912T123000", "SUMMARY:Coffee",
   "BEGIN:VALARM", "TRIGGER:-PT30M", "END:VCALENDAR"].forEach(function (frag) {
    assert.ok(ics.indexOf(frag) !== -1, "missing " + frag);
  });
  assert.ok(/\r\n/.test(ics), "must use CRLF line endings");
  assert.ok(ics.indexOf("DTSTART:20260912T123000Z") === -1, "must be floating local time");
});
t("falls back to today when only a time is set", function () {
  var c = task("c", { title: "Coffee", dueTime: "07:15" });
  assert.ok(QD.buildICS(c, TODAY, 0).indexOf("DTSTART:20260909T071500") !== -1);
});
t("no time means no reminder to build", function () {
  assert.strictEqual(QD.buildICS(task("c", { title: "Coffee" }), TODAY, 0), null);
});
t("escapes characters that would corrupt the file", function () {
  var c = task("c", { title: "Coffee, then tax; admin", dueTime: "09:00", notes: "line" });
  var ics = QD.buildICS(c, TODAY, 0);
  assert.ok(ics.indexOf("SUMMARY:Coffee\\, then tax\\; admin") !== -1, ics);
});

console.log("\ncapture: the worked example");
var P = function (line) { return QD.parseTaskLine(line, TODAY); };   // TODAY = Wed 2026-09-09
t("reads title, time, date and notes out of one sentence", function () {
  var r = P("Add MRI in Napier at 10:00, Tue 15th Sep. Add Ahuriri, 18 Ossian Street to notes");
  assert.strictEqual(r.title, "MRI in Napier");
  assert.strictEqual(r.dueTime, "10:00");
  assert.strictEqual(r.dueDate, "2026-09-15");
  assert.strictEqual(r.notes, "Ahuriri, 18 Ossian Street");
  assert.strictEqual(r.bucket, "this_month", "Tue 15 Sep is past this calendar week");
  assert.strictEqual(r.importance, "should");
});

console.log("\ncapture: times");
t("12-hour and 24-hour both work", function () {
  assert.strictEqual(P("Dentist at 10:00").dueTime, "10:00");
  assert.strictEqual(P("Dentist 2.30pm").dueTime, "14:30");
  assert.strictEqual(P("Dentist 9am").dueTime, "09:00");
  assert.strictEqual(P("Standup at 14:30").dueTime, "14:30");
});
t("midnight and midday are not swapped", function () {
  assert.strictEqual(P("Flight 12am").dueTime, "00:00");
  assert.strictEqual(P("Lunch 12pm").dueTime, "12:00");
  assert.strictEqual(P("Lunch 12:30pm").dueTime, "12:30");
});
t("bare numbers are never a time", function () {
  assert.strictEqual(P("Buy 2 pints").dueTime, null);
  assert.strictEqual(P("Buy 2 pints").title, "Buy 2 pints");
  assert.strictEqual(P("Pick up 18 Ossian Street").dueTime, null);
});

console.log("\ncapture: dates");
t("day-month, month-day and numeric all resolve", function () {
  assert.strictEqual(P("Pay invoice 15 Sep").dueDate, "2026-09-15");
  assert.strictEqual(P("Pay invoice Sep 15").dueDate, "2026-09-15");
  assert.strictEqual(P("Pay invoice 15/9").dueDate, "2026-09-15");
  assert.strictEqual(P("Pay invoice 15 September 2026").dueDate, "2026-09-15");
  assert.strictEqual(P("Pay invoice 15/09/2026").dueDate, "2026-09-15");
});
t("a bare date that has passed rolls to next year", function () {
  assert.strictEqual(P("Renew rego 1 Mar").dueDate, "2027-03-01");
  assert.strictEqual(P("Renew rego 31 Dec").dueDate, "2026-12-31");
});
t("today, tonight and tomorrow", function () {
  assert.strictEqual(P("Bins out tonight").dueDate, TODAY);
  assert.strictEqual(P("Bins out today").dueDate, TODAY);
  assert.strictEqual(P("Bins out tomorrow").dueDate, "2026-09-10");
});
t("a weekday means the NEXT one, never today", function () {
  assert.strictEqual(P("Coffee Friday").dueDate, "2026-09-11");
  assert.strictEqual(P("Coffee next Tuesday").dueDate, "2026-09-15");
  assert.strictEqual(P("Coffee Wednesday").dueDate, "2026-09-16", "today is Wednesday");
});
t("words that merely start like a month or day are left alone", function () {
  ["Monitor the bank account", "Separate the recycling", "March the kids to school",
   "Satisfy the auditor", "Decorate the hall", "Augment the report"].forEach(function (line) {
    var r = P(line);
    assert.strictEqual(r.dueDate, null, line + " -> " + r.dueDate);
    assert.strictEqual(r.title, line, line + " -> " + r.title);
  });
});

console.log("\ncapture: notes, importance, bucket");
t("notes survive their own commas", function () {
  assert.strictEqual(P("Dentist. Add Ahuriri, 18 Ossian Street to notes").notes,
    "Ahuriri, 18 Ossian Street");
  assert.strictEqual(P("Dentist. Note: bring the referral").notes, "bring the referral");
});
t("only explicit markers set importance", function () {
  assert.strictEqual(P("Must renew car insurance").importance, "must");
  assert.strictEqual(P("Urgent: call the bank").importance, "must");
  assert.strictEqual(P("Tidy the shed if I get time").importance, "nice");
  assert.strictEqual(P("Have a nice lunch").importance, "should", "a bare adjective is not a marker");
});
t("bucket follows the date unless said otherwise", function () {
  assert.strictEqual(P("Buy milk").bucket, "today");
  assert.strictEqual(P("Coffee tomorrow").bucket, "this_week");
  assert.strictEqual(P("Dentist 5 Oct").bucket, "future", "past the end of September");
  assert.strictEqual(P("Dentist 28 Sep").bucket, "this_month");
  assert.strictEqual(P("Renew passport 1 Mar").bucket, "future");
  assert.strictEqual(P("Sort the garage this week").bucket, "this_week");
  assert.strictEqual(P("Paint the fence someday").bucket, "future");
});
t("a stripped leading imperative keeps its capital", function () {
  assert.strictEqual(P("Add milk to the list").title, "Milk to the list");
  assert.strictEqual(P("Must renew car insurance").title, "Renew car insurance");
  assert.strictEqual(P("remember to call mum").title, "call mum");
});

console.log("\ncapture: safety");
t("an unrecognised line is kept verbatim, never guessed at", function () {
  var odd = "Ring whoever it was about the thing";
  var r = P(odd);
  assert.strictEqual(r.title, odd);
  assert.strictEqual(r.dueDate, null);
  assert.strictEqual(r.dueTime, null);
});
t("a line that is only a date still yields a usable title", function () {
  var r = P("15 Sep");
  assert.ok(r.title.length > 0, "title must not be empty");
  assert.strictEqual(r.dueDate, "2026-09-15");
});
t("it reports what it recognised so the UI can show it", function () {
  var r = P("MRI 10am 15 Sep. Add parking to notes");
  assert.deepStrictEqual(Object.keys(r.found).sort(), ["date", "notes", "time"]);
  assert.strictEqual(P("Buy milk").found.date, undefined);
});
t("blank and junk lines are dropped, not turned into tasks", function () {
  assert.strictEqual(P(""), null);
  assert.strictEqual(P("   "), null);
  assert.strictEqual(P(null), null);
});
t("a multi-line dump yields one task per non-empty line", function () {
  var out = QD.parseBrainDump("Buy milk\n\n- Dentist 2pm tomorrow\n2. Call the bank", TODAY);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(function (x) { return x.title; }),
    ["Buy milk", "Dentist", "Call the bank"]);
  assert.strictEqual(out[1].dueTime, "14:00");
});
t("a batch keeps the order it was typed in", function () {
  var specs = QD.parseBrainDump("First thing\nSecond thing\nThird thing", TODAY);
  var base = 1000;
  var made = specs.map(function (r, i) {
    return QD.makeTask(r.title, { bucket: r.bucket, importance: r.importance,
      today: TODAY, now: base + i });
  });
  assert.deepStrictEqual(QD.rankToday(made, TODAY).map(function (x) { return x.title; }),
    ["First thing", "Second thing", "Third thing"]);
  /* without the stagger the tie-break is the random id, so order is arbitrary */
  var same = specs.map(function (r) {
    return QD.makeTask(r.title, { bucket: r.bucket, today: TODAY, now: base });
  });
  assert.strictEqual(same[0].createdAt, same[2].createdAt, "same ms means no ordering signal");
});
t("the preview spells the date out so a wrong one is catchable", function () {
  var L = function (d, t) { return QD.dueLabelLong(d, t, TODAY); };
  assert.strictEqual(L("2026-09-15", "10:00"), "10:00 \u00b7 Tue 15 Sep");
  assert.strictEqual(L("2026-09-09", "09:00"), "09:00 \u00b7 Wed 9 Sep (today)");
  assert.strictEqual(L("2026-09-10", null), "Thu 10 Sep (tomorrow)");
  assert.strictEqual(L("2027-03-01", null), "Mon 1 Mar 2027", "a different year is stated");
  assert.strictEqual(L(null, "08:00"), "08:00");
  assert.strictEqual(L(null, null), "");
});
t("parsed output is a valid task once made", function () {
  var r = P("Add MRI in Napier at 10:00, Tue 15th Sep. Add Ahuriri, 18 Ossian Street to notes");
  var task = QD.makeTask(r.title, { bucket: r.bucket, importance: r.importance,
    today: TODAY, notes: r.notes, dueDate: r.dueDate, dueTime: r.dueTime });
  assert.strictEqual(task.dueDate, "2026-09-15");
  assert.strictEqual(task.dueTime, "10:00");
  assert.strictEqual(task.notes, "Ahuriri, 18 Ossian Street");
  assert.strictEqual(task.bucket, "this_month", "Tue 15 Sep is past this calendar week");
  assert.strictEqual(QD.dueLabel(task.dueDate, task.dueTime, TODAY), "10:00 · Tuesday");
});

console.log("\nquotes");
t("a day gets the same quote however often you look", function () {
  var list = QD.activeQuotes(null);
  var a = QD.quoteForDay(list, TODAY);
  for (var i = 0; i < 20; i++) {
    assert.strictEqual(QD.quoteForDay(list, TODAY).text, a.text);
  }
});
t("and a different one tomorrow", function () {
  var list = QD.activeQuotes(null);
  assert.notStrictEqual(QD.quoteForDay(list, TODAY).text,
    QD.quoteForDay(list, QD.shiftKey(TODAY, 1)).text);
});
t("it ships with thirty, all with text and a source", function () {
  assert.strictEqual(QD.DEFAULT_QUOTES.length, 30);
  QD.DEFAULT_QUOTES.forEach(function (q) {
    assert.ok(q.text && q.text.length > 3, JSON.stringify(q));
    assert.ok(q.source && q.source.length > 1, JSON.stringify(q));
    assert.ok(q.text.indexOf("!") === -1, "no exclamations: " + q.text);
  });
});
t("an empty list falls back to the built-ins", function () {
  assert.strictEqual(QD.activeQuotes(null).length, 30);
  assert.strictEqual(QD.activeQuotes({ list: [] }).length, 30);
  assert.ok(QD.activeQuotes(null)[0].builtIn);
});
t("one saved quote replaces the built-ins entirely", function () {
  var mine = QD.activeQuotes({ list: [{ id: "x", text: "Mine", source: "Me" }] });
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].text, "Mine");
  assert.strictEqual(QD.quoteForDay(mine, TODAY).text, "Mine", "one quote every day");
});
t("junk entries are dropped, strings are accepted", function () {
  var out = QD.normQuotes({ list: [null, "", { text: "  " }, "A bare string", { text: "Kept" }] });
  assert.deepStrictEqual(out.list.map(function (q) { return q.text; }), ["A bare string", "Kept"]);
  assert.ok(out.list[0].id, "ids are minted");
});
t("every day of a year lands on a real quote", function () {
  var list = QD.activeQuotes(null), key = "2026-01-01";
  for (var i = 0; i < 365; i++) {
    assert.ok(QD.quoteForDay(list, key), key);
    key = QD.shiftKey(key, 1);
  }
});

console.log("\nrecap");
t("the day's finished work is archived before it is cleared", function () {
  var items = [
    task("done1", { completedAt: ms(TODAY, 9) }),
    task("done2", { completedAt: ms(TODAY, 15) }),
    task("open", {})
  ];
  var rc = QD.archiveCompleted(QD.blankRecap(), items, TODAY);
  assert.deepStrictEqual(rc.days[TODAY].map(function (r) { return r.title; }), ["done1", "done2"]);
  assert.strictEqual(rc.days[TODAY].length, 2, "open tasks are not archived");
});
t("archiving nothing changes nothing", function () {
  var rc = QD.archiveCompleted(QD.blankRecap(), [task("open", {})], TODAY);
  assert.deepStrictEqual(rc.days, {});
});
t("recap reads today live and past days from the archive", function () {
  var rc = { days: { "2026-09-08": [{ title: "Older thing", at: 1 }] } };
  var live = [task("today", { completedAt: ms(TODAY, 11) })];
  var days = QD.recapDays(rc, live, TODAY, 7);
  assert.deepStrictEqual(days.map(function (d) { return d.date; }), [TODAY, "2026-09-08"]);
  assert.strictEqual(days[0].items[0].title, "today");
  assert.strictEqual(days[1].items[0].title, "Older thing");
});
t("empty days are left out", function () {
  assert.deepStrictEqual(QD.recapDays(QD.blankRecap(), [], TODAY, 7), []);
});
t("the archive is pruned but keeps a long tail", function () {
  var days = {};
  days[QD.shiftKey(TODAY, -10)] = [{ title: "recent" }];
  days[QD.shiftKey(TODAY, -90)] = [{ title: "ancient" }];
  var out = QD.pruneRecap({ days: days }, TODAY, 60);
  assert.ok(out.days[QD.shiftKey(TODAY, -10)], "10 days ago kept");
  assert.ok(!out.days[QD.shiftKey(TODAY, -90)], "90 days ago dropped");
});

console.log("\nshopping");
t("items normalise, junk is dropped", function () {
  var out = QD.normShopping({ items: [{ name: "Oat milk" }, null, { got: true }, { name: "Bread", got: true }] });
  assert.deepStrictEqual(out.items.map(function (i) { return i.name; }), ["Oat milk", "Bread"]);
  assert.strictEqual(out.items[0].got, false);
  assert.strictEqual(out.items[1].got, true);
  assert.ok(out.items[0].id);
});
t("a missing or malformed list gives an empty one", function () {
  [null, undefined, {}, { items: "nope" }, 7].forEach(function (junk) {
    assert.deepStrictEqual(QD.normShopping(junk).items, []);
  });
});

console.log("\nshopping carts");
function cart(o) {
  o = o || {};
  return { id: o.id || "c1", shop: o.shop || "Tesco", colour: o.colour || "#e4002b",
           items: o.items || [], createdAt: o.createdAt || 1000 };
}
function item(id, checked, checkedKey) {
  return { id: id, text: id, checked: !!checked,
           checkedAt: checked ? ms(checkedKey || TODAY, 10) : null };
}
t("hex is validated and normalised, junk is refused", function () {
  assert.strictEqual(QD.normHex("#F00"), "#ff0000");
  assert.strictEqual(QD.normHex("e4002b"), "#e4002b");
  assert.strictEqual(QD.normHex("#E4002B"), "#e4002b");
  ["", "red", "#12", "#1234567", null, 42].forEach(function (bad) {
    assert.strictEqual(QD.normHex(bad), null, String(bad));
  });
});
t("text on a shop colour stays readable", function () {
  assert.strictEqual(QD.contrastInk("#e4002b"), "#fffcf7", "light ink on red");
  assert.strictEqual(QD.contrastInk("#ffe500"), "#3b352e", "dark ink on yellow");
  assert.strictEqual(QD.contrastInk("#000000"), "#fffcf7");
  assert.strictEqual(QD.contrastInk("#ffffff"), "#3b352e");
  assert.strictEqual(QD.contrastInk("nonsense"), "#3b352e", "falls back safely");
});
t("a cart made from a saved shop copies the colour, it does not link to it", function () {
  var shop = QD.normShop({ name: "Warehouse", colour: "#e4002b" });
  var c = QD.makeCart(shop.name, shop.colour);
  shop.colour = "#00ff00";
  assert.strictEqual(c.colour, "#e4002b", "editing the shop must not reach the cart");
  assert.strictEqual(c.shop, "Warehouse");
  assert.deepStrictEqual(c.items, []);
});
t("ticking save adds the shop, once", function () {
  var shops = QD.addShopIfNew([], "Bunnings", "#0d5257");
  assert.strictEqual(shops.length, 1);
  assert.strictEqual(shops[0].name, "Bunnings");
  assert.strictEqual(shops[0].colour, "#0d5257");
  var again = QD.addShopIfNew(shops, "bunnings", "#ff0000");
  assert.strictEqual(again.length, 1, "same name does not add a second chip");
  assert.strictEqual(again[0].colour, "#0d5257", "and does not silently recolour the saved one");
});
t("not ticking save leaves the shop list alone", function () {
  var shops = [QD.normShop({ name: "Warehouse", colour: "#e4002b" })];
  assert.strictEqual(QD.addShopIfNew(shops, "", "#123456"), shops, "a blank name is a no-op");
  assert.strictEqual(QD.addShopIfNew(shops, "   ", "#123456"), shops);
});
t("a saved-on-the-fly shop is trimmed and colour-checked", function () {
  var shops = QD.addShopIfNew([], "  Night Owl  ", "zzz");
  assert.strictEqual(shops[0].name, "Night Owl");
  assert.strictEqual(shops[0].colour, QD.CART_FALLBACK);
});
t("carts list newest first", function () {
  var st = { carts: [cart({ id: "old", createdAt: 1 }), cart({ id: "new", createdAt: 9 })],
             shops: [], lastSweptOn: null };
  assert.deepStrictEqual(QD.cartsNewestFirst(st).map(function (c) { return c.id; }), ["new", "old"]);
});
t("shops list by name, case-insensitively", function () {
  var st = { carts: [], lastSweptOn: null, shops: [
    QD.normShop({ name: "pak'nSave" }), QD.normShop({ name: "Countdown" }),
    QD.normShop({ name: "Warehouse" })] };
  assert.deepStrictEqual(QD.shopsByName(st).map(function (s) { return s.name; }),
    ["Countdown", "pak'nSave", "Warehouse"]);
});
t("a closed bubble previews up to five unchecked items", function () {
  var c = cart({ items: [item("a"), item("b", true), item("c"), item("d"), item("e"),
                         item("f"), item("g")] });
  assert.deepStrictEqual(QD.cartPreview(c, 5).map(function (i) { return i.id; }),
    ["a", "c", "d", "e", "f"]);
  assert.strictEqual(QD.cartOpenCount(c), 6);
});

console.log("\nmidnight sweep");
t("items ticked on an earlier day are swept", function () {
  var st = { lastSweptOn: "2026-09-08", shops: [], carts: [
    cart({ items: [item("keep"), item("goneYesterday", true, "2026-09-08")] })] };
  var out = QD.sweepCarts(st, TODAY);
  assert.deepStrictEqual(out.carts[0].items.map(function (i) { return i.id; }), ["keep"]);
  assert.strictEqual(out.lastSweptOn, TODAY);
});
t("items ticked today survive until tonight", function () {
  var st = { lastSweptOn: "2026-09-08", shops: [], carts: [
    cart({ items: [item("tickedToday", true, TODAY)] })] };
  assert.deepStrictEqual(QD.sweepCarts(st, TODAY).carts[0].items.map(function (i) { return i.id; }),
    ["tickedToday"]);
});
t("unchecked items are never swept, however old", function () {
  var st = { lastSweptOn: "2020-01-01", shops: [], carts: [cart({ items: [item("old")] })] };
  assert.deepStrictEqual(QD.sweepCarts(st, TODAY).carts[0].items.length, 1);
});
t("it sweeps every cart, and only carts", function () {
  var st = { lastSweptOn: "2026-09-08", shops: [QD.normShop({ name: "S" })], carts: [
    cart({ id: "one", items: [item("a", true, "2026-09-08")] }),
    cart({ id: "two", items: [item("b", true, "2026-09-01"), item("c")] })] };
  var out = QD.sweepCarts(st, TODAY);
  assert.deepStrictEqual(out.carts[0].items, []);
  assert.deepStrictEqual(out.carts[1].items.map(function (i) { return i.id; }), ["c"]);
  assert.strictEqual(out.shops.length, 1, "shops untouched");
});
t("sweeping twice in a day is a no-op", function () {
  var st = { lastSweptOn: TODAY, shops: [], carts: [cart({ items: [item("x", true, "2020-01-01")] })] };
  assert.strictEqual(QD.sweepCarts(st, TODAY), st, "same object, no work done");
});
t("a checked item with no timestamp is given one rather than vanishing", function () {
  var out = QD.normCarts({ carts: [{ id: "c", shop: "S", items: [
    { id: "i", text: "Thing", checked: true }] }], shops: [] });
  assert.ok(out.carts[0].items[0].checkedAt, "timestamp minted");
  assert.strictEqual(QD.sweepCarts(out, TODAY).carts[0].items.length, 1, "survives this sweep");
});

console.log("\ncarts: migration and junk");
t("the old flat shopping list folds into one cart", function () {
  var out = QD.normCarts(null, { items: [
    { id: "a", name: "Oat milk", got: false },
    { id: "b", name: "Bread", got: true, at: 1234 }] });
  assert.strictEqual(out.carts.length, 1);
  assert.strictEqual(out.carts[0].shop, "Shopping");
  assert.deepStrictEqual(out.carts[0].items.map(function (i) { return i.text; }), ["Oat milk", "Bread"]);
  assert.strictEqual(out.carts[0].items[1].checked, true);
  assert.strictEqual(out.carts[0].items[1].checkedAt, 1234);
});
t("existing carts are never overwritten by the old list", function () {
  var out = QD.normCarts({ carts: [cart({ id: "mine" })], shops: [] },
    { items: [{ id: "x", name: "Ignore me" }] });
  assert.deepStrictEqual(out.carts.map(function (c) { return c.id; }), ["mine"]);
});
t("an empty old list migrates to nothing", function () {
  assert.deepStrictEqual(QD.normCarts(null, { items: [] }).carts, []);
  assert.deepStrictEqual(QD.normCarts(null, null).carts, []);
});
t("junk carts, shops and items are dropped", function () {
  var out = QD.normCarts({ carts: [null, { shop: "" }, { shop: "Real", items: [null, { text: "" }, { text: "Kept" }] }],
                           shops: [null, { name: "" }, { name: "Good", colour: "zzz" }] });
  assert.strictEqual(out.carts.length, 1);
  assert.deepStrictEqual(out.carts[0].items.map(function (i) { return i.text; }), ["Kept"]);
  assert.strictEqual(out.shops.length, 1);
  assert.strictEqual(out.shops[0].colour, QD.CART_FALLBACK, "a bad colour falls back");
});

console.log("\nsinceLabel");
t("reads naturally across the week", function () {
  assert.strictEqual(QD.sinceLabel("2026-09-08", TODAY), "yesterday");
  assert.strictEqual(QD.sinceLabel("2026-09-06", TODAY), "Sunday");
  assert.strictEqual(QD.sinceLabel("2026-08-30", TODAY), "30 Aug");
});


console.log("\nhabit schedules");
function slot(o) { return QD.makeSlot(o); }
/* 2026-09-09 is a Wednesday. */
var WED = "2026-09-09", THU = "2026-09-10", SAT = "2026-09-12", SUN = "2026-09-13";
t("a weekly slot fires only on its days", function () {
  var s = slot({ recurrence: "weekly", daysOfWeek: [1, 2, 4], startTime: "05:00" });
  assert.strictEqual(QD.slotMatches(s, THU), true, "Thursday");
  assert.strictEqual(QD.slotMatches(s, WED), false, "Wednesday");
  assert.strictEqual(QD.slotMatches(s, SAT), false, "Saturday");
});
t("a dates slot fires only on the dates listed", function () {
  var s = slot({ recurrence: "dates", specificDates: [SAT, SUN], startTime: "09:00" });
  assert.strictEqual(QD.slotMatches(s, SAT), true);
  assert.strictEqual(QD.slotMatches(s, WED), false);
});
t("a monthly slot on the 31st still fires in a 30-day month", function () {
  var s = slot({ recurrence: "monthly", dayOfMonth: 31, startTime: "08:00" });
  assert.strictEqual(QD.slotMatches(s, "2026-09-30"), true, "Sep has 30 days");
  assert.strictEqual(QD.slotMatches(s, "2026-10-31"), true, "Oct has 31");
  assert.strictEqual(QD.slotMatches(s, "2026-10-30"), false);
  assert.strictEqual(QD.slotMatches(s, "2026-02-28"), true, "Feb falls back to the 28th");
});
t("a yearly slot needs both its months and its day", function () {
  var s = slot({ recurrence: "yearly", monthsOfYear: [8, 9], dayOfMonth: 12, startTime: "10:00" });
  assert.strictEqual(QD.slotMatches(s, "2026-09-12"), true);
  assert.strictEqual(QD.slotMatches(s, "2026-08-12"), true);
  assert.strictEqual(QD.slotMatches(s, "2026-07-12"), false);
  assert.strictEqual(QD.slotMatches(s, "2026-09-13"), false);
});
t("a slot that could never fire is rejected, not stored", function () {
  assert.strictEqual(slot({ recurrence: "weekly", daysOfWeek: [], startTime: "05:00" }), null);
  assert.strictEqual(slot({ recurrence: "dates", specificDates: [], startTime: "05:00" }), null);
  assert.strictEqual(slot({ recurrence: "monthly", startTime: "05:00" }), null);
  assert.strictEqual(slot({ recurrence: "weekly", daysOfWeek: [1] }), null, "no start time");
  assert.strictEqual(slot({ recurrence: "yearly", monthsOfYear: [8], startTime: "05:00" }), null);
});
t("junk days and months are dropped, and the rest kept", function () {
  var s = slot({ recurrence: "weekly", daysOfWeek: [9, 1, "2", -3, 1, null], startTime: "05:00" });
  assert.deepStrictEqual(s.daysOfWeek, [1, 2], "deduped, sorted, in range");
});
t("an end time before its start is not a duration", function () {
  var s = slot({ recurrence: "weekly", daysOfWeek: [1], startTime: "09:00", endTime: "08:00" });
  assert.strictEqual(s.endTime, null);
  var ok = slot({ recurrence: "weekly", daysOfWeek: [1], startTime: "09:00", endTime: "17:00" });
  assert.strictEqual(ok.endTime, "17:00");
});

console.log("\nhabits: the worked examples");
var GYM = QD.makeHabit("Gym", { importance: "should", schedule: [
  { recurrence: "weekly", daysOfWeek: [1, 2, 4], startTime: "05:00" },
  { recurrence: "weekly", daysOfWeek: [6, 0], startTime: "08:00" }
] });
var WORK = QD.makeHabit("Work", { importance: "must", schedule: [
  { recurrence: "weekly", daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }
] });
var RUBBISH = QD.makeHabit("Take out rubbish", { schedule: [
  { recurrence: "weekly", daysOfWeek: [3], startTime: "08:00" }
] });
t("one habit can carry two different times", function () {
  assert.strictEqual(GYM.schedule.length, 2);
  assert.strictEqual(QD.habitSlotsOn(GYM, THU)[0].startTime, "05:00", "Thursday is an early one");
  assert.strictEqual(QD.habitSlotsOn(GYM, SAT)[0].startTime, "08:00", "Saturday is a late one");
  assert.strictEqual(QD.habitSlotsOn(GYM, WED).length, 0, "no gym on Wednesday");
});
t("work keeps its end time", function () {
  var s = QD.habitSlotsOn(WORK, WED)[0];
  assert.strictEqual(s.startTime, "09:00");
  assert.strictEqual(s.endTime, "17:00");
});
t("the schedule reads back as a summary", function () {
  assert.strictEqual(QD.habitSummary(GYM), "Mon/Tue/Thu 05:00, Sat/Sun 08:00");
  assert.strictEqual(QD.habitSummary(WORK), "Mon/Tue/Wed/Thu/Fri 09:00–17:00");
  assert.strictEqual(QD.habitSummary(RUBBISH), "Wed 08:00");
});
t("a paused habit matches nothing but keeps its schedule", function () {
  var off = QD.normHabit(Object.assign({}, GYM, { active: false }));
  assert.deepStrictEqual(QD.habitSlotsOn(off, THU), []);
  assert.strictEqual(off.schedule.length, 2, "the schedule is still there");
});
t("a habit with no workable slot is not a habit", function () {
  assert.strictEqual(QD.makeHabit("Nothing", { schedule: [] }), null);
  assert.strictEqual(QD.makeHabit("", { schedule: [{ recurrence: "weekly", daysOfWeek: [1], startTime: "05:00" }] }), null);
});
t("nextHabitDay finds the next time it comes round", function () {
  assert.strictEqual(QD.nextHabitDay(RUBBISH, WED), WED, "today counts");
  assert.strictEqual(QD.nextHabitDay(RUBBISH, THU), "2026-09-16", "next Wednesday");
});

console.log("\nhabits: generating today's tasks");
function habitState(list) {
  return QD.normHabits({ habits: list, gen: {}, lastGenOn: null });
}
t("a matching slot mints a task in today", function () {
  var out = QD.generateHabitTasks(habitState([GYM, RUBBISH]), [], WED, 1000);
  assert.strictEqual(out.added.length, 1, "only rubbish runs on a Wednesday");
  var t0 = out.added[0];
  assert.strictEqual(t0.title, "Take out rubbish");
  assert.strictEqual(t0.bucket, "today");
  assert.strictEqual(t0.dueDate, WED);
  assert.strictEqual(t0.dueTime, "08:00");
  assert.strictEqual(t0.habitId, RUBBISH.id);
});
t("a habit with two slots on one day mints both", function () {
  var both = QD.makeHabit("Pills", { schedule: [
    { recurrence: "weekly", daysOfWeek: [3], startTime: "08:00" },
    { recurrence: "weekly", daysOfWeek: [3], startTime: "20:00" }
  ] });
  var out = QD.generateHabitTasks(habitState([both]), [], WED, 1000);
  assert.strictEqual(out.added.length, 2);
  assert.deepStrictEqual(out.added.map(function (x) { return x.dueTime; }), ["08:00", "20:00"]);
});
t("the habit's importance rides along", function () {
  var out = QD.generateHabitTasks(habitState([WORK]), [], WED, 1000);
  assert.strictEqual(out.added[0].importance, "must");
  assert.strictEqual(out.added[0].endTime, "17:00");
});
t("opening the app twice does not mint it twice", function () {
  var st = habitState([RUBBISH]);
  var one = QD.generateHabitTasks(st, [], WED, 1000);
  var two = QD.generateHabitTasks(one.habits, one.items, WED, 2000);
  assert.strictEqual(two.added.length, 0);
  assert.strictEqual(two.items.length, 1);
});
t("deleting a generated task does not bring it back on the next open", function () {
  var st = habitState([RUBBISH]);
  var one = QD.generateHabitTasks(st, [], WED, 1000);
  var afterDelete = [];
  var two = QD.generateHabitTasks(one.habits, afterDelete, WED, 2000);
  assert.deepStrictEqual(two.added, [], "the deletion sticks for the day");
});
t("a paused habit mints nothing", function () {
  var off = QD.normHabit(Object.assign({}, RUBBISH, { active: false }));
  var out = QD.generateHabitTasks(habitState([off]), [], WED, 1000);
  assert.deepStrictEqual(out.added, []);
});
t("batch minting staggers createdAt so the order holds", function () {
  var many = QD.makeHabit("Rounds", { schedule: [
    { recurrence: "weekly", daysOfWeek: [3], startTime: "07:00" },
    { recurrence: "weekly", daysOfWeek: [3], startTime: "12:00" },
    { recurrence: "weekly", daysOfWeek: [3], startTime: "18:00" }
  ] });
  var out = QD.generateHabitTasks(habitState([many]), [], WED, 1000);
  var stamps = out.added.map(function (x) { return x.createdAt; });
  assert.strictEqual(new Set(stamps).size, 3, "no two share a millisecond");
});
t("a new day mints again", function () {
  var one = QD.generateHabitTasks(habitState([WORK]), [], WED, 1000);
  var two = QD.generateHabitTasks(one.habits, one.items, THU, 2000);
  assert.strictEqual(two.added.length, 1, "Thursday is a work day too");
});
t("editing a schedule leaves tasks already minted alone", function () {
  var one = QD.generateHabitTasks(habitState([RUBBISH]), [], WED, 1000);
  var moved = QD.normHabit(Object.assign({}, RUBBISH, {
    schedule: [{ id: RUBBISH.schedule[0].id, recurrence: "weekly", daysOfWeek: [5], startTime: "18:00" }]
  }));
  var two = QD.generateHabitTasks(
    { habits: [moved], gen: one.habits.gen, lastGenOn: null }, one.items, WED, 2000);
  assert.strictEqual(two.items[0].dueTime, "08:00", "today's instance is untouched");
  assert.strictEqual(two.added.length, 0, "and Friday's does not arrive early");
});

console.log("\nhabits: instances are per-day");
t("ticking an instance off does not touch the habit", function () {
  var out = QD.generateHabitTasks(habitState([RUBBISH]), [], WED, 1000);
  var done = Object.assign({}, out.items[0], { completedAt: ms(WED, 9) });
  assert.strictEqual(QD.normHabits(out.habits).habits[0].active, true);
  assert.strictEqual(QD.habitSlotsOn(QD.normHabits(out.habits).habits[0], "2026-09-16").length, 1);
  assert.ok(done.completedAt, "only this occurrence is done");
});
t("an unfinished instance clears at the rollover rather than piling up", function () {
  var out = QD.generateHabitTasks(habitState([RUBBISH]), [], WED, 1000);
  var state = { version: 2, items: out.items, doneYesterday: 0, lastRollOn: WED };
  var rolled = QD.rollDay(state, THU);
  assert.deepStrictEqual(rolled.items, [], "yesterday's rubbish is not today's rubbish");
});
t("the rollover leaves ordinary carry-ins exactly as they were", function () {
  var plain = task("plain");
  var out = QD.generateHabitTasks(habitState([RUBBISH]), [plain], WED, 1000);
  var rolled = QD.rollDay(
    { version: 2, items: out.items, doneYesterday: 0, lastRollOn: WED }, THU);
  assert.deepStrictEqual(ids(rolled.items), ["plain"]);
});
t("habit provenance survives a save and reload", function () {
  var out = QD.generateHabitTasks(habitState([WORK]), [], WED, 1000);
  var back = QD.migrate({ version: 2, items: out.items, doneYesterday: 0, lastRollOn: WED }, WED);
  assert.strictEqual(back.items[0].habitId, WORK.id);
  assert.strictEqual(back.items[0].genOn, WED);
  assert.strictEqual(back.items[0].endTime, "17:00");
  assert.strictEqual(QD.isHabitTask(back.items[0]), true);
});
t("a hand-made task is never mistaken for a habit instance", function () {
  assert.strictEqual(QD.isHabitTask(task("plain")), false);
});
t("generated tasks lead the day in clock order", function () {
  var out = QD.generateHabitTasks(habitState([GYM, WORK]), [task("plain", { importance: "must" })], THU, 1000);
  assert.deepStrictEqual(
    QD.rankToday(out.items, THU).map(function (x) { return x.title; }),
    ["Gym", "Work", "plain"]);
});

console.log("\nhabits: storage hygiene");
t("junk habits and slots are dropped on load", function () {
  var out = QD.normHabits({ habits: [null, 42, { name: "" }, { name: "O", schedule: [] }], gen: null });
  assert.deepStrictEqual(out.habits, []);
  assert.deepStrictEqual(out.gen, {});
});
t("empty and junk input give a valid empty state", function () {
  [null, undefined, 42, "nope", {}].forEach(function (junk) {
    var out = QD.normHabits(junk);
    assert.deepStrictEqual(out.habits, []);
    assert.strictEqual(out.lastGenOn, null);
  });
});
t("a junk date in the ledger is discarded, not trusted", function () {
  var out = QD.normHabits({ habits: [], gen: { "a:b": "nope", "c:d": WED } });
  assert.deepStrictEqual(out.gen, { "c:d": WED });
});

console.log("\na later time waits at the bottom");
function at(id, time, o) {
  o = o || {};
  var t = task(id, o);
  return QD.applyPatch(t, { dueTime: time }, TODAY, t.createdAt);
}
var NINE = 9 * 60, SIX_PM = 18 * 60, EIGHT_PM = 20 * 60;
t("a 21:00 task sits under the flexible work in the morning", function () {
  var meds = at("meds", "21:00");
  var chore = task("chore", { importance: "nice" });
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore], TODAY, NINE)), ["chore", "meds"]);
});
t("and comes up once it is close", function () {
  var meds = at("meds", "21:00");
  var chore = task("chore", { importance: "nice" });
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore], TODAY, SIX_PM)), ["meds", "chore"],
    "three hours out it is in play");
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore], TODAY, EIGHT_PM)), ["meds", "chore"]);
});
t("the morning's own times still lead the morning", function () {
  var pills = at("pills", "07:30");
  var work = at("work", "09:00");
  var chore = task("chore", { importance: "must" });
  var meds = at("meds", "21:00");
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore, work, pills], TODAY, 7 * 60)),
    ["pills", "work", "chore", "meds"]);
});
t("an overdue time never sinks — a missed dose stays in front of you", function () {
  var pills = at("pills", "07:30");
  var chore = task("chore", { importance: "nice" });
  assert.deepStrictEqual(ids(QD.rankToday([chore, pills], TODAY, 22 * 60)), ["pills", "chore"]);
});
t("waiting tasks keep clock order among themselves", function () {
  var nine = at("nine", "21:00");
  var ten = at("ten", "22:00");
  var eight = at("eight", "20:00");
  var chore = task("chore");
  assert.deepStrictEqual(ids(QD.rankToday([ten, nine, eight, chore], TODAY, NINE)),
    ["chore", "eight", "nine", "ten"]);
});
t("the lead-in is exactly three hours, inclusive", function () {
  var meds = at("meds", "21:00");
  var chore = task("chore");
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore], TODAY, 18 * 60)), ["meds", "chore"],
    "18:00 is three hours out and counts");
  assert.deepStrictEqual(ids(QD.rankToday([meds, chore], TODAY, 18 * 60 - 1)), ["chore", "meds"],
    "a minute earlier it is still waiting");
});
t("isWaiting says which band a task is in", function () {
  var meds = at("meds", "21:00");
  assert.strictEqual(QD.isWaiting(meds, TODAY, NINE), true);
  assert.strictEqual(QD.isWaiting(meds, TODAY, EIGHT_PM), false);
  assert.strictEqual(QD.isWaiting(task("chore"), TODAY, NINE), false, "untimed never waits");
});
t("a task dated another day is untimed as far as today goes", function () {
  var later = QD.applyPatch(task("later"), { dueDate: QD.shiftKey(TODAY, 2), dueTime: "21:00" }, TODAY, 1);
  assert.strictEqual(QD.isWaiting(later, TODAY, NINE), false);
});
t("with no clock given, every time still leads — the brief keeps its shape", function () {
  var meds = at("meds", "21:00");
  var chore = task("chore", { importance: "must" });
  assert.deepStrictEqual(ids(QD.rankToday([chore, meds], TODAY)), ["meds", "chore"]);
});
t("ordering stays a total order in every band", function () {
  var a = at("a", "21:00"), b = at("b", "21:00");
  b.createdAt = a.createdAt;
  var chore = task("chore");
  assert.deepStrictEqual(ids(QD.rankToday([a, b, chore], TODAY, NINE)),
                         ids(QD.rankToday([b, chore, a], TODAY, NINE)));
});
t("the brief still lists the whole day's fixed points in clock order", function () {
  var pills = at("pills", "07:30");
  var meds = at("meds", "21:00");
  assert.deepStrictEqual(ids(QD.fixedPoints([meds, pills], TODAY)), ["pills", "meds"]);
});


console.log("\nmomentum: points and the daily ladder");
var GDAY = "2026-09-09";
function goal(o) {
  o = o || {};
  return QD.makeGoal(o.name || "Fitness", { now: o.now || ms("2026-09-01", 9) });
}
function tk(id, imp) { return task(id, { importance: imp || "should" }); }
function hInst(id, habitId, slotId, on) {
  var t = QD.normTask({ id: id, title: id, bucket: "today", createdAt: ms(on, 8) }, on);
  t.habitId = habitId; t.slotId = slotId; t.genOn = on;
  return t;
}
function addN(state, g, mk, n, day) {
  var st = state;
  for (var i = 0; i < n; i++) st = QD.addActivity(st, g, mk(i), ms(day, 9) + i);
  return st;
}
t("a task is worth its priority, a habit a flat five", function () {
  assert.strictEqual(QD.basePoints(tk("a", "must")), 8);
  assert.strictEqual(QD.basePoints(tk("a", "should")), 6);
  assert.strictEqual(QD.basePoints(tk("a", "nice")), 4);
  assert.strictEqual(QD.basePoints(hInst("h", "gym", "s", GDAY)), 5);
});
t("the first three of a day are worth full value", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i, "must"); }, 3, GDAY);
  assert.deepStrictEqual(st.activity.map(function (a) { return a.points; }), [8, 8, 8]);
});
t("the fourth to sixth are halved, rounded down", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i, "nice"); }, 6, GDAY);
  assert.deepStrictEqual(st.activity.map(function (a) { return a.points; }), [4, 4, 4, 2, 2, 2]);
});
t("the seventh onward is a quarter, never less than one", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i, "nice"); }, 8, GDAY);
  assert.deepStrictEqual(st.activity.slice(6).map(function (a) { return a.points; }), [1, 1],
    "a quarter of four rounds to one, and the floor holds it there");
});
t("nothing banks more than the day's ceiling", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i, "must"); }, 12, GDAY);
  var total = st.activity.reduce(function (n, a) { return n + a.points; }, 0);
  assert.strictEqual(total, QD.MOMENTUM.dayCeiling);
  assert.ok(st.activity.every(function (a) { return a.points >= 0; }), "and never goes negative");
});
t("a new day starts the ladder again", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("a" + i, "must"); }, 3, GDAY);
  st = addN(st, g, function (i) { return tk("b" + i, "must"); }, 1, "2026-09-10");
  assert.strictEqual(QD.pointsOnDay(st.activity, g.id, "2026-09-10"), 8);
});
t("two goals each get their own day", function () {
  var g1 = goal({ name: "One" }), g2 = goal({ name: "Two" });
  var st = { goals: [g1, g2], activity: [] };
  st = addN(st, g1, function (i) { return tk("a" + i, "must"); }, 3, GDAY);
  st = addN(st, g2, function (i) { return tk("b" + i, "must"); }, 1, GDAY);
  assert.strictEqual(QD.pointsOnDay(st.activity, g2.id, GDAY), 8, "not halved by the other goal");
});

console.log("\nmomentum: undo");
t("reversing a completion takes its row and leaves no orphan points", function () {
  var g = goal();
  var one = tk("t1", "must");
  var st = QD.addActivity({ goals: [g], activity: [] }, g, one, ms(GDAY, 9));
  assert.strictEqual(st.activity.length, 1);
  st = QD.removeActivity(st, one);
  assert.deepStrictEqual(st.activity, []);
  assert.strictEqual(QD.pointsOnDay(st.activity, g.id, GDAY), 0);
});
t("three musts already all but fill the day's ceiling", function () {
  var g = goal();
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i, "must"); }, 4, GDAY);
  assert.deepStrictEqual(st.activity.map(function (a) { return a.points; }), [8, 8, 8, 1],
    "the fourth is worth 4 by the ladder but only 1 fits under the ceiling");
});
t("and the rest of the day is recalculated, not left stale", function () {
  var g = goal();
  var made = [];
  var st = { goals: [g], activity: [] };
  for (var i = 0; i < 4; i++) {
    var one = tk("t" + i, "nice");
    made.push(one);
    st = QD.addActivity(st, g, one, ms(GDAY, 9) + i);
  }
  assert.deepStrictEqual(st.activity.map(function (a) { return a.points; }), [4, 4, 4, 2]);
  st = QD.removeActivity(st, made[0]);
  assert.deepStrictEqual(st.activity.map(function (a) { return a.points; }), [4, 4, 4],
    "the fourth was only halved because it was fourth");
});
t("an undo survives a reload, because the pre-cap value is kept", function () {
  var g = goal();
  var made = [], st = { goals: [g], activity: [] };
  for (var i = 0; i < 4; i++) {
    var one = tk("t" + i, "nice"); made.push(one);
    st = QD.addActivity(st, g, one, ms(GDAY, 9) + i);
  }
  var reloaded = QD.normGoals(JSON.parse(JSON.stringify(st)));
  var after = QD.removeActivity(reloaded, made[0]);
  assert.deepStrictEqual(after.activity.map(function (a) { return a.points; }), [4, 4, 4]);
});
t("unticking a habit instance removes that instance only", function () {
  var g = goal();
  var mon = hInst("m", "gym", "s1", "2026-09-07");
  var wed = hInst("w", "gym", "s1", GDAY);
  var st = QD.addActivity({ goals: [g], activity: [] }, g, mon, ms("2026-09-07", 6));
  st = QD.addActivity(st, g, wed, ms(GDAY, 6));
  st = QD.removeActivity(st, wed);
  assert.strictEqual(st.activity.length, 1);
  assert.strictEqual(QD.pointsOnDay(st.activity, g.id, "2026-09-07"), 5);
});

console.log("\nmomentum: earning and cooling");
function withDays(g, spec) {
  /* spec: { "2026-09-09": 3, ... } completions of a must-task on each day */
  var st = { goals: [g], activity: [] };
  Object.keys(spec).sort().forEach(function (day) {
    st = addN(st, g, function (i) { return tk(day + "-" + i, "must"); }, spec[day], day);
  });
  return st;
}
t("momentum is nothing until something is done", function () {
  var g = goal();
  assert.strictEqual(QD.goalMomentum(g, [], "2026-09-01"), 0);
});
t("it climbs with the day's points", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  assert.strictEqual(QD.goalMomentum(g, st.activity, GDAY), 24);
});
t("one quiet day is free", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-10"), 24, "the grace day");
});
t("each further quiet day costs four", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  /* 09-10 is the grace day; it only counts once it has closed, so the first
     four points come off on the 12th. */
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-12"), 20);
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-13"), 16);
});
t("it floors at nothing and never goes into debt", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 1 });
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-10-30"), 0);
});
t("it is clamped at a hundred however hard the week", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var spec = {};
  for (var i = 1; i <= 20; i++) spec["2026-09-" + (i < 10 ? "0" + i : i)] = 6;
  var st = withDays(g, spec);
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-20"), 100);
});
t("today never decays — a day only counts once it has closed", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-11"), 24,
    "the 11th is still in progress; only the 10th has closed, and it was the grace day");
  assert.strictEqual(QD.goalMomentum(g, st.activity, "2026-09-12"), 20,
    "cooling shows the following morning, not the moment midnight passes");
});
t("a paused goal holds its value, frozen", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  var settled = QD.settleGoal(g, st.activity, "2026-09-11");
  var paused = QD.normGoal(Object.assign({}, settled, { active: false }));
  var held = QD.goalMomentum(paused, st.activity, "2026-11-01");
  assert.strictEqual(held, paused.momentum, "months later, unchanged");
  assert.ok(held > 0);
});
t("work done before the goal existed does not backfill it", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = QD.addActivity({ goals: [g], activity: [] }, g, tk("early", "must"), ms("2026-09-01", 9));
  assert.deepStrictEqual(st.activity, []);
});

console.log("\nmomentum: the cached checkpoint");
t("settling matches replaying the whole log", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 2, "2026-09-03": 1, "2026-09-07": 3, "2026-09-09": 1 });
  var replayed = QD.goalMomentum(g, st.activity, "2026-09-12");
  var settled = QD.settleGoal(g, st.activity, "2026-09-12");
  assert.strictEqual(QD.goalMomentum(settled, st.activity, "2026-09-12"), replayed);
});
t("settling twice changes nothing", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 2, "2026-09-07": 3 });
  var once = QD.settleGoal(g, st.activity, "2026-09-12");
  var twice = QD.settleGoal(once, st.activity, "2026-09-12");
  assert.deepStrictEqual(twice, once);
});
t("settling day by day matches settling in one jump", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 3, "2026-09-05": 2, "2026-09-08": 1 });
  var step = g;
  ["2026-09-03","2026-09-04","2026-09-05","2026-09-06","2026-09-07","2026-09-08",
   "2026-09-09","2026-09-10"].forEach(function (d) {
    step = QD.settleGoal(step, st.activity, d);
  });
  var jump = QD.settleGoal(g, st.activity, "2026-09-10");
  assert.strictEqual(step.momentum, jump.momentum,
    "opening the app every day and opening it once a week agree");
});
t("the cache can be thrown away and rebuilt from the log", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 2, "2026-09-07": 3 });
  var settled = QD.settleGoal(g, st.activity, "2026-09-12");
  var wiped = QD.normGoal(Object.assign({}, settled, { momentum: 0, momentumAsOf: null }));
  assert.strictEqual(QD.goalMomentum(wiped, st.activity, "2026-09-12"),
                     QD.goalMomentum(settled, st.activity, "2026-09-12"));
});
t("settling leaves today alone, so today can still earn", function () {
  var g = goal({ now: ms("2026-09-08", 0) });
  var st = withDays(g, { "2026-09-08": 1, "2026-09-09": 2 });
  var settled = QD.settleGoal(g, st.activity, GDAY);
  assert.strictEqual(settled.momentumAsOf, "2026-09-08");
  assert.strictEqual(QD.goalMomentum(settled, st.activity, GDAY), 8 + 16);
});

console.log("\nmomentum: how it reads");
t("bands cover the whole range with no gap", function () {
  assert.strictEqual(QD.momentumBand(0).id, "dormant");
  assert.strictEqual(QD.momentumBand(19).id, "dormant");
  assert.strictEqual(QD.momentumBand(20).id, "warm");
  assert.strictEqual(QD.momentumBand(49).id, "warm");
  assert.strictEqual(QD.momentumBand(50).id, "ember");
  assert.strictEqual(QD.momentumBand(79).id, "ember");
  assert.strictEqual(QD.momentumBand(80).id, "alight");
  assert.strictEqual(QD.momentumBand(100).id, "alight");
});
t("the line states what is happening and nothing about what it means", function () {
  var g = goal({ now: ms("2026-09-09", 0) });
  var st = withDays(g, { "2026-09-09": 3 });
  assert.strictEqual(QD.momentumLine(g, st.activity, GDAY), "Warm — active today");
  /* A goal made earlier, so the days before it are its to claim. */
  var older = goal({ now: ms("2026-09-01", 0) });
  var run = withDays(older, { "2026-09-07": 3, "2026-09-08": 3, "2026-09-09": 3 });
  assert.strictEqual(QD.momentumLine(older, run.activity, GDAY), "Ember — 3 days running");
  assert.strictEqual(QD.momentumLine(g, st.activity, "2026-09-12"),
    "Warm — last activity Wednesday");
});
t("a goal with nothing logged says so plainly", function () {
  var g = goal();
  assert.strictEqual(QD.momentumLine(g, [], GDAY), "Dormant — nothing logged yet");
});
t("a paused goal simply says paused", function () {
  var g = QD.normGoal(Object.assign({}, goal(), { active: false }));
  assert.strictEqual(QD.momentumLine(g, [], GDAY), "Paused");
});
t("no goal copy scolds, warns or exclaims", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 1 });
  ["2026-09-03", "2026-09-10", "2026-09-30", "2026-11-01"].forEach(function (d) {
    var line = QD.momentumLine(g, st.activity, d);
    assert.ok(line.indexOf("!") === -1, line);
    assert.ok(!/neglect|slip|broken|behind|fail|lost|streak|warning/i.test(line), line);
  });
});
t("no band label is a number or a percentage", function () {
  QD.BANDS.forEach(function (b) {
    assert.ok(!/\d|%/.test(b.label), b.label);
  });
});

console.log("\nmomentum: the record");
t("the record is newest first and grouped by day", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = withDays(g, { "2026-09-02": 2, "2026-09-09": 1 });
  var rec = QD.goalRecord(st.activity, g.id, 0, 30);
  assert.deepStrictEqual(rec.days.map(function (d) { return d.day; }), [GDAY, "2026-09-02"]);
  assert.strictEqual(rec.days[1].items.length, 2);
  assert.strictEqual(rec.total, 3);
  assert.strictEqual(rec.more, false);
});
t("it pages rather than handing back the whole history", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var st = addN({ goals: [g], activity: [] }, g, function (i) { return tk("t" + i); }, 40, "2026-09-02");
  var first = QD.goalRecord(st.activity, g.id, 0, 30);
  assert.strictEqual(first.days[0].items.length, 30);
  assert.strictEqual(first.more, true);
  var second = QD.goalRecord(st.activity, g.id, 30, 30);
  assert.strictEqual(second.days[0].items.length, 10);
  assert.strictEqual(second.more, false);
});
t("it keeps the name as it was, even after the task is gone", function () {
  var g = goal({ now: ms("2026-09-01", 0) });
  var one = task("t", { title: "Swim a kilometre" });
  var st = QD.addActivity({ goals: [g], activity: [] }, g, one, ms(GDAY, 9));
  var rec = QD.goalRecord(st.activity, g.id, 0, 30);
  assert.strictEqual(rec.days[0].items[0].title, "Swim a kilometre");
});
t("one goal's record is not another's", function () {
  var g1 = goal({ name: "One" }), g2 = goal({ name: "Two" });
  var st = { goals: [g1, g2], activity: [] };
  st = QD.addActivity(st, g1, tk("a"), ms(GDAY, 9));
  st = QD.addActivity(st, g2, tk("b"), ms(GDAY, 10));
  assert.strictEqual(QD.goalRecord(st.activity, g1.id, 0, 30).total, 1);
});

console.log("\nmomentum: the list");
t("the liveliest goal leads the list", function () {
  var hot = goal({ name: "Hot", now: ms("2026-09-01", 0) });
  var cold = goal({ name: "Cold", now: ms("2026-09-01", 0) });
  var st = { goals: [cold, hot], activity: [] };
  st = addN(st, hot, function (i) { return tk("h" + i, "must"); }, 3, GDAY);
  var out = QD.goalsByMomentum(st, GDAY);
  assert.deepStrictEqual(out.active.map(function (g) { return g.name; }), ["Hot", "Cold"]);
});
t("paused goals sit apart, not among the live ones", function () {
  var live = goal({ name: "Live" });
  var off = QD.normGoal(Object.assign({}, goal({ name: "Off" }), { active: false }));
  var out = QD.goalsByMomentum({ goals: [live, off], activity: [] }, GDAY);
  assert.deepStrictEqual(out.active.map(function (g) { return g.name; }), ["Live"]);
  assert.deepStrictEqual(out.paused.map(function (g) { return g.name; }), ["Off"]);
});
t("junk goals and activity are dropped on load", function () {
  var out = QD.normGoals({ goals: [null, 42, { name: "" }, { name: "Real" }],
    activity: [null, { goalId: "g" }, { goalId: "g", sourceId: "s", completedAt: 5 }] });
  assert.deepStrictEqual(out.goals.map(function (g) { return g.name; }), ["Real"]);
  assert.strictEqual(out.activity.length, 1);
  [null, 42, "x", {}].forEach(function (junk) {
    assert.deepStrictEqual(QD.normGoals(junk), { goals: [], activity: [] });
  });
});
t("a goal written before the rewrite keeps its name", function () {
  var old = QD.normGoal({ id: "g1", title: "Get away in summer", createdAt: 1,
    timeframe: "long", linkedTasks: [{ id: "a" }], status: "active" });
  assert.strictEqual(old.name, "Get away in summer");
  assert.strictEqual(old.momentum, 0);
  assert.strictEqual(old.active, true);
});


console.log("\ngoals: what a task or habit belongs to");
t("a task can carry a goal, and it survives a reload", function () {
  var t1 = QD.makeTask("Book it", { today: TODAY, goalId: "g1" });
  assert.strictEqual(t1.goalId, "g1");
  var back = QD.migrate({ version: 2, items: [t1], doneYesterday: 0, lastRollOn: TODAY }, TODAY);
  assert.strictEqual(back.items[0].goalId, "g1");
});
t("a task with no goal says so plainly rather than being undefined", function () {
  assert.strictEqual(QD.makeTask("Plain", { today: TODAY }).goalId, null);
});
t("a goal can be set and cleared through the usual patch", function () {
  var t1 = QD.makeTask("Book it", { today: TODAY });
  var on = QD.applyPatch(t1, { goalId: "g1" }, TODAY, 1);
  assert.strictEqual(on.goalId, "g1");
  assert.strictEqual(QD.applyPatch(on, { goalId: null }, TODAY, 2).goalId, null);
});
t("a habit's goal is inherited by every instance it mints", function () {
  var hb = QD.makeHabit("Swim", { goalId: "g1", schedule: [
    { recurrence: "weekly", daysOfWeek: [3], startTime: "06:00" }] });
  assert.strictEqual(hb.goalId, "g1");
  var out = QD.generateHabitTasks({ habits: [hb], gen: {}, lastGenOn: null }, [], "2026-09-09", 1);
  assert.strictEqual(out.added.length, 1);
  assert.strictEqual(out.added[0].goalId, "g1");
});
t("changing a habit's goal only reaches instances minted afterwards", function () {
  var hb = QD.makeHabit("Swim", { goalId: "g1", schedule: [
    { recurrence: "weekly", daysOfWeek: [1,2,3,4,5,6,0], startTime: "06:00" }] });
  var one = QD.generateHabitTasks({ habits: [hb], gen: {}, lastGenOn: null }, [], "2026-09-09", 1);
  var moved = QD.normHabit(Object.assign({}, hb, { goalId: "g2" }));
  var two = QD.generateHabitTasks({ habits: [moved], gen: one.habits.gen, lastGenOn: null },
    one.items, "2026-09-10", 2);
  assert.strictEqual(two.items[0].goalId, "g1", "yesterday's instance is untouched");
  assert.strictEqual(two.added[0].goalId, "g2");
});


console.log("\nstreaks");
function actOn(goalId, days, title) {
  return days.map(function (d, i) {
    return { id: goalId + i, goalId: goalId, sourceType: "task", sourceId: "s" + i,
             title: title || "A thing", completedAt: ms(d, 8), points: 6, base: 6 };
  });
}
var SG = QD.makeGoal("Fitness", { now: ms("2026-08-01", 9) });
t("consecutive days fed make a streak", function () {
  var a = actOn(SG.id, ["2026-09-07", "2026-09-08", "2026-09-09"]);
  var st = QD.goalStreak(SG, a, "2026-09-09", 9 * 60);
  assert.strictEqual(st.days, 3);
  assert.strictEqual(st.alive, true);
  assert.strictEqual(st.fedToday, true);
  assert.strictEqual(st.atRisk, false);
});
t("a gap breaks the run, and only the latest run counts", function () {
  var a = actOn(SG.id, ["2026-09-01", "2026-09-02", "2026-09-08", "2026-09-09"]);
  assert.strictEqual(QD.goalStreak(SG, a, "2026-09-09", 0).days, 2);
});
t("it stays alive on the day after, and says how long is left", function () {
  var a = actOn(SG.id, ["2026-09-08", "2026-09-09"]);
  var st = QD.goalStreak(SG, a, "2026-09-10", 19 * 60);
  assert.strictEqual(st.days, 2);
  assert.strictEqual(st.alive, true);
  assert.strictEqual(st.atRisk, true);
  assert.strictEqual(st.hoursLeft, 5);
  assert.strictEqual(QD.streakLabel(st), "2 days · 5 hours left");
});
t("a missed day takes it back to nothing", function () {
  var a = actOn(SG.id, ["2026-09-08", "2026-09-09"]);
  var st = QD.goalStreak(SG, a, "2026-09-11", 9 * 60);
  assert.strictEqual(st.days, 0);
  assert.strictEqual(st.alive, false);
  assert.strictEqual(QD.streakLabel(st), "", "and nothing is said about what went");
});
t("no activity at all is not a streak", function () {
  assert.strictEqual(QD.goalStreak(SG, [], "2026-09-09", 0).days, 0);
});
t("one day reads as one day", function () {
  var a = actOn(SG.id, ["2026-09-09"]);
  assert.strictEqual(QD.streakLabel(QD.goalStreak(SG, a, "2026-09-09", 0)), "1 day");
});
t("the hours left run down through the day", function () {
  var a = actOn(SG.id, ["2026-09-09"]);
  assert.strictEqual(QD.goalStreak(SG, a, "2026-09-10", 0).hoursLeft, 24);
  assert.strictEqual(QD.goalStreak(SG, a, "2026-09-10", 23 * 60 + 30).hoursLeft, 1);
});
t("another goal's days are not this one's", function () {
  var a = actOn("other", ["2026-09-08", "2026-09-09"]);
  assert.strictEqual(QD.goalStreak(SG, a, "2026-09-09", 0).days, 0);
});

console.log("\nthe recap paragraph");
function proseState(spec, goals) {
  var act = [];
  Object.keys(spec).forEach(function (gid) {
    spec[gid].forEach(function (row, i) {
      act.push({ id: gid + i, goalId: gid, sourceType: "task", sourceId: gid + i,
                 title: row[1], completedAt: ms(row[0], 8) + i, points: 6, base: 6 });
    });
  });
  return QD.normGoals({ goals: goals, activity: act });
}
var PG1 = QD.makeGoal("Fitness", { now: ms("2026-08-01", 9) });
var PG2 = QD.makeGoal("Side project", { now: ms("2026-08-01", 9) });
t("a goal fed today is named, with what actually got done", function () {
  var st = proseState({}, [PG1]);
  st.activity = [{ id: "a", goalId: PG1.id, sourceType: "task", sourceId: "t",
    title: "the meal prep", completedAt: ms(TODAY, 8), points: 6, base: 6 }];
  var out = QD.recapGoalProse(st, TODAY);
  assert.ok(out.indexOf("Fitness") >= 0, out);
  assert.ok(out.indexOf("the meal prep") >= 0, out);
});
t("a quiet goal is simply absent, never mentioned as neglected", function () {
  var st = proseState({}, [PG1, PG2]);
  st.activity = [{ id: "a", goalId: PG1.id, sourceType: "task", sourceId: "t",
    title: "a swim", completedAt: ms(TODAY, 8), points: 6, base: 6 }];
  var out = QD.recapGoalProse(st, TODAY);
  assert.ok(out.indexOf("Side project") === -1, out);
  assert.ok(!/neglect|quiet|behind|missed|cooling|slipp/i.test(out), out);
});
t("nothing fed today means no paragraph at all", function () {
  var st = proseState({}, [PG1, PG2]);
  assert.strictEqual(QD.recapGoalProse(st, TODAY), "",
    "not an empty state, and not a sentence about there being nothing");
});
t("at most three goals are named, and the rest get a clause", function () {
  var gs = [], act = [];
  for (var i = 0; i < 5; i++) {
    var g = QD.makeGoal("Goal " + i, { now: ms("2026-08-01", 9) });
    gs.push(g);
    act.push({ id: "a" + i, goalId: g.id, sourceType: "task", sourceId: "t" + i,
      title: "thing " + i, completedAt: ms(TODAY, 8) + i, points: 6, base: 6 });
  }
  var out = QD.recapGoalProse(QD.normGoals({ goals: gs, activity: act }), TODAY);
  var named = gs.filter(function (g) { return out.indexOf(g.name) >= 0; });
  assert.strictEqual(named.length, 3, out);
  assert.ok(/others moved|rest had|ticked over/i.test(out), out);
});
t("the wording is stable on a re-read but moves day to day", function () {
  var mk = function (day) {
    var st = QD.normGoals({ goals: [PG1], activity: [{ id: "a", goalId: PG1.id,
      sourceType: "task", sourceId: "t", title: "a swim",
      completedAt: ms(day, 8), points: 6, base: 6 }] });
    return QD.recapGoalProse(st, day);
  };
  assert.strictEqual(mk(TODAY), mk(TODAY), "the same day reads the same every time");
  var seen = {};
  ["2026-09-09","2026-09-10","2026-09-11","2026-09-12","2026-09-13"].forEach(function (d) {
    seen[mk(d)] = true;
  });
  assert.ok(Object.keys(seen).length > 1, "and different days do not all read alike");
});
t("a goal that rose a band gets a clause; a drop is never mentioned", function () {
  var g = QD.makeGoal("Fitness", { now: ms("2026-09-08", 9) });
  var act = [];
  for (var i = 0; i < 4; i++) {
    act.push({ id: "a" + i, goalId: g.id, sourceType: "task", sourceId: "t" + i,
      title: "a swim", completedAt: ms(TODAY, 8) + i, points: 6, base: 6 });
  }
  var out = QD.recapGoalProse(QD.normGoals({ goals: [g], activity: act }), TODAY);
  assert.ok(/warm|ember|alight/i.test(out), out);
  assert.ok(!/dropped|fell|cooled|down to/i.test(out), out);
});
t("the prose carries no exclamation, no praise and no percentage", function () {
  var gs = [PG1, PG2], act = [];
  ["2026-09-07","2026-09-08","2026-09-09"].forEach(function (d, i) {
    act.push({ id: "a" + i, goalId: PG1.id, sourceType: "task", sourceId: "t" + i,
      title: "a swim", completedAt: ms(d, 8), points: 6, base: 6 });
  });
  act.push({ id: "b", goalId: PG2.id, sourceType: "task", sourceId: "u",
    title: "the copy", completedAt: ms(TODAY, 9), points: 6, base: 6 });
  var out = QD.recapGoalProse(QD.normGoals({ goals: gs, activity: act }), TODAY);
  assert.ok(out.indexOf("!") === -1, out);
  assert.ok(out.indexOf("%") === -1, out);
  assert.ok(!/great|well done|amazing|keep it up|nice work|proud/i.test(out), out);
});
t("it reads as sentences, not a list", function () {
  var st = QD.normGoals({ goals: [PG1], activity: [{ id: "a", goalId: PG1.id,
    sourceType: "task", sourceId: "t", title: "a swim",
    completedAt: ms(TODAY, 8), points: 6, base: 6 }] });
  var out = QD.recapGoalProse(st, TODAY);
  assert.ok(out.indexOf("•") === -1 && out.indexOf("\\n") === -1, out);
  assert.ok(/\.$/.test(out.trim()), "and finishes its sentence: " + out);
});

console.log("\nbullets and boosts");
t("the bullets are the most recent first, capped", function () {
  var act = [];
  for (var i = 0; i < 9; i++) {
    act.push({ id: "a" + i, goalId: "g", sourceType: "task", sourceId: "t" + i,
      title: "thing " + i, completedAt: ms(TODAY, 8) + i, points: 6, base: 6 });
  }
  var out = QD.recentActivity(act, "g", 5);
  assert.strictEqual(out.length, 5);
  assert.strictEqual(out[0].title, "thing 8");
});
t("when something happened reads plainly", function () {
  assert.strictEqual(QD.whenLabel(ms(TODAY, 7), TODAY), "this morning");
  assert.strictEqual(QD.whenLabel(ms(TODAY, 14), TODAY), "this afternoon");
  assert.strictEqual(QD.whenLabel(ms(TODAY, 20), TODAY), "this evening");
  assert.strictEqual(QD.whenLabel(ms("2026-09-08", 9), TODAY), "yesterday");
  assert.strictEqual(QD.whenLabel(ms("2026-09-05", 9), TODAY), "Saturday");
  assert.strictEqual(QD.whenLabel(ms("2026-08-20", 9), TODAY), "20 Aug");
});
t("boosts are things already on the goal and not yet done", function () {
  var items = [
    task("a", { importance: "nice" }), task("b", { importance: "must" }),
    task("c", { completedAt: 1 }), task("d")
  ];
  items[0].goalId = "g"; items[1].goalId = "g"; items[2].goalId = "g";
  var out = QD.goalBoosts("g", items, TODAY, 3);
  assert.deepStrictEqual(ids(out), ["b", "a"], "done ones and unlinked ones are left out");
});
t("today's habit instance comes before the tasks", function () {
  var hb = QD.normTask({ id: "h", title: "Gym", bucket: "today",
    createdAt: ms(TODAY, 8) }, TODAY);
  hb.habitId = "gym"; hb.slotId = "s"; hb.genOn = TODAY; hb.goalId = "g"; hb.dueTime = "06:00";
  var t1 = task("t", { importance: "must" }); t1.goalId = "g";
  assert.deepStrictEqual(ids(QD.goalBoosts("g", [t1, hb], TODAY, 3)), ["h", "t"]);
});
t("a habit instance from an earlier day is not offered again", function () {
  var old = QD.normTask({ id: "h", title: "Gym", bucket: "today",
    createdAt: ms("2026-09-08", 8) }, TODAY);
  old.habitId = "gym"; old.slotId = "s"; old.genOn = "2026-09-08"; old.goalId = "g";
  assert.deepStrictEqual(QD.goalBoosts("g", [old], TODAY, 3), []);
});
t("nothing outstanding means no block at all", function () {
  var done1 = task("a", { completedAt: 1 }); done1.goalId = "g";
  assert.deepStrictEqual(QD.goalBoosts("g", [done1], TODAY, 3), []);
});
t("boosts are capped at three", function () {
  var items = [];
  for (var i = 0; i < 6; i++) { var t1 = task("t" + i); t1.goalId = "g"; items.push(t1); }
  assert.strictEqual(QD.goalBoosts("g", items, TODAY, 3).length, 3);
});


console.log("\nprose: the user's own words");
t("a leading article reads right mid-sentence", function () {
  assert.strictEqual(QD.inSentence("The early gym session"), "the early gym session");
  assert.strictEqual(QD.inSentence("A long walk"), "a long walk");
  assert.strictEqual(QD.inSentence("An hour of scales"), "an hour of scales");
});
t("anything that might be a name is left exactly as typed", function () {
  assert.strictEqual(QD.inSentence("MRI in Napier"), "MRI in Napier");
  assert.strictEqual(QD.inSentence("Ring Mum"), "Ring Mum");
  assert.strictEqual(QD.inSentence("Theatre tickets"), "Theatre tickets",
    "Theatre is not the article The");
  assert.strictEqual(QD.inSentence("Anna's birthday"), "Anna's birthday");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
