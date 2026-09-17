/* When the morning nudge should fire. Pure: no storage, no network, no crypto,
   so the whole decision can be tested without a push service.
   The server knows only the subscription, a time, some days, a timezone and
   two dates. It never sees a task, a habit, a goal or a shopping list. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Nudge = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WINDOW_MINUTES = 15;   /* must match the cron interval */

  /* Calm, interchangeable, and knowing nothing about the day. The server
     cannot see the tasks, so there is nothing to count and nothing to chase. */
  var LINES = [
    "Your day is ready.",
    "Good morning — here's today.",
    "A fresh page for today.",
    "Today is waiting whenever you are.",
    "Morning. Today's list is set."
  ];

  function validTime(v) {
    return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  }
  function validDate(v) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  function minutesOf(hhmm) {
    return (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5));
  }

  function normRecord(v) {
    if (!v || typeof v !== "object" || !v.subscription || !v.subscription.endpoint) return null;
    var days = Array.isArray(v.days) ? v.days : [];
    var seen = {}, clean = [];
    days.forEach(function (d) {
      var n = typeof d === "number" ? d : parseInt(d, 10);
      if (!isFinite(n) || n < 0 || n > 6 || seen[n]) return;
      seen[n] = true; clean.push(n);
    });
    clean.sort(function (a, b) { return a - b; });
    return {
      subscription: v.subscription,
      time: validTime(v.time) || "07:00",
      days: clean.length ? clean : [0, 1, 2, 3, 4, 5, 6],
      timezone: typeof v.timezone === "string" && v.timezone ? v.timezone : "UTC",
      enabled: v.enabled === false ? false : true,
      lastOpenedDate: validDate(v.lastOpenedDate),
      lastSentDate: validDate(v.lastSentDate)
    };
  }

  /* "Now" as that device sees it. An IANA zone rather than a fixed offset, so
     daylight saving is the zone's problem and not ours. An unknown zone falls
     back to UTC rather than throwing and stranding every other record. */
  function localParts(nowMs, timezone) {
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short"
      });
    } catch (e) {
      return localParts(nowMs, "UTC");
    }
    var got = {};
    fmt.formatToParts(new Date(nowMs)).forEach(function (p) { got[p.type] = p.value; });
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[got.weekday];
    return {
      date: got.year + "-" + got.month + "-" + got.day,
      minutes: (+got.hour) * 60 + (+got.minute),
      weekday: wd
    };
  }

  /* Every reason to stay quiet is named, so a run can be explained rather
     than guessed at. */
  function shouldSend(record, nowMs, windowMinutes) {
    var r = normRecord(record);
    if (!r) return { send: false, why: "no subscription" };
    if (!r.enabled) return { send: false, why: "turned off" };
    var win = windowMinutes || WINDOW_MINUTES;
    var at = localParts(nowMs, r.timezone);
    if (r.days.indexOf(at.weekday) < 0) return { send: false, why: "not one of its days", at: at };
    var want = minutesOf(r.time);
    if (at.minutes < want) return { send: false, why: "too early", at: at };
    if (at.minutes >= want + win) return { send: false, why: "window has passed", at: at };
    if (r.lastSentDate === at.date) return { send: false, why: "already sent today", at: at };
    if (r.lastOpenedDate === at.date) {
      return { send: false, why: "already opened today", at: at };
    }
    return { send: true, why: "due", at: at };
  }

  /* Rotates by date so two days running do not read identically, and a retry
     within a day says the same thing it said the first time. */
  function bodyFor(dateKey) {
    var n = 0;
    for (var i = 0; i < dateKey.length; i++) n = (n * 31 + dateKey.charCodeAt(i)) >>> 0;
    return LINES[n % LINES.length];
  }
  function payloadFor(dateKey) {
    return {
      title: "Life Today",
      body: bodyFor(dateKey),
      tag: "morning-nudge",
      url: "/?open=brief"
    };
  }

  return {
    WINDOW_MINUTES: WINDOW_MINUTES, LINES: LINES,
    normRecord: normRecord, localParts: localParts, shouldSend: shouldSend,
    bodyFor: bodyFor, payloadFor: payloadFor, minutesOf: minutesOf
  };
});
