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
      dueTime: validTime(opts.dueTime)
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
      dueTime: validTime(t.dueTime)
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
    if (changes.bucket && changes.bucket !== task.bucket) {
      next.notTodayOn = null;
      next.firstTodayOn = changes.bucket === "today" ? today : null;
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
      items: state.items.filter(function (t) { return !t.completedAt; }),
      doneYesterday: done.length,
      lastRollOn: today
    };
  }

  /* ---------- ranking ---------- */
  function isOpen(t) { return !t.completedAt; }
  function isCarryIn(t, today) {
    return t.bucket === "today" && isOpen(t) && !!t.firstTodayOn && t.firstTodayOn < today;
  }
  function impRank(t) {
    var r = IMP_ORDER[t.importance];
    return r === undefined ? 1 : r;
  }
  /* Deterministic: every comparison ends in a total order, so the list never
     reshuffles between reloads on the same day. */
  function compareToday(today) {
    return function (a, b) {
      var ca = isCarryIn(a, today), cb = isCarryIn(b, today);
      if (ca !== cb) return ca ? -1 : 1;
      if (ca && cb && a.firstTodayOn !== b.firstTodayOn) return a.firstTodayOn < b.firstTodayOn ? -1 : 1;
      var ia = impRank(a), ib = impRank(b);
      if (ia !== ib) return ia - ib;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    };
  }
  function rankToday(items, today) {
    return items.filter(function (t) { return t.bucket === "today" && isOpen(t); })
                .slice().sort(compareToday(today));
  }
  /* Tasks ticked off today, in the order they were ticked. They stay on
     screen, struck through, until the midnight rollover clears them — a tap
     is easy to make by accident and must be easy to take back. */
  function completedInBucket(items, bucket, today) {
    return items.filter(function (t) {
      return t.bucket === bucket && !!t.completedAt && msToKey(t.completedAt) === today;
    }).slice().sort(function (a, b) {
      if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }

  function inBucket(items, bucket) {
    return items.filter(function (t) { return t.bucket === bucket && isOpen(t); })
      .slice().sort(function (a, b) {
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
    return t.bucket === "today" && isOpen(t) && !!validTime(t.dueTime) &&
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
      return t.bucket === "today" && isOpen(t) && !isFixedToday(t, today);
    }).slice().sort(compareToday(today));
  }

  /* ---------- suggestions ---------- */
  /* Tasks dated today but filed elsewhere. Surfaced every morning regardless
     of how full today is — a dated thing is a fact about the day, not filler.
     Never moved automatically; the user accepts them. */
  function pickAnchored(items, today) {
    return items.filter(function (t) {
      return t.bucket !== "today" && isOpen(t) &&
        t.dueDate === today && t.notTodayOn !== today;
    }).slice().sort(function (a, b) {
      var at = validTime(a.dueTime), bt = validTime(b.dueTime);
      if (at && bt && at !== bt) return at < bt ? -1 : 1;
      if (at && !bt) return -1;
      if (bt && !at) return 1;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }
  function pickSuggestions(items, today) {
    var open = rankToday(items, today);
    if (open.length >= 3) return [];
    function from(bucket) {
      var pool = items.filter(function (t) {
        return t.bucket === bucket && isOpen(t) && t.notTodayOn !== today &&
          t.dueDate !== today;   /* dated today: shown as an anchor instead */
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
      if (t.bucket !== "this_week" || !isOpen(t)) return false;
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
  function bucketForDate(date, today) {
    var n = daysBetween(today, date);
    if (n <= 0) return "today";
    if (n <= 7) return "this_week";
    if (n <= 31) return "this_month";
    return "future";
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
      return t.bucket === "today" && t.completedAt && msToKey(t.completedAt) === today;
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
    rankToday: rankToday, inBucket: inBucket,
    completedInBucket: completedInBucket,
    pickSuggestions: pickSuggestions, pickStale: pickStale,
    isFixedToday: isFixedToday, fixedPoints: fixedPoints, flexibleToday: flexibleToday,
    pickAnchored: pickAnchored, planLine: planLine, buildICS: buildICS,
    parseTaskLine: parseTaskLine, parseBrainDump: parseBrainDump,
    DEFAULT_QUOTES: DEFAULT_QUOTES, normQuotes: normQuotes, activeQuotes: activeQuotes,
    quoteForDay: quoteForDay,
    blankRecap: blankRecap, normRecap: normRecap, archiveCompleted: archiveCompleted,
    pruneRecap: pruneRecap, recapDays: recapDays,
    blankShopping: blankShopping, normShopping: normShopping,
    bucketForDate: bucketForDate,
    greetingLine: greetingLine, startHere: startHere, allDoneLine: allDoneLine
  };
});
