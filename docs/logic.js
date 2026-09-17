/* Quiet Desk — pure logic: task model, migration, ranking, brief copy.
   No DOM, no storage. Loaded by the app as window.QD; required by tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QD = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BUCKETS = ["today", "this_week", "this_month", "future"];
  var BUCKET_LABEL = {
    today: "Today", this_week: "This week", this_month: "This month", future: "Future"
  };
  var IMPORTANCE = ["must", "should", "nice"];
  var IMPORTANCE_LABEL = { must: "Must", should: "Should", nice: "Nice" };
  var IMP_ORDER = { must: 0, should: 1, nice: 2 };

  var WD_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var WD3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MO3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var WORDS = ["no","one","two","three","four","five","six","seven","eight","nine","ten"];

  /* ---------- dates (all local, day boundary is local midnight) ---------- */
  function dayKey(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
  }
  function todayKey() { return dayKey(new Date()); }
  function keyToDate(key) {
    var b = String(key).split("-");
    return new Date(+b[0], +b[1] - 1, +b[2]);
  }
  function shiftKey(key, delta) {
    var d = keyToDate(key);
    d.setDate(d.getDate() + delta);
    return dayKey(d);
  }
  /* whole days from `from` to `to`; negative if `to` is earlier */
  function daysBetween(from, to) {
    var a = keyToDate(from), b = keyToDate(to);
    return Math.round((b - a) / 86400000);
  }
  function msToKey(ms) { return dayKey(new Date(ms)); }

  /* "yesterday" / "Monday" / "3 Sep" — how long a carry-in has been waiting */
  function sinceLabel(fromKey, today) {
    var n = daysBetween(fromKey, today);
    if (n <= 0) return "today";
    if (n === 1) return "yesterday";
    if (n < 7) return WD_FULL[keyToDate(fromKey).getDay()];
    var d = keyToDate(fromKey);
    return d.getDate() + " " + MO3[d.getMonth()];
  }
  function numberWord(n) { return n >= 0 && n <= 10 ? WORDS[n] : String(n); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* Appointment fields. Both are optional and independent: a time with no
     date reads as "at 10:30" on whatever day the task is sitting in. */
  function validDate(v) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  function validTime(v) {
    if (typeof v !== "string") return null;
    var m = v.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
    return m ? m[1] : null;
  }

  /* "10:30 · Thursday" — what the row shows under an appointment's title. */
  function dueLabel(dueDate, dueTime, today) {
    var date = validDate(dueDate), time = validTime(dueTime);
    if (!date && !time) return "";
    var parts = [];
    if (time) parts.push(time);
    if (date) {
      var n = daysBetween(today, date);
      var d = keyToDate(date);
      if (n === 0) parts.push("today");
      else if (n === 1) parts.push("tomorrow");
      else if (n === -1) parts.push("yesterday");
      else if (n > 1 && n < 7) parts.push(WD_FULL[d.getDay()]);
      else parts.push(d.getDate() + " " + MO3[d.getMonth()]);
    }
    return parts.join(" \u00b7 ");
  }

  /* Unambiguous form for the brain-dump preview: the point of that screen is
     to catch a wrong date, and "Tuesday" cannot be checked at a glance. */
  function dueLabelLong(dueDate, dueTime, today) {
    var date = validDate(dueDate), time = validTime(dueTime);
    if (!date && !time) return "";
    var parts = [];
    if (time) parts.push(time);
    if (date) {
      var d = keyToDate(date);
      var text = WD3[d.getDay()] + " " + d.getDate() + " " + MO3[d.getMonth()];
      if (d.getFullYear() !== keyToDate(today).getFullYear()) text += " " + d.getFullYear();
      var n = daysBetween(today, date);
      if (n === 0) text += " (today)";
      else if (n === 1) text += " (tomorrow)";
      parts.push(text);
    }
    return parts.join(" \u00b7 ");
  }

  /* Quiet provenance line in the options sheet. */
  function addedLabel(ms, today) {
    var key = msToKey(ms);
    var n = daysBetween(key, today);
    if (n <= 0) return "Added today";
    if (n === 1) return "Added yesterday";
    if (n < 7) return "Added on " + WD_FULL[keyToDate(key).getDay()];
    var d = keyToDate(key);
    var out = d.getDate() + " " + MO3[d.getMonth()];
    if (d.getFullYear() !== keyToDate(today).getFullYear()) out += " " + d.getFullYear();
    return "Added " + out;
  }

  /* ---------- task shape ---------- */
  function makeTask(title, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var day = opts.today || msToKey(now);
    var bucket = BUCKETS.indexOf(opts.bucket) >= 0 ? opts.bucket : "today";
    return {
      id: opts.id || uid(),
      title: String(title),
      bucket: bucket,
      importance: IMPORTANCE.indexOf(opts.importance) >= 0 ? opts.importance : "should",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      notes: opts.notes ? String(opts.notes) : "",
      firstTodayOn: bucket === "today" ? day : null,
      notTodayOn: null,
      staleAskedOn: null,
      dueDate: validDate(opts.dueDate),
      dueTime: validTime(opts.dueTime),
      endTime: validTime(opts.endTime),
      habitId: opts.habitId || null,
      slotId: opts.slotId || null,
      genOn: validDate(opts.genOn),
      goalId: opts.goalId || null
    };
  }

  function normTask(t, today) {
    if (!t || typeof t !== "object") return null;
    var title = t.title != null ? t.title : t.text;   /* v1 called it text */
    if (!title) return null;
    var created = typeof t.createdAt === "number" ? t.createdAt
      : (typeof t.at === "number" ? t.at : Date.now());
    var bucket = BUCKETS.indexOf(t.bucket) >= 0 ? t.bucket : "today";
    return {
      id: t.id || uid(),
      title: String(title),
      bucket: bucket,
      importance: IMPORTANCE.indexOf(t.importance) >= 0 ? t.importance : "should",
      createdAt: created,
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : created,
      completedAt: typeof t.completedAt === "number" ? t.completedAt : (t.done ? created : null),
      notes: t.notes ? String(t.notes) : "",
      firstTodayOn: t.firstTodayOn || (bucket === "today" ? (today || msToKey(created)) : null),
      notTodayOn: t.notTodayOn || null,
      staleAskedOn: t.staleAskedOn || null,
      dueDate: validDate(t.dueDate),
      dueTime: validTime(t.dueTime),
      endTime: validTime(t.endTime),
      habitId: t.habitId || null,
      slotId: t.slotId || null,
      genOn: validDate(t.genOn),
      goalId: t.goalId || null
    };
  }

  /* ---------- migration ----------
     v1: { day, top:[slot|null x3], list:[{id,text,done,at}], doneYesterday }
     Top 3 slots carried the user's priorities, so they become importance "must".
     Everything else defaults to should / today, per spec. */
  function migrate(raw, today) {
    today = today || todayKey();
    if (!raw || typeof raw !== "object") {
      return { version: 2, items: [], doneYesterday: 0, lastRollOn: today };
    }
    if (raw.version === 2 && Array.isArray(raw.items)) {
      return {
        version: 2,
        items: raw.items.map(function (t) { return normTask(t, today); }).filter(Boolean),
        doneYesterday: typeof raw.doneYesterday === "number" ? raw.doneYesterday : 0,
        lastRollOn: raw.lastRollOn || today
      };
    }
    var day = typeof raw.day === "string" ? raw.day : today;
    var items = [];
    (Array.isArray(raw.top) ? raw.top : []).forEach(function (slot) {
      if (!slot) return;
      var t = normTask(slot, day);
      if (t) { t.importance = "must"; t.bucket = "today"; t.firstTodayOn = day; items.push(t); }
    });
    (Array.isArray(raw.list) ? raw.list : []).forEach(function (row) {
      var t = normTask(row, day);
      if (t) { t.importance = "should"; t.bucket = "today"; t.firstTodayOn = day; items.push(t); }
    });
    return {
      version: 2, items: items,
      doneYesterday: typeof raw.doneYesterday === "number" ? raw.doneYesterday : 0,
      lastRollOn: day
    };
  }

  /* ---------- editing ----------
     Bucket moves reset the carry-in clock: a task that leaves `today` and
     comes back later is new to today, not something that has been waiting. */
  function applyPatch(task, changes, today, now) {
    var next = {};
    Object.keys(task).forEach(function (k) { next[k] = task[k]; });
    Object.keys(changes).forEach(function (k) { next[k] = changes[k]; });
    if (changes.title !== undefined) next.title = String(changes.title);
    if (changes.notes !== undefined) next.notes = changes.notes ? String(changes.notes) : "";
    if (changes.dueDate !== undefined) next.dueDate = validDate(changes.dueDate);
    if (changes.dueTime !== undefined) next.dueTime = validTime(changes.dueTime);
    if (changes.endTime !== undefined) next.endTime = validTime(changes.endTime);
    if (changes.goalId !== undefined) next.goalId = changes.goalId || null;
    if (changes.bucket && changes.bucket !== task.bucket) {
      next.notTodayOn = null;
      next.firstTodayOn = changes.bucket === "today" ? today : null;
    }
    /* Clearing a date hands the task back to its manual bucket, set to
       wherever the date had been putting it — otherwise it would appear to
       jump elsewhere, or vanish from the list being looked at. */
    if (changes.dueDate !== undefined && !next.dueDate && validDate(task.dueDate)) {
      next.bucket = bucketForDate(task.dueDate, today);
      next.firstTodayOn = next.bucket === "today" ? today : null;
      next.notTodayOn = null;
    }
    next.updatedAt = typeof now === "number" ? now : Date.now();
    return next;
  }

  /* ---------- day rollover ----------
     Buckets are never changed silently. Completed tasks clear; their count
     is reported once as "N done yesterday". */
  function rollDay(state, today) {
    if (!state || state.lastRollOn === today) return state;
    var done = state.items.filter(function (t) { return !!t.completedAt; });
    return {
      version: 2,
      items: dropStaleHabitTasks(
        state.items.filter(function (t) { return !t.completedAt; }), today),
      doneYesterday: done.length,
      lastRollOn: today
    };
  }

  /* ---------- ranking ---------- */
  function isOpen(t) { return !t.completedAt; }
  /* Only undated tasks carry in. A dated one that is late says so as overdue,
     and saying both would label the same fact twice. */
  function isCarryIn(t, today) {
    return !validDate(t.dueDate) && effectiveBucket(t, today) === "today" &&
      isOpen(t) && !!t.firstTodayOn && t.firstTodayOn < today;
  }
  function impRank(t) {
    var r = IMP_ORDER[t.importance];
    return r === undefined ? 1 : r;
  }
  /* How long before its time a timed task rises to the top of the day. Until
     then it waits at the bottom: a 21:00 medication is not 09:00's business,
     and having it in your eyeline all day is how it stops being read at all. */
  var LEAD_MINUTES = 180;

  function minutesOfTime(v) {
    var t = validTime(v);
    return t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
  }
  /* Which of today's bands a task sits in:
       0  already late — the day it was due has gone
       1  a time today that is due or close enough to matter
       2  the flexible work, ranked as it always was
       3  a time today still further off than the lead-in — the bottom
     Without a clock (`nowMin` omitted) there is no "yet", so every timed task
     leads and band 3 stays empty. That keeps callers which do not care about
     the time of day — the brief, the tests for the other rules — as they were. */
  function todayBand(t, today, nowMin) {
    if (isOverdue(t, today)) return 0;
    var at = isFixedToday(t, today) ? minutesOfTime(t.dueTime) : null;
    if (at === null) return 2;
    if (typeof nowMin !== "number") return 1;
    return at - nowMin <= LEAD_MINUTES ? 1 : 3;
  }

  /* Deterministic: every comparison ends in a total order, so the list never
     reshuffles between reloads at the same moment.
     A time leads the ranking once it is close enough: anything anchored to
     the clock and in play sits at the top of today in chronological order,
     the flexible work — carry-ins oldest first, then importance — follows,
     and a time still hours away waits underneath it all. */
  function compareToday(today, nowMin) {
    return function (a, b) {
      var ba = todayBand(a, today, nowMin), bb = todayBand(b, today, nowMin);
      if (ba !== bb) return ba - bb;
      /* Late things oldest first; a late one need not carry a time at all. */
      if (ba === 0 && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (ba !== 2 && a.dueTime !== b.dueTime) {
        if (!a.dueTime) return 1;
        if (!b.dueTime) return -1;
        return a.dueTime < b.dueTime ? -1 : 1;
      }
      var ca = isCarryIn(a, today), cb = isCarryIn(b, today);
      if (ca !== cb) return ca ? -1 : 1;
      if (ca && cb && a.firstTodayOn !== b.firstTodayOn) return a.firstTodayOn < b.firstTodayOn ? -1 : 1;
      var ia = impRank(a), ib = impRank(b);
      if (ia !== ib) return ia - ib;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    };
  }
  function rankToday(items, today, nowMin) {
    return items.filter(function (t) {
      return effectiveBucket(t, today) === "today" && isOpen(t);
    }).slice().sort(compareToday(today, nowMin));
  }
  /* True while a timed task is still waiting its turn at the bottom. The row
     uses this to sit quieter than the work actually in front of you. */
  function isWaiting(t, today, nowMin) { return todayBand(t, today, nowMin) === 3; }
  /* Tasks ticked off today, in the order they were ticked. They stay on
     screen, struck through, until the midnight rollover clears them — a tap
     is easy to make by accident and must be easy to take back. */
  function completedInBucket(items, bucket, today) {
    return items.filter(function (t) {
      return effectiveBucket(t, today) === bucket &&
        !!t.completedAt && msToKey(t.completedAt) === today;
    }).slice().sort(function (a, b) {
      if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }

  /* Sort key for a timed task outside today: the day it is pinned to, then
     the clock. A time with no date reads as "at 10:30 on whatever day this
     lands", so it trails the dated ones rather than jumping among them. */
  function timeAnchor(t) {
    var time = validTime(t.dueTime);
    if (!time) return null;
    return (validDate(t.dueDate) || "9999-99-99") + " " + time;
  }
  function inBucket(items, bucket, today) {
    return items.filter(function (t) {
      return effectiveBucket(t, today || todayKey()) === bucket && isOpen(t);
    })
      .slice().sort(function (a, b) {
        var wa = timeAnchor(a), wb = timeAnchor(b);
        if (!!wa !== !!wb) return wa ? -1 : 1;
        if (wa && wb && wa !== wb) return wa < wb ? -1 : 1;
        var ia = impRank(a), ib = impRank(b);
        if (ia !== ib) return ia - ib;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
  }

  /* ---------- the day's shape ----------
     A timed task in `today` is a fixed point: the day bends around it.
     Everything else in `today` is flexible and keeps the normal ranking. */
  function isFixedToday(t, today) {
    return effectiveBucket(t, today) === "today" && isOpen(t) && !!validTime(t.dueTime) &&
      (!t.dueDate || t.dueDate === today);
  }
  function fixedPoints(items, today) {
    return items.filter(function (t) { return isFixedToday(t, today); })
      .slice().sort(function (a, b) {
        if (a.dueTime !== b.dueTime) return a.dueTime < b.dueTime ? -1 : 1;
        return compareToday(today)(a, b);
      });
  }
  function flexibleToday(items, today) {
    return items.filter(function (t) {
      return effectiveBucket(t, today) === "today" && isOpen(t) && !isFixedToday(t, today);
    }).slice().sort(compareToday(today));
  }

  /* ---------- suggestions ----------
     There is no longer an "anchored" case to surface. A task dated today is
     *in* today by definition now, so the old pickAnchored — which offered
     dated tasks filed elsewhere for the user to accept — has nothing left to
     find. Suggestions are for undated work only. */
  function pickSuggestions(items, today) {
    var open = rankToday(items, today);
    if (open.length >= 3) return [];
    function from(bucket) {
      var pool = items.filter(function (t) {
        return effectiveBucket(t, today) === bucket && isOpen(t) &&
          t.notTodayOn !== today && !validDate(t.dueDate);
          /* a dated task is already wherever its date puts it */
      });
      return ["must", "should"].reduce(function (acc, imp) {
        return acc.concat(pool.filter(function (t) { return t.importance === imp; })
          .sort(function (a, b) {
            if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
          }));
      }, []);
    }
    var out = from("this_week");
    if (out.length === 0) out = from("this_month");
    return out.slice(0, 3);
  }

  /* ---------- stale check: one this_week task, at most once a week ---------- */
  function pickStale(items, today, prefs) {
    prefs = prefs || {};
    if (prefs.lastStaleAskOn && daysBetween(prefs.lastStaleAskOn, today) < 7) return null;
    var candidates = items.filter(function (t) {
      if (effectiveBucket(t, today) !== "this_week" || !isOpen(t)) return false;
      if (t.staleAskedOn && daysBetween(t.staleAskedOn, today) < 7) return false;
      return daysBetween(msToKey(t.updatedAt || t.createdAt), today) >= 10;
    }).sort(function (a, b) {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return candidates.length ? candidates[0] : null;
  }

  /* ---------- brief copy ----------
     Flat and factual. One sentence, no exclamation marks, no praise or blame. */
  function greetingLine(count) {
    if (count === 0) return "Nothing on today's list.";
    return numberWord(count).replace(/^./, function (c) { return c.toUpperCase(); }) +
      (count === 1 ? " thing on today." : " things on today.");
  }

  /* Returns {before, title, after} so the UI can emphasise the title. */
  function startHere(ranked, today) {
    if (!ranked.length) return null;
    var top = ranked[0];
    var out = { before: "Start with ", title: top.title, after: "" };
    if (isCarryIn(top, today)) {
      out.after = " — it has been on the list since " + sinceLabel(top.firstTodayOn, today) + ".";
      return out;
    }
    var musts = ranked.filter(function (t) { return t.importance === "must"; });
    if (top.importance === "must") {
      out.after = musts.length === 1
        ? " — it is the only must-do today."
        : " — it is the first of " + numberWord(musts.length) + " must-dos.";
      return out;
    }
    out.after = ranked.length === 1
      ? " — it is the only thing on today's list."
      : " — nothing today is marked must-do, so this is the oldest.";
    return out;
  }

  /* The brief's opening advice. Returns segments so the UI can emphasise
     titles: {t: "text"} is plain, {em: "title"} is the task name.
     With no fixed points this is the original one-sentence start-here. */
  function planLine(items, today) {
    var fixed = fixedPoints(items, today);
    if (!fixed.length) {
      var s = startHere(rankToday(items, today), today);
      return s ? { lead: [{ t: s.before }, { em: s.title }, { t: s.after }], advice: null } : null;
    }
    var lead;
    if (fixed.length === 1) {
      lead = [{ em: fixed[0].title },
              { t: " at " + fixed[0].dueTime + " is your only fixed point today." }];
    } else {
      lead = [{ t: numberWord(fixed.length).replace(/^./, function (c) { return c.toUpperCase(); }) +
                   " fixed points today: " }];
      fixed.forEach(function (f, i) {
        if (i) lead.push({ t: i === fixed.length - 1 ? " and " : ", " });
        lead.push({ em: f.title });
        lead.push({ t: " at " + f.dueTime });
      });
      lead.push({ t: "." });
    }
    var flex = flexibleToday(items, today);
    var anchor = fixed.length === 1 ? "it" : "the first";
    var advice;
    if (!flex.length) {
      advice = [{ t: "Nothing else on the list around " + (fixed.length === 1 ? "it" : "them") + "." }];
    } else if (flex.length === 1) {
      advice = [{ em: flex[0].title }, { t: " before " + anchor + "." }];
    } else {
      advice = [{ em: flex[0].title }, { t: " before " + anchor + ", " },
                { em: flex[1].title }, { t: " after." }];
    }
    return { lead: lead, advice: advice };
  }


  /* ---------- natural-language capture ----------
     Rule-based and offline. Recognises a fixed set of shapes; anything it
     does not recognise is left in the title rather than guessed at, and the
     UI shows what it read before anything is saved. */
  var MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7,
                 sep:8, sept:8, oct:9, nov:10, dec:11 };
  var DOWS = { sun:0, mon:1, tue:2, tues:2, wed:3, weds:3, thu:4, thur:4,
               thurs:4, fri:5, sat:6 };
  /* Spelled out in full so "Monitor" is not read as Monday and "Separate"
     is not read as September. */
  var MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|" +
                 "jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|" +
                 "nov(?:ember)?|dec(?:ember)?";
  var DOW_RE = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|" +
               "fri(?:day)?|sat(?:urday)?|sun(?:day)?";

  /* A bare day/month means the next time it comes round. */
  function resolveYear(month, day, today) {
    var t = keyToDate(today);
    var candidate = new Date(t.getFullYear(), month, day);
    if (candidate < new Date(t.getFullYear(), t.getMonth(), t.getDate())) {
      candidate = new Date(t.getFullYear() + 1, month, day);
    }
    return dayKey(candidate);
  }
  function nextWeekday(dow, today) {
    var t = keyToDate(today);
    var delta = (dow - t.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return shiftKey(today, delta);
  }
  /* The week runs Monday to Sunday. Nothing in the app had a week boundary
     before this — sinceLabel and the recap both use rolling seven-day windows
     — so there is no Sunday-first convention to contradict, and this matches
     the Mon-first order the habit picker already reads in. */
  function startOfWeek(key) {
    var d = keyToDate(key);
    return shiftKey(key, -((d.getDay() + 6) % 7));   /* Sun 0 -> 6, Mon 1 -> 0 */
  }
  function nextWeekStart(key) { return shiftKey(startOfWeek(key), 7); }
  function monthEnd(key) {
    var d = keyToDate(key);
    return dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  /* Calendar week, then calendar month. The cascade order matters: a week
     that runs past the end of the month keeps its own days, so a Thursday
     that happens to be the 2nd of next month is still "this week". */
  function bucketForDate(date, today) {
    var d = validDate(date);
    var t = validDate(today) || todayKey();
    if (!d || d <= t) return "today";      /* today, and anything already late */
    if (d < nextWeekStart(t)) return "this_week";
    if (d <= monthEnd(t)) return "this_month";
    return "future";
  }

  /* A date is the single source of truth for where a task sits. The manual
     bucket is only consulted when there is no date, so a stale bucket can
     never contradict one. Computed at read time, which is what lets a task
     drift Future -> This month -> This week -> Today on its own, with nothing
     to migrate and no nightly job. */
  function effectiveBucket(t, today) {
    if (!t) return "today";
    var d = validDate(t.dueDate);
    if (d) return bucketForDate(d, today);
    return BUCKETS.indexOf(t.bucket) >= 0 ? t.bucket : "today";
  }
  function isOverdue(t, today) {
    var d = validDate(t && t.dueDate);
    return !!d && d < today && isOpen(t);
  }
  /* "due yesterday" / "due Tuesday" / "due 3 Sep" — stated, never scolded. */
  function overdueLabel(t, today) {
    var d = validDate(t && t.dueDate);
    if (!d || d >= today) return "";
    return "due " + sinceLabel(d, today);
  }
  function tidy(text) {
    return String(text)
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*,+/g, ", ")
      .replace(/^[\s,;.:-]+/, "")
      .replace(/[\s,;.:-]+$/, "")
      .replace(/\b(?:at|on|in|by|for|from)\s*$/i, "")
      .replace(/[\s,;.:-]+$/, "")
      .trim();
  }

  function parseTaskLine(raw, today) {
    var line = String(raw == null ? "" : raw)
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) return null;
    var original = line;
    var found = {};

    /* notes: "add X to notes", "note: X", "(X)" */
    var m = line.match(/\b(?:add|put)\s+([^.]+?)\s+(?:in)?to\s+(?:the\s+)?notes?\b/i) ||
            line.match(/\bnotes?\s*[:-]\s*([^.]+)$/i);
    var notes = "";
    if (m) { notes = tidy(m[1]); line = line.replace(m[0], " "); found.notes = true; }

    /* time: 10am, 2.30pm, 10:00, at 14:30 */
    var time = null;
    m = line.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
    if (m) {
      var h = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) h += 12;
      time = (h < 10 ? "0" + h : h) + ":" + (m[2] || "00");
      line = line.replace(m[0], " "); found.time = true;
    } else {
      m = line.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (m) {
        time = (m[1].length === 1 ? "0" + m[1] : m[1]) + ":" + m[2];
        line = line.replace(m[0], " "); found.time = true;
      }
    }

    /* date */
    var date = null;
    m = line.match(new RegExp(
      "\\b(?:(?:" + DOW_RE + ")\\.?,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(" +
      MONTH_RE + ")\\.?(?:,?\\s+(\\d{4}))?\\b", "i"));
    if (m) {
      var mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
      date = m[3] ? dayKey(new Date(+m[3], mo, +m[1])) : resolveYear(mo, +m[1], today);
      line = line.replace(m[0], " "); found.date = true;
    }
    if (!date) {
      m = line.match(new RegExp("\\b(" + MONTH_RE + ")\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b", "i"));
      if (m) {
        var mo2 = MONTHS[m[1].toLowerCase().slice(0, 3)];
        date = m[3] ? dayKey(new Date(+m[3], mo2, +m[2])) : resolveYear(mo2, +m[2], today);
        line = line.replace(m[0], " "); found.date = true;
      }
    }
    if (!date) {
      m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (m) {
        var yr = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
        date = yr ? dayKey(new Date(yr, +m[2] - 1, +m[1])) : resolveYear(+m[2] - 1, +m[1], today);
        line = line.replace(m[0], " "); found.date = true;
      }
    }
    if (!date) {
      if (/\btomorrow\b/i.test(line)) { date = shiftKey(today, 1); line = line.replace(/\btomorrow\b/i, " "); found.date = true; }
      else if (/\b(today|tonight)\b/i.test(line)) { date = today; line = line.replace(/\b(today|tonight)\b/i, " "); found.date = true; }
      else {
        m = line.match(new RegExp("\\b(?:next\\s+)?(" + DOW_RE + ")\\b", "i"));
        if (m) {
          date = nextWeekday(DOWS[m[1].toLowerCase().slice(0, 3)], today);
          line = line.replace(m[0], " "); found.date = true;
        }
      }
    }

    /* importance — only explicit markers, never a bare adjective */
    var importance = "should";
    m = line.match(/\b(must[- ]?do|must|urgent|important)\b/i);
    if (m) { importance = "must"; line = line.replace(m[0], " "); found.importance = true; }
    else {
      m = line.match(/\b(nice to have|optional|if i get time)\b/i);
      if (m) { importance = "nice"; line = line.replace(m[0], " "); found.importance = true; }
    }

    /* bucket: an explicit phrase wins, otherwise the date decides */
    var bucket = null;
    m = line.match(/\b(this week|next week|this month|next month|someday|sometime)\b/i);
    if (m) {
      var phrase = m[1].toLowerCase();
      bucket = /week/.test(phrase) ? "this_week"
        : /month/.test(phrase) ? "this_month" : "future";
      line = line.replace(m[0], " "); found.bucket = true;
    }
    if (!bucket) bucket = date ? bucketForDate(date, today) : "today";

    /* leading imperatives */
    line = line.replace(/^\s*(?:add|remember to|remember|need to|must)\s+/i, " ");
    var title = tidy(line);
    if (!title) { title = tidy(original); found.fallback = true; }
    if (title && /^[a-z]/.test(title) && /^[A-Z]/.test(original)) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    return {
      title: title, dueDate: date, dueTime: time, notes: notes,
      importance: importance, bucket: bucket, found: found, source: original
    };
  }

  function parseBrainDump(text, today) {
    return String(text == null ? "" : text).split("\n")
      .map(function (l) { return parseTaskLine(l, today); })
      .filter(Boolean);
  }


  /* ---------- quotes ----------
     Calm and reflective by design. Sources are ones with well-documented
     attribution; the user can edit the whole list, so nothing here is fixed. */
  var DEFAULT_QUOTES = [
    { text: "Confine yourself to the present.", source: "Marcus Aurelius" },
    { text: "Very little is needed to make a happy life.", source: "Marcus Aurelius" },
    { text: "The soul becomes dyed with the colour of its thoughts.", source: "Marcus Aurelius" },
    { text: "Never let the future disturb you. You will meet it with the same weapons of reason which today arm you against the present.", source: "Marcus Aurelius" },
    { text: "We suffer more often in imagination than in reality.", source: "Seneca" },
    { text: "It is not that we have a short time to live, but that we waste much of it.", source: "Seneca" },
    { text: "Begin at once to live, and count each separate day as a separate life.", source: "Seneca" },
    { text: "He who is everywhere is nowhere.", source: "Seneca" },
    { text: "It is not things that disturb us, but our opinions about things.", source: "Epictetus" },
    { text: "No man is free who is not master of himself.", source: "Epictetus" },
    { text: "Nature does not hurry, yet everything is accomplished.", source: "Lao Tzu" },
    { text: "Muddy water, let stand, becomes clear.", source: "Lao Tzu" },
    { text: "A journey of a thousand miles begins beneath one's feet.", source: "Lao Tzu" },
    { text: "How we spend our days is, of course, how we spend our lives.", source: "Annie Dillard" },
    { text: "Be patient toward all that is unsolved in your heart.", source: "Rainer Maria Rilke" },
    { text: "Perhaps all the dragons in our lives are princesses who are only waiting to see us act, just once, with beauty and courage.", source: "Rainer Maria Rilke" },
    { text: "The impeded stream is the one that sings.", source: "Wendell Berry" },
    { text: "I go among trees and sit still.", source: "Wendell Berry" },
    { text: "It is not enough to be busy. The question is: what are we busy about?", source: "Henry David Thoreau" },
    { text: "I went to the woods because I wished to live deliberately.", source: "Henry David Thoreau" },
    { text: "Simplify, simplify.", source: "Henry David Thoreau" },
    { text: "The day is what you make it, so why not make it a good one?", source: "Steve Schulte" },
    { text: "My life has been full of terrible misfortunes, most of which never happened.", source: "Michel de Montaigne" },
    { text: "The greatest thing in the world is to know how to belong to oneself.", source: "Michel de Montaigne" },
    { text: "Sitting quietly, doing nothing, spring comes, and the grass grows by itself.", source: "Zen proverb" },
    { text: "Before enlightenment, chop wood, carry water. After enlightenment, chop wood, carry water.", source: "Zen proverb" },
    { text: "The old pond — a frog leaps in, the sound of water.", source: "Basho" },
    { text: "Life is really simple, but we insist on making it complicated.", source: "Confucius" },
    { text: "It does not matter how slowly you go so long as you do not stop.", source: "Confucius" },
    { text: "Tell me, what is it you plan to do with your one wild and precious life?", source: "Mary Oliver" }
  ];

  function normQuotes(v) {
    var list = (v && Array.isArray(v.list) ? v.list : [])
      .map(function (q) {
        if (!q) return null;
        var text = typeof q === "string" ? q : q.text;
        if (!text || !String(text).trim()) return null;
        return {
          id: (q && q.id) || uid(),
          text: String(text).trim(),
          source: q && q.source ? String(q.source).trim() : ""
        };
      }).filter(Boolean);
    return { list: list };
  }
  /* An empty list falls back to the built-ins rather than showing nothing. */
  function activeQuotes(stored) {
    var norm = normQuotes(stored);
    return norm.list.length ? norm.list : DEFAULT_QUOTES.map(function (q, i) {
      return { id: "d" + i, text: q.text, source: q.source, builtIn: true };
    });
  }
  /* Deterministic from the date, so it holds all day and turns at midnight. */
  function quoteForDay(list, dayKey) {
    if (!list || !list.length) return null;
    var n = daysBetween("2000-01-01", dayKey);
    return list[((n % list.length) + list.length) % list.length];
  }

  /* ---------- recap ----------
     Completed tasks are cleared at midnight, so the day's work is archived
     on the way out and Recap reads from there. */
  function blankRecap() { return { days: {} }; }
  function normRecap(v) {
    if (!v || typeof v !== "object" || !v.days || typeof v.days !== "object") return blankRecap();
    return { days: v.days };
  }
  function archiveCompleted(recap, items, dayKey) {
    var done = items.filter(function (t) { return !!t.completedAt; })
      .sort(function (a, b) { return a.completedAt - b.completedAt; })
      .map(function (t) {
        return { title: t.title, at: t.completedAt, importance: t.importance, bucket: t.bucket };
      });
    if (!done.length) return normRecap(recap);
    var days = {};
    var base = normRecap(recap).days;
    Object.keys(base).forEach(function (k) { days[k] = base[k]; });
    days[dayKey] = (days[dayKey] || []).concat(done);
    return { days: days };
  }
  function pruneRecap(recap, today, keep) {
    var limit = keep || 60, seen = {};
    for (var i = 0; i < limit; i++) seen[shiftKey(today, -i)] = true;
    var days = {}, base = normRecap(recap).days;
    Object.keys(base).forEach(function (k) { if (seen[k]) days[k] = base[k]; });
    return { days: days };
  }
  /* Newest first, today included live from the current task list. */
  function recapDays(recap, liveItems, today, span) {
    var base = normRecap(recap).days;
    var out = [];
    for (var i = 0; i < (span || 7); i++) {
      var key = shiftKey(today, -i);
      var rows = key === today
        ? completedInBucketAny(liveItems || [], today)
        : (base[key] || []).slice();
      if (rows.length) out.push({ date: key, items: rows });
    }
    return out;
  }
  function completedInBucketAny(items, today) {
    return items.filter(function (t) {
      return !!t.completedAt && msToKey(t.completedAt) === today;
    }).sort(function (a, b) { return a.completedAt - b.completedAt; })
      .map(function (t) {
        return { title: t.title, at: t.completedAt, importance: t.importance, bucket: t.bucket };
      });
  }

  /* ---------- shopping ---------- */
  function blankShopping() { return { items: [] }; }
  function normShopping(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.items)) return blankShopping();
    return {
      items: v.items.filter(function (i) { return i && i.name; }).map(function (i) {
        return {
          id: i.id || uid(),
          name: String(i.name),
          got: !!i.got,
          at: typeof i.at === "number" ? i.at : Date.now()
        };
      })
    };
  }


  /* ---------- shopping carts ----------
     One cart per shop. A cart's colour is copied from a saved shop at
     creation and is its own from then on: editing or deleting the shop
     never reaches back into carts already made. */
  function blankCarts() { return { carts: [], shops: [], lastSweptOn: null }; }

  function normHex(v) {
    if (typeof v !== "string") return null;
    var m = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return "#" + h.toLowerCase();
  }
  var CART_FALLBACK = "#dfd5c7";

  /* Text sitting on a user-chosen colour has to stay readable, so pick the
     ink from the colour's relative luminance rather than guessing. */
  function luminance(hex) {
    var h = normHex(hex) || CART_FALLBACK;
    var parts = [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map(function (p) {
      var c = parseInt(p, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }
  function contrastInk(hex) { return luminance(hex) > 0.45 ? "#3b352e" : "#fffcf7"; }

  function normItem(i) {
    if (!i) return null;
    var text = i.text != null ? i.text : i.name;      /* v1 shopping called it name */
    if (!text || !String(text).trim()) return null;
    var checked = i.checked !== undefined ? !!i.checked : !!i.got;
    return {
      id: i.id || uid(),
      text: String(text).trim(),
      checked: checked,
      /* A checked item with no timestamp gets today's, so an upgrade never
         sweeps something away the moment the app opens. */
      checkedAt: checked ? (typeof i.checkedAt === "number" ? i.checkedAt
        : (typeof i.at === "number" ? i.at : Date.now())) : null
    };
  }
  function normCart(c) {
    if (!c || !c.shop) return null;
    return {
      id: c.id || uid(),
      shop: String(c.shop).trim(),
      colour: normHex(c.colour) || CART_FALLBACK,
      items: (Array.isArray(c.items) ? c.items : []).map(normItem).filter(Boolean),
      createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now()
    };
  }
  function normShop(sh) {
    if (!sh || !sh.name || !String(sh.name).trim()) return null;
    return {
      id: sh.id || uid(),
      name: String(sh.name).trim(),
      colour: normHex(sh.colour) || CART_FALLBACK
    };
  }
  /* Accepts the old flat shopping list and folds it into one cart. */
  function normCarts(v, legacyShopping) {
    var out = blankCarts();
    if (v && typeof v === "object") {
      out.carts = (Array.isArray(v.carts) ? v.carts : []).map(normCart).filter(Boolean);
      out.shops = (Array.isArray(v.shops) ? v.shops : []).map(normShop).filter(Boolean);
      out.lastSweptOn = typeof v.lastSweptOn === "string" ? v.lastSweptOn : null;
    }
    if (!out.carts.length && legacyShopping && Array.isArray(legacyShopping.items)
        && legacyShopping.items.length) {
      var items = legacyShopping.items.map(normItem).filter(Boolean);
      if (items.length) {
        out.carts = [{ id: uid(), shop: "Shopping", colour: CART_FALLBACK,
                       items: items, createdAt: Date.now() }];
      }
    }
    return out;
  }

  /* Saving a shop while creating a one-off cart. Matching on name so ticking
     the box twice for the same shop does not leave two chips behind; an
     existing shop keeps its own colour, since changing it is a deliberate act
     done on the Shops screen. */
  function addShopIfNew(shops, name, colour) {
    var clean = String(name || "").trim();
    if (!clean) return shops;
    var exists = shops.some(function (sh) {
      return sh.name.toLowerCase() === clean.toLowerCase();
    });
    if (exists) return shops;
    return shops.concat([{ id: uid(), name: clean, colour: normHex(colour) || CART_FALLBACK }]);
  }

  function makeCart(shop, colour) {
    return { id: uid(), shop: String(shop).trim(),
             colour: normHex(colour) || CART_FALLBACK, items: [], createdAt: Date.now() };
  }
  function cartsNewestFirst(state) {
    return state.carts.slice().sort(function (a, b) {
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
    });
  }
  function shopsByName(state) {
    return state.shops.slice().sort(function (a, b) {
      var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }
  /* What a closed bubble shows: the first few things still to get. */
  function cartPreview(cart, n) {
    return cart.items.filter(function (i) { return !i.checked; }).slice(0, n || 5);
  }
  function cartOpenCount(cart) {
    return cart.items.filter(function (i) { return !i.checked; }).length;
  }

  /* Midnight sweep. Runs on open rather than on a timer, because a PWA gets
     no time to run while it is closed. Anything ticked on an earlier day
     goes; anything ticked today stays until tonight. */
  function sweepCarts(state, today) {
    if (!state) return blankCarts();
    if (state.lastSweptOn === today) return state;
    var changed = false;
    var carts = state.carts.map(function (c) {
      var kept = c.items.filter(function (i) {
        return !(i.checked && i.checkedAt && msToKey(i.checkedAt) < today);
      });
      if (kept.length === c.items.length) return c;
      changed = true;
      return { id: c.id, shop: c.shop, colour: c.colour, items: kept, createdAt: c.createdAt };
    });
    return { carts: changed ? carts : state.carts, shops: state.shops, lastSweptOn: today };
  }

  /* ---------- habits ----------
     A habit is a rule, not a task. Each morning the rules that match today
     mint task instances into `today`; the habit itself is never ticked off.
     The old 4-toggle habits app stored its dot history under `habits`; that
     key is retired and still carried untouched, so this model lives under
     `habitsv2` and cannot overwrite it. */
  var RECURRENCE = ["weekly", "monthly", "yearly", "dates"];

  function blankHabits() { return { habits: [], gen: {}, lastGenOn: null }; }

  function intsIn(v, lo, hi) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (n) {
      var i = typeof n === "number" ? n : parseInt(n, 10);
      if (!isFinite(i) || i < lo || i > hi || seen[i]) return;
      seen[i] = true; out.push(i);
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function datesIn(v) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (d) {
      var k = validDate(d);
      if (!k || seen[k]) return;
      seen[k] = true; out.push(k);
    });
    return out.sort();
  }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

  /* A slot is only worth keeping if it can ever fire. A weekly slot with no
     days, or a dates slot with no dates, would sit in the list looking
     scheduled and never produce anything, so it is dropped rather than kept
     as a silent no-op. */
  function normSlot(s) {
    if (!s || typeof s !== "object") return null;
    var rec = RECURRENCE.indexOf(s.recurrence) >= 0 ? s.recurrence : "weekly";
    var start = validTime(s.startTime);
    if (!start) return null;
    var end = validTime(s.endTime);
    if (end && end <= start) end = null;      /* an end before its start is not a duration */
    var out = {
      id: s.id || uid(), recurrence: rec, startTime: start, endTime: end,
      daysOfWeek: [], dayOfMonth: null, monthsOfYear: [], specificDates: []
    };
    if (rec === "weekly") {
      out.daysOfWeek = intsIn(s.daysOfWeek, 0, 6);
      if (!out.daysOfWeek.length) return null;
    } else if (rec === "monthly") {
      out.dayOfMonth = intsIn([s.dayOfMonth], 1, 31)[0] || null;
      if (!out.dayOfMonth) return null;
    } else if (rec === "yearly") {
      out.monthsOfYear = intsIn(s.monthsOfYear, 1, 12);
      out.dayOfMonth = intsIn([s.dayOfMonth], 1, 31)[0] || null;
      if (!out.monthsOfYear.length || !out.dayOfMonth) return null;
    } else {
      out.specificDates = datesIn(s.specificDates);
      if (!out.specificDates.length) return null;
    }
    return out;
  }

  function normHabit(hb) {
    if (!hb || !hb.name || !String(hb.name).trim()) return null;
    var slots = (Array.isArray(hb.schedule) ? hb.schedule : []).map(normSlot).filter(Boolean);
    if (!slots.length) return null;
    var created = typeof hb.createdAt === "number" ? hb.createdAt : Date.now();
    return {
      id: hb.id || uid(),
      name: String(hb.name).trim(),
      importance: IMPORTANCE.indexOf(hb.importance) >= 0 ? hb.importance : "should",
      active: hb.active === false ? false : true,
      schedule: slots,
      goalId: hb.goalId || null,
      createdAt: created
    };
  }
  function normHabits(v) {
    var out = blankHabits();
    if (!v || typeof v !== "object") return out;
    out.habits = (Array.isArray(v.habits) ? v.habits : []).map(normHabit).filter(Boolean);
    if (v.gen && typeof v.gen === "object") {
      Object.keys(v.gen).forEach(function (k) {
        if (validDate(v.gen[k])) out.gen[k] = v.gen[k];
      });
    }
    out.lastGenOn = typeof v.lastGenOn === "string" ? v.lastGenOn : null;
    return out;
  }

  function makeSlot(opts) {
    opts = opts || {};
    return normSlot({
      id: opts.id, recurrence: opts.recurrence || "weekly",
      daysOfWeek: opts.daysOfWeek, dayOfMonth: opts.dayOfMonth,
      monthsOfYear: opts.monthsOfYear, specificDates: opts.specificDates,
      startTime: opts.startTime, endTime: opts.endTime
    });
  }
  function makeHabit(name, opts) {
    opts = opts || {};
    return normHabit({
      id: opts.id, name: name, importance: opts.importance,
      active: opts.active, schedule: opts.schedule, goalId: opts.goalId,
      createdAt: typeof opts.now === "number" ? opts.now : Date.now()
    });
  }

  /* Does this slot fall on that day? A monthly slot asking for the 31st
     lands on the last day of a shorter month rather than skipping it — the
     intent is "the end of the month", not "nothing in February". */
  function slotMatches(slot, key) {
    if (!slot || !validDate(key)) return false;
    var d = keyToDate(key);
    if (slot.recurrence === "weekly") return slot.daysOfWeek.indexOf(d.getDay()) >= 0;
    if (slot.recurrence === "dates") return slot.specificDates.indexOf(key) >= 0;
    var last = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    var want = Math.min(slot.dayOfMonth, last);
    if (d.getDate() !== want) return false;
    if (slot.recurrence === "monthly") return true;
    return slot.monthsOfYear.indexOf(d.getMonth() + 1) >= 0;
  }
  /* Slots of one habit that fire on a given day, earliest first. A paused
     habit matches nothing; its schedule and history are left alone. */
  function habitSlotsOn(habit, key) {
    if (!habit || !habit.active) return [];
    return habit.schedule.filter(function (s) { return slotMatches(s, key); })
      .slice().sort(function (a, b) {
        if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
  }

  /* Days are stored 0-6 with Sunday first, which is how JavaScript counts,
     but a week reads Monday to Sunday — so "Sat/Sun", never "Sun/Sat". */
  function weekOrder(days) {
    return days.slice().sort(function (a, b) {
      return ((a + 6) % 7) - ((b + 6) % 7);
    });
  }
  /* "Mon/Tue/Thu 05:00" — one line per slot, in the app's 24-hour style. */
  function slotSummary(slot) {
    if (!slot) return "";
    var when;
    if (slot.recurrence === "weekly") {
      when = slot.daysOfWeek.length === 7 ? "Every day"
        : weekOrder(slot.daysOfWeek).map(function (n) { return WD3[n]; }).join("/");
    } else if (slot.recurrence === "monthly") {
      when = "Day " + slot.dayOfMonth + " monthly";
    } else if (slot.recurrence === "yearly") {
      when = slot.monthsOfYear.map(function (m) { return MO3[m - 1]; }).join("/") +
             " " + slot.dayOfMonth;
    } else {
      when = slot.specificDates.length +
             (slot.specificDates.length === 1 ? " date" : " dates");
    }
    var time = slot.startTime + (slot.endTime ? "–" + slot.endTime : "");
    return when + " " + time;
  }
  function habitSummary(habit) {
    if (!habit) return "";
    return habit.schedule.slice().sort(function (a, b) {
      if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    }).map(slotSummary).join(", ");
  }
  /* The next day a habit fires, looked ahead a year at most. Used for the
     quiet line under a habit that has nothing on today. */
  function nextHabitDay(habit, from) {
    if (!habit || !habit.active || !validDate(from)) return null;
    for (var i = 0; i <= 366; i++) {
      var key = shiftKey(from, i);
      if (habitSlotsOn(habit, key).length) return key;
    }
    return null;
  }

  function genKey(habitId, slotId) { return habitId + ":" + slotId; }

  /* Mint today's instances. The ledger in `gen` records that a slot has
     already been minted for a day, so deleting a generated task does not
     bring it straight back on the next open — the deletion sticks until the
     habit next comes round. Batch creation staggers createdAt for the same
     reason the brain dump does: same-millisecond tasks fall through to the
     random id tie-break and lose their order. */
  function generateHabitTasks(state, items, today, now) {
    var hs = normHabits(state);
    if (hs.lastGenOn === today) return { habits: hs, items: items, added: [] };
    var base = typeof now === "number" ? now : Date.now();
    var gen = {}, added = [], step = 0;
    Object.keys(hs.gen).forEach(function (k) { gen[k] = hs.gen[k]; });
    hs.habits.forEach(function (habit) {
      habitSlotsOn(habit, today).forEach(function (slot) {
        var key = genKey(habit.id, slot.id);
        if (gen[key] === today) return;
        gen[key] = today;
        var t = makeTask(habit.name, {
          bucket: "today", importance: habit.importance,
          dueDate: today, dueTime: slot.startTime,
          now: base + step, today: today
        });
        step += 1;
        t.habitId = habit.id;
        t.slotId = slot.id;
        t.genOn = today;
        t.endTime = slot.endTime;
        /* Set once on the habit; every instance it mints carries it. */
        t.goalId = habit.goalId || null;
        added.push(t);
      });
    });
    return {
      habits: { habits: hs.habits, gen: gen, lastGenOn: today },
      items: added.length ? items.concat(added) : items,
      added: added
    };
  }

  /* Yesterday's gym is not today's gym. An unfinished instance is dropped at
     the rollover rather than carried in, because a missed routine that piles
     up week on week turns the list into a scoreboard — which this app does
     not do. Today's instance is minted fresh if the habit runs today. */
  function isHabitTask(t) { return !!(t && t.habitId && t.genOn); }
  function dropStaleHabitTasks(items, today) {
    return items.filter(function (t) {
      return !(isHabitTask(t) && t.genOn < today && !t.completedAt);
    });
  }

  /* ---------- goals: momentum ----------
     A goal is not a checklist that fills up. It stays alight while the user
     keeps showing up and cools when they do not. Momentum is derived from the
     activity log and today's date and is never set by hand.

     Every number that shapes the feel of it lives here, so it can be retuned
     after a fortnight of living with it without hunting through the code. */
  var MOMENTUM = {
    max: 100,
    taskPoints: { must: 8, should: 6, nice: 4 },   /* the app's own priority field */
    habitPoints: 5,                                /* flat: recurring is the point */
    fullFor: 3,                                    /* 1st-3rd of a day at full value */
    halfFor: 3,                                    /* 4th-6th at half, rounded down */
    quarterMin: 1,                                 /* 7th onward at a quarter, never 0 */
    dayCeiling: 25,                                /* nothing banks a week in one sitting */
    graceDays: 1,                                  /* one quiet day costs nothing */
    decayPerDay: 4
  };
  var BANDS = [
    { id: "dormant", label: "Dormant", from: 0 },
    { id: "warm", label: "Warm", from: 20 },
    { id: "ember", label: "Ember", from: 50 },
    { id: "alight", label: "Alight", from: 80 }
  ];

  function blankGoals() { return { goals: [], activity: [] }; }

  function normGoal(g) {
    /* `title` is the old percentage-era field; read it so a goal made before
       the rewrite keeps its name instead of being dropped as junk. */
    var name = g && (g.name || g.title);
    if (!g || !name || !String(name).trim()) return null;
    var created = typeof g.createdAt === "number" ? g.createdAt : Date.now();
    return {
      id: g.id || uid(),
      name: String(name).trim(),
      description: g.description ? String(g.description).trim() : "",
      active: g.active === false ? false : true,
      createdAt: created,
      momentum: typeof g.momentum === "number"
        ? Math.max(0, Math.min(MOMENTUM.max, g.momentum)) : 0,
      momentumAsOf: validDate(g.momentumAsOf) || shiftKey(msToKey(created), -1)
    };
  }
  function normActivity(a) {
    if (!a || !a.goalId || !a.sourceId) return null;
    if (typeof a.completedAt !== "number") return null;
    return {
      id: a.id || uid(),
      goalId: String(a.goalId),
      sourceType: a.sourceType === "habit" ? "habit" : "task",
      sourceId: String(a.sourceId),
      title: a.title ? String(a.title) : "",
      completedAt: a.completedAt,
      points: typeof a.points === "number" && a.points >= 0 ? Math.floor(a.points) : 0,
      /* What the row was worth before the day's ladder and ceiling were
         applied. Without it a reload would recalculate an undo from the
         already-capped value and quietly shrink the rest of the day. */
      base: typeof a.base === "number" && a.base >= 0 ? Math.floor(a.base)
        : (typeof a.points === "number" ? Math.floor(a.points) : 0)
    };
  }
  function normGoals(v) {
    var out = blankGoals();
    if (!v || typeof v !== "object") return out;
    out.goals = (Array.isArray(v.goals) ? v.goals : []).map(normGoal).filter(Boolean);
    out.activity = (Array.isArray(v.activity) ? v.activity : [])
      .map(normActivity).filter(Boolean)
      .sort(function (a, b) {
        if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
    return out;
  }
  function makeGoal(name, opts) {
    opts = opts || {};
    var now = typeof opts.now === "number" ? opts.now : Date.now();
    return normGoal({
      id: opts.id, name: name, description: opts.description,
      active: opts.active, createdAt: now,
      momentum: 0, momentumAsOf: shiftKey(msToKey(now), -1)
    });
  }

  /* ---------- points ----------
     A heavy day is rewarded, but the ladder stops it banking a week's credit
     at once: three at full, three at half, the rest at a quarter, and nothing
     past the day's ceiling. */
  function basePoints(t) {
    if (isHabitTask(t)) return MOMENTUM.habitPoints;
    var p = MOMENTUM.taskPoints[t.importance];
    return typeof p === "number" ? p : MOMENTUM.taskPoints.should;
  }
  function tierValue(base, index) {
    if (index < MOMENTUM.fullFor) return base;
    if (index < MOMENTUM.fullFor + MOMENTUM.halfFor) return Math.floor(base / 2);
    return Math.max(MOMENTUM.quarterMin, Math.floor(base / 4));
  }
  /* Re-walks one goal's day in completion order and reassigns every row's
     points. Called after an undo, because removing the second completion of a
     day changes what the fifth was worth. */
  function repointDay(activity, goalId, day) {
    var sameDay = activity.filter(function (a) {
      return a.goalId === goalId && msToKey(a.completedAt) === day;
    }).sort(function (a, b) {
      if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    var byId = {}, spent = 0;
    sameDay.forEach(function (a, i) {
      var want = tierValue(a.base || a.points || 0, i);
      byId[a.id] = Math.max(0, Math.min(want, MOMENTUM.dayCeiling - spent));
      spent += byId[a.id];
    });
    return activity.map(function (a) {
      return byId[a.id] === undefined ? a
        : { id: a.id, goalId: a.goalId, sourceType: a.sourceType, sourceId: a.sourceId,
            title: a.title, completedAt: a.completedAt, points: byId[a.id], base: a.base };
    });
  }
  /* A completion of something carrying a goalId. `base` rides along so an undo
     elsewhere in the day can recalculate this row's share honestly. */
  function addActivity(state, goal, task, nowMs) {
    var st = normGoals(state);
    if (!goal || !goal.active) return st;
    var at = typeof nowMs === "number" ? nowMs : (task.completedAt || Date.now());
    if (at < goal.createdAt) return st;    /* older than the goal: not its to claim */
    var row = {
      id: uid(), goalId: goal.id,
      sourceType: isHabitTask(task) ? "habit" : "task",
      sourceId: isHabitTask(task) ? habitInstanceKey(task) : task.id,
      title: String(task.title || ""),
      completedAt: at, points: 0, base: basePoints(task)
    };
    var list = repointDay(st.activity.concat([row]), goal.id, msToKey(at));
    return { goals: st.goals, activity: list };
  }
  function habitInstanceKey(t) { return t.habitId + ":" + t.slotId + ":" + t.genOn; }
  /* Undo: the row goes and the rest of its day is recalculated. No orphans. */
  function removeActivity(state, task) {
    var st = normGoals(state);
    var key = isHabitTask(task) ? habitInstanceKey(task) : task.id;
    var hit = st.activity.filter(function (a) { return a.sourceId === key; });
    if (!hit.length) return st;
    var list = st.activity.filter(function (a) { return a.sourceId !== key; });
    hit.forEach(function (a) {
      list = repointDay(list, a.goalId, msToKey(a.completedAt));
    });
    return { goals: st.goals, activity: list };
  }

  /* ---------- momentum ---------- */
  function pointsOnDay(activity, goalId, day) {
    return activity.reduce(function (n, a) {
      return a.goalId === goalId && msToKey(a.completedAt) === day ? n + a.points : n;
    }, 0);
  }
  function lastActiveDayOnOrBefore(activity, goalId, day) {
    var best = null;
    activity.forEach(function (a) {
      if (a.goalId !== goalId || a.points <= 0) return;
      var k = msToKey(a.completedAt);
      if (k <= day && (!best || k > best)) best = k;
    });
    return best;
  }
  /* Rolls a goal's value forward one day at a time. A quiet run is measured
     from the last day that actually earned something, so no running tally has
     to be carried in storage — the log already knows. */
  function rollMomentum(value, goal, activity, from, to, today) {
    var v = value, day = from;
    var guard = 0;
    while (day <= to && guard++ < 4000) {
      var pts = pointsOnDay(activity, goal.id, day);
      if (pts > 0) {
        v = Math.min(MOMENTUM.max, v + pts);
      } else if (day !== today) {
        /* Only a closed day can be a quiet day. Today is still in progress, so
           it never decays — the cooling shows up the following morning rather
           than the moment midnight passes. Keyed on the real today, not on the
           end of this roll, or settling to yesterday would skip yesterday. */
        var last = lastActiveDayOnOrBefore(activity, goal.id, day) || msToKey(goal.createdAt);
        var quiet = daysBetween(last, day);
        if (quiet > MOMENTUM.graceDays) v = Math.max(0, v - MOMENTUM.decayPerDay);
      }
      if (day === to) break;
      day = shiftKey(day, 1);
    }
    return Math.max(0, Math.min(MOMENTUM.max, v));
  }
  /* What the goal reads right now: the cached checkpoint rolled forward to
     today. A paused goal holds whatever it had — it neither earns nor cools. */
  function goalMomentum(goal, activity, today) {
    if (!goal) return 0;
    if (!goal.active) return goal.momentum;
    var from = validDate(goal.momentumAsOf) || shiftKey(msToKey(goal.createdAt), -1);
    if (from >= today) return goal.momentum;
    return rollMomentum(goal.momentum, goal, activity || [], shiftKey(from, 1), today, today);
  }
  /* Settle the cache to the end of yesterday, so the work each day is
     proportional to days elapsed rather than to the whole history. Today is
     deliberately left unsettled: it is still earning. */
  function settleGoal(goal, activity, today) {
    if (!goal || !goal.active) return goal;
    var yesterday = shiftKey(today, -1);
    var from = validDate(goal.momentumAsOf) || shiftKey(msToKey(goal.createdAt), -1);
    if (from >= yesterday) return goal;
    var v = rollMomentum(goal.momentum, goal, activity || [], shiftKey(from, 1), yesterday, today);
    return {
      id: goal.id, name: goal.name, description: goal.description,
      active: goal.active, createdAt: goal.createdAt,
      momentum: v, momentumAsOf: yesterday
    };
  }
  function settleGoals(state, today) {
    var st = normGoals(state);
    var changed = false;
    var goals = st.goals.map(function (g) {
      var next = settleGoal(g, st.activity, today);
      if (next !== g) changed = true;
      return next;
    });
    return changed ? { goals: goals, activity: st.activity } : st;
  }

  function momentumBand(n) {
    var out = BANDS[0];
    BANDS.forEach(function (b) { if (n >= b.from) out = b; });
    return out;
  }
  /* One plain line. It says what is happening and nothing about what it means
     — a cooling goal is cooling, never neglected, slipping or broken. */
  function momentumLine(goal, activity, today) {
    if (!goal.active) return "Paused";
    var band = momentumBand(goalMomentum(goal, activity, today));
    var last = lastActiveDayOnOrBefore(activity || [], goal.id, today);
    if (!last) return band.label + " — nothing logged yet";
    if (last === today) {
      var run = 1, day = today;
      while (lastActiveDayOnOrBefore(activity, goal.id, shiftKey(day, -1)) === shiftKey(day, -1)) {
        day = shiftKey(day, -1); run += 1;
        if (run > 400) break;
      }
      return band.label + " — " + (run === 1 ? "active today" : run + " days running");
    }
    return band.label + " — last activity " + sinceLabel(last, today);
  }

  /* The record: everything done toward a goal, newest first, grouped by day.
     Paged, because it is the part that grows without limit. */
  function goalRecord(activity, goalId, offset, limit) {
    var rows = (activity || []).filter(function (a) { return a.goalId === goalId; })
      .slice().sort(function (a, b) {
        if (a.completedAt !== b.completedAt) return b.completedAt - a.completedAt;
        return a.id < b.id ? 1 : -1;
      });
    var page = rows.slice(offset || 0, (offset || 0) + (limit || 30));
    var days = [], byDay = {};
    page.forEach(function (a) {
      var k = msToKey(a.completedAt);
      if (!byDay[k]) { byDay[k] = { day: k, items: [] }; days.push(byDay[k]); }
      byDay[k].items.push(a);
    });
    return { days: days, total: rows.length, more: rows.length > (offset || 0) + page.length };
  }
  /* Liveliest first, so the thread being kept alight is the one at the top. */
  function goalsByMomentum(state, today) {
    var st = normGoals(state);
    var live = st.goals.filter(function (g) { return g.active; }).slice().sort(function (a, b) {
      var ma = goalMomentum(a, st.activity, today), mb = goalMomentum(b, st.activity, today);
      if (ma !== mb) return mb - ma;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : 1;
    });
    var paused = st.goals.filter(function (g) { return !g.active; }).slice().sort(function (a, b) {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : 1;
    });
    return { active: live, paused: paused };
  }

  /* ---------- streaks ----------
     A true streak, asked for by name: it counts consecutive days fed, it
     warns while the day is running out, and it goes back to nothing when a
     day is missed. This is deliberate loss-aversion and it is the one place
     in the app that works that way — the recap prose and the boost block are
     kept clear of it on purpose. */
  function activeDaysDesc(activity, goalId) {
    var seen = {};
    (activity || []).forEach(function (a) {
      if (a.goalId === goalId && a.points >= 0) seen[msToKey(a.completedAt)] = true;
    });
    return Object.keys(seen).sort().reverse();
  }
  /* Alive while today or yesterday has been fed. Two clear days and it is
     gone: there is no partial credit and nothing is carried over. */
  function goalStreak(goal, activity, today, nowMin) {
    var days = activeDaysDesc(activity, goal ? goal.id : null);
    var yesterday = shiftKey(today, -1);
    var out = { days: 0, alive: false, fedToday: false, atRisk: false, hoursLeft: 0 };
    if (!days.length) return out;
    var head = days[0];
    if (head !== today && head !== yesterday) return out;   /* broken, back to nothing */
    var run = 1, cursor = head;
    for (var i = 1; i < days.length; i++) {
      if (days[i] !== shiftKey(cursor, -1)) break;
      cursor = days[i]; run += 1;
    }
    out.days = run;
    out.alive = true;
    out.fedToday = head === today;
    out.atRisk = !out.fedToday;
    if (out.atRisk) {
      var mins = typeof nowMin === "number" ? nowMin : 0;
      out.hoursLeft = Math.max(0, Math.ceil((24 * 60 - mins) / 60));
    }
    return out;
  }
  /* "9 days" / "9 days · 5 hours left". Nothing is said once it has gone. */
  function streakLabel(st) {
    if (!st.alive || st.days < 1) return "";
    var base = st.days + (st.days === 1 ? " day" : " days");
    if (!st.atRisk) return base;
    return base + " · " + st.hoursLeft +
      (st.hoursLeft === 1 ? " hour left" : " hours left");
  }

  /* ---------- when something happened ---------- */
  function whenLabel(ms, today) {
    var key = msToKey(ms);
    var n = daysBetween(key, today);
    if (n === 0) {
      var h24 = new Date(ms).getHours();
      if (h24 < 12) return "this morning";
      if (h24 < 17) return "this afternoon";
      return "this evening";
    }
    if (n === 1) return "yesterday";
    if (n < 7) return WD_FULL[keyToDate(key).getDay()];
    var d = keyToDate(key);
    return d.getDate() + " " + MO3[d.getMonth()];
  }
  /* The five most recent rows, hoisted above the full record. `normGoals`
     keeps the log sorted oldest-first, so this walks back from the end and
     stops as soon as it has enough rather than reading the whole history. */
  function recentActivity(activity, goalId, limit) {
    var want = limit || 5, out = [], list = activity || [];
    for (var i = list.length - 1; i >= 0 && out.length < want; i--) {
      if (list[i].goalId === goalId) out.push(list[i]);
    }
    return out;
  }
  /* Today's rows only, for the recap. Same trick: walk back and stop the
     moment the log drops below today rather than filtering everything. */
  function activityOn(activity, day) {
    var out = [], list = activity || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var k = msToKey(list[i].completedAt);
      if (k < day) break;
      if (k === day) out.push(list[i]);
    }
    return out.reverse();
  }

  /* ---------- what else is already on this goal ----------
     Only things already linked and not yet done. Never an invitation to make
     more work, and it says nothing about what finishing one would do to the
     momentum — the block is an offer, not a lever. */
  function goalBoosts(goalId, items, today, limit) {
    var mine = (items || []).filter(function (t) {
      return t.goalId === goalId && !t.completedAt;
    });
    var todayHabit = mine.filter(function (t) {
      return isHabitTask(t) && t.genOn === today;
    }).sort(function (a, b) {
      var at = validTime(a.dueTime) || "99:99", bt = validTime(b.dueTime) || "99:99";
      if (at !== bt) return at < bt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    var rest = mine.filter(function (t) { return !isHabitTask(t); })
      .sort(function (a, b) {
        var ad = validDate(a.dueDate) || "9999-99-99", bd = validDate(b.dueDate) || "9999-99-99";
        if (ad !== bd) return ad < bd ? -1 : 1;
        var ia = impRank(a), ib = impRank(b);
        if (ia !== ib) return ia - ib;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : 1;
      });
    return todayHabit.concat(rest).slice(0, limit || 3);
  }

  /* ---------- the recap paragraph ----------
     Prose, not a report. Only goals that gained something today appear; a
     quiet goal is simply absent, and its absence is not a message. Built from
     templates picked deterministically from the date, so the wording moves
     day to day but never changes under you on a re-read. */
  /* Each variant is a whole clause, so nothing has to be glued together at
     runtime — that is where prose templates usually come apart. */
  var PROSE = {
    first: [
      "{goal} had a good day \u2014 you got {what} done.",
      "{goal} moved along, with {what} seen to.",
      "A bit of ground on {goal}: {what} done.",
      "{goal} came forward \u2014 {what} off the list.",
      "{goal} got some attention, and {what} with it."
    ],
    also: [
      "{goal} picked up too, with {what}.",
      "{goal} had a look-in as well \u2014 {what}.",
      "There was {what} on {goal} besides.",
      "{goal} got a turn too, with {what}."
    ],
    streak: [
      "That is {n} days in a row now.",
      "{n} days running.",
      "That makes {n} days on the trot.",
      "{n} days without a gap."
    ],
    band: [
      "It is properly {band} now.",
      "That has it sitting {band}.",
      "It reads {band} after that.",
      "Which leaves it {band}."
    ],
    rest: [
      "A couple of the others moved as well.",
      "The rest had their moments too.",
      "Other things ticked over besides."
    ]
  };
  function pick(list, seedKey, salt) {
    var n = daysBetween("2000-01-01", seedKey) + (salt || 0);
    return list[((n % list.length) + list.length) % list.length];
  }
  /* Titles are the user's own words and are left alone, except for a leading
     article, which reads wrong in the middle of a sentence. Only "The", "A"
     and "An" are touched — anything else might be a name. */
  function inSentence(title) {
    var m = String(title).match(/^(The|A|An)(\s)/);
    return m ? m[1].toLowerCase() + title.slice(m[1].length) : String(title);
  }
  function andList(names) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }
  /* Whether a goal moved up a band over the course of the day. A drop is
     never reported — silence is the whole treatment for a quiet goal. */
  function bandRose(goal, activity, today) {
    var end = momentumBand(goalMomentum(goal, activity, today));
    var without = (activity || []).filter(function (a) {
      return !(a.goalId === goal.id && msToKey(a.completedAt) === today);
    });
    var start = momentumBand(goalMomentum(goal, without, today));
    return end.from > start.from ? end : null;
  }
  function recapGoalProse(goalsState, today, maxGoals) {
    var st = normGoals(goalsState);
    var byGoal = {};
    activityOn(st.activity, today).forEach(function (a) {
      if (!byGoal[a.goalId]) byGoal[a.goalId] = [];
      byGoal[a.goalId].push(a);
    });
    var fed = st.goals.filter(function (g) { return (byGoal[g.id] || []).length; })
      .sort(function (a, b) {
        var na = byGoal[a.id].length, nb = byGoal[b.id].length;
        if (na !== nb) return nb - na;
        return a.createdAt - b.createdAt;
      });
    if (!fed.length) return "";      /* nothing fed a goal: the section is absent */

    var shown = fed.slice(0, maxGoals || 3);
    var out = [];
    shown.forEach(function (g, i) {
      var names = byGoal[g.id].slice().sort(function (a, b) {
        return a.completedAt - b.completedAt;
      }).map(function (a) { return inSentence(a.title); }).filter(function (v, j, arr) {
        return arr.indexOf(v) === j;
      });
      var what = andList(names);
      out.push(pick(i === 0 ? PROSE.first : PROSE.also, today, i)
        .replace("{goal}", g.name).replace("{what}", what));
      /* Only the lead goal earns the extra clauses; past that it gets wordy. */
      if (i === 0) {
        var st2 = goalStreak(g, st.activity, today, 0);
        if (st2.alive && st2.days >= 2) {
          out.push(pick(PROSE.streak, today, i).replace("{n}", QD_word(st2.days)));
        }
        var rose = bandRose(g, st.activity, today);
        /* Offset so the streak and band clauses do not land on the same
           index and end up rhyming with each other. */
        if (rose) out.push(pick(PROSE.band, today, i + 7).replace("{band}", rose.label.toLowerCase()));
      }
    });
    if (fed.length > shown.length) out.push(pick(PROSE.rest, today, 0));
    return out.join(" ");
  }
  /* Small counts read better as words in a sentence. */
  function QD_word(n) { return n <= 10 ? numberWord(n) : String(n); }

  /* ---------- the morning nudge (device side) ----------
     What the app remembers about the nudge. The decision to send lives on the
     server; this is only what the settings panel shows and what gets posted. */
  function blankNudge() {
    var tz = "UTC";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
    return {
      enabled: false, time: "07:00", days: [0, 1, 2, 3, 4, 5, 6],
      timezone: tz, endpoint: null, lastPingedOn: null
    };
  }
  function normNudge(v) {
    var out = blankNudge();
    if (!v || typeof v !== "object") return out;
    out.enabled = v.enabled === true;
    out.time = validTime(v.time) || out.time;
    var seen = {}, days = [];
    (Array.isArray(v.days) ? v.days : []).forEach(function (d) {
      var n = typeof d === "number" ? d : parseInt(d, 10);
      if (!isFinite(n) || n < 0 || n > 6 || seen[n]) return;
      seen[n] = true; days.push(n);
    });
    out.days = days.sort(function (a, b) { return a - b; });
    if (typeof v.timezone === "string" && v.timezone) out.timezone = v.timezone;
    out.endpoint = typeof v.endpoint === "string" ? v.endpoint : null;
    out.lastPingedOn = validDate(v.lastPingedOn);
    return out;
  }
  /* "Weekdays only" and "Every day", so the common two are one tap. */
  var WEEKDAYS = [1, 2, 3, 4, 5];
  var EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
  function sameDays(a, b) {
    return a.length === b.length && a.every(function (d, i) { return d === b[i]; });
  }
  /* A nudge with no days chosen would be silently dead, so it is not allowed
     to be on with an empty week — the panel says so rather than lying. */
  function nudgeReady(n) {
    return !!(n && n.enabled && n.days.length && validTime(n.time));
  }


  /* ---------- calendar export ----------
     A static site has no push server, so a reminder is a real calendar event
     with a 30-minute alarm. Floating local time: 12:30 means 12:30 wherever
     the phone is. */
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function icsEscape(v) {
    return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
      .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function icsFold(line) {
    if (line.length <= 75) return line;
    var out = line.slice(0, 75), rest = line.slice(75);
    while (rest.length > 74) { out += "\r\n " + rest.slice(0, 74); rest = rest.slice(74); }
    return out + "\r\n " + rest;
  }
  function buildICS(task, today, nowMs) {
    var time = validTime(task.dueTime);
    if (!time) return null;
    var date = validDate(task.dueDate) || today;
    var d = new Date(typeof nowMs === "number" ? nowMs : Date.now());
    var stamp = d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" +
                pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quiet Desk//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + task.id + "@quietdesk",
      "DTSTAMP:" + stamp,
      "DTSTART:" + date.replace(/-/g, "") + "T" + time.replace(":", "") + "00",
      "DURATION:PT30M",
      "SUMMARY:" + icsEscape(task.title)
    ];
    if (task.notes) lines.push("DESCRIPTION:" + icsEscape(task.notes));
    lines = lines.concat([
      "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY",
      "DESCRIPTION:" + icsEscape(task.title),
      "END:VALARM", "END:VEVENT", "END:VCALENDAR"
    ]);
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }

  function allDoneLine(items, today) {
    var hadAny = items.some(function (t) {
      return effectiveBucket(t, today) === "today" &&
        t.completedAt && msToKey(t.completedAt) === today;
    });
    return hadAny ? "Everything on today's list is done." : "Nothing on today's list.";
  }

  return {
    BUCKETS: BUCKETS, BUCKET_LABEL: BUCKET_LABEL,
    IMPORTANCE: IMPORTANCE, IMPORTANCE_LABEL: IMPORTANCE_LABEL,
    dayKey: dayKey, todayKey: todayKey, keyToDate: keyToDate, shiftKey: shiftKey,
    daysBetween: daysBetween, msToKey: msToKey, sinceLabel: sinceLabel,
    numberWord: numberWord, uid: uid,
    validDate: validDate, validTime: validTime,
    dueLabel: dueLabel, dueLabelLong: dueLabelLong, addedLabel: addedLabel,
    makeTask: makeTask, normTask: normTask, migrate: migrate, rollDay: rollDay,
    applyPatch: applyPatch,
    isOpen: isOpen, isCarryIn: isCarryIn, compareToday: compareToday,
    effectiveBucket: effectiveBucket, isOverdue: isOverdue, overdueLabel: overdueLabel,
    startOfWeek: startOfWeek, nextWeekStart: nextWeekStart, monthEnd: monthEnd,
    rankToday: rankToday, inBucket: inBucket,
    completedInBucket: completedInBucket,
    pickSuggestions: pickSuggestions, pickStale: pickStale,
    isFixedToday: isFixedToday, fixedPoints: fixedPoints, flexibleToday: flexibleToday,
    LEAD_MINUTES: LEAD_MINUTES, minutesOfTime: minutesOfTime,
    todayBand: todayBand, isWaiting: isWaiting,
    planLine: planLine, buildICS: buildICS,
    parseTaskLine: parseTaskLine, parseBrainDump: parseBrainDump,
    DEFAULT_QUOTES: DEFAULT_QUOTES, normQuotes: normQuotes, activeQuotes: activeQuotes,
    quoteForDay: quoteForDay,
    blankRecap: blankRecap, normRecap: normRecap, archiveCompleted: archiveCompleted,
    pruneRecap: pruneRecap, recapDays: recapDays,
    blankShopping: blankShopping, normShopping: normShopping,
    blankCarts: blankCarts, normCarts: normCarts, normHex: normHex,
    contrastInk: contrastInk, luminance: luminance, CART_FALLBACK: CART_FALLBACK,
    makeCart: makeCart, normShop: normShop, addShopIfNew: addShopIfNew,
    cartsNewestFirst: cartsNewestFirst,
    shopsByName: shopsByName, cartPreview: cartPreview, cartOpenCount: cartOpenCount,
    sweepCarts: sweepCarts,
    MOMENTUM: MOMENTUM, BANDS: BANDS,
    blankGoals: blankGoals, normGoals: normGoals, normGoal: normGoal, makeGoal: makeGoal,
    basePoints: basePoints, tierValue: tierValue, repointDay: repointDay,
    addActivity: addActivity, removeActivity: removeActivity,
    habitInstanceKey: habitInstanceKey, pointsOnDay: pointsOnDay,
    goalMomentum: goalMomentum, settleGoal: settleGoal, settleGoals: settleGoals,
    momentumBand: momentumBand, momentumLine: momentumLine,
    goalRecord: goalRecord, goalsByMomentum: goalsByMomentum,
    blankNudge: blankNudge, normNudge: normNudge, nudgeReady: nudgeReady,
    WEEKDAYS: WEEKDAYS, EVERY_DAY: EVERY_DAY, sameDays: sameDays,
    goalStreak: goalStreak, streakLabel: streakLabel, activeDaysDesc: activeDaysDesc,
    whenLabel: whenLabel, recentActivity: recentActivity, activityOn: activityOn,
    goalBoosts: goalBoosts,
    recapGoalProse: recapGoalProse, bandRose: bandRose, inSentence: inSentence,
    RECURRENCE: RECURRENCE, blankHabits: blankHabits, normHabits: normHabits,
    normHabit: normHabit, normSlot: normSlot, makeHabit: makeHabit, makeSlot: makeSlot,
    slotMatches: slotMatches, habitSlotsOn: habitSlotsOn,
    slotSummary: slotSummary, habitSummary: habitSummary, weekOrder: weekOrder, nextHabitDay: nextHabitDay,
    genKey: genKey, generateHabitTasks: generateHabitTasks,
    isHabitTask: isHabitTask, dropStaleHabitTasks: dropStaleHabitTasks,
    timeAnchor: timeAnchor,
    bucketForDate: bucketForDate,
    greetingLine: greetingLine, startHere: startHere, allDoneLine: allDoneLine
  };
});
