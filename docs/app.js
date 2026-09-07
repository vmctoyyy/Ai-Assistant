/* Quiet Desk — a personal daily dashboard.
   Everything lives on this device. Nothing is sent anywhere. */
(function () {
  "use strict";

  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect,
      useRef = React.useRef, useMemo = React.useMemo, useCallback = React.useCallback;

  function tag(name) {
    return function (props) {
      var kids = Array.prototype.slice.call(arguments, 1);
      return React.createElement.apply(null, [name, props].concat(kids));
    };
  }
  var div = tag("div"), span = tag("span"), button = tag("button"), input = tag("input"),
      section = tag("section"), header = tag("header"), p = tag("p"), h2 = tag("h2"),
      textarea = tag("textarea"), footer = tag("footer");

  /* ---------- icons ---------- */
  function icon(d, size) {
    return h("svg", {
      width: size || 18, height: size || 18, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round",
      strokeLinejoin: "round", "aria-hidden": "true"
    }, h("path", { d: d }));
  }
  var I_CHECK = "M5 12.5l4.5 4.5L19 7";
  var I_X = "M6 6l12 12M18 6L6 18";
  var I_UP = "M12 19V5M6 11l6-6 6 6";
  var I_DOWN = "M12 5v14M18 13l-6 6-6-6";
  var I_PLUS = "M12 5v14M5 12h14";
  var I_CHEV = "M6 9l6 6 6-6";

  /* ---------- dates ---------- */
  var WD = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var WD3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MO3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function dayKey(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
  }
  function todayKey() { return dayKey(new Date()); }
  function nzDate(d) { return WD3[d.getDay()] + " " + d.getDate() + " " + MO3[d.getMonth()]; }
  function shiftKey(key, delta) {
    var b = key.split("-");
    var d = new Date(+b[0], +b[1] - 1, +b[2]);
    d.setDate(d.getDate() + delta);
    return dayKey(d);
  }
  function keyToDate(key) {
    var b = key.split("-");
    return new Date(+b[0], +b[1] - 1, +b[2]);
  }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function timeToMinutes(t) {
    if (!t) return 0;
    var b = String(t).split(":");
    return (+b[0] || 0) * 60 + (+b[1] || 0);
  }
  function staleness(iso) {
    if (!iso) return "not entered yet";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "not entered yet";
    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "updated just now";
    if (mins < 60) return "updated " + mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return "updated " + hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    return "updated " + days + (days === 1 ? " day ago" : " days ago");
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- fixed content ---------- */
  var HABITS = [
    { id: "move",  name: "Movement",            sub: "Exercise, a walk, anything physical" },
    { id: "fuel",  name: "Water & food",        sub: "Ate properly, drank enough" },
    { id: "sleep", name: "Sleep & wind-down",   sub: "Screens down, bed on time" },
    { id: "focus", name: "Focused work block",  sub: "One uninterrupted stretch" }
  ];
  var MARKETS = [
    { id: "djia",   name: "Dow Jones", sym: "DJIA" },
    { id: "nasdaq", name: "Nasdaq",    sym: "IXIC" },
    { id: "nzx50",  name: "NZX 50",    sym: "NZ50" },
    { id: "asx200", name: "ASX 200",   sym: "XJO" },
    { id: "btc",    name: "Bitcoin",   sym: "BTC" },
    { id: "xrp",    name: "XRP",       sym: "XRP" },
    { id: "eth",    name: "Ethereum",  sym: "ETH" },
    { id: "gold",   name: "Gold",      sym: "XAU" },
    { id: "silver", name: "Silver",    sym: "XAG" }
  ];

  var KEYS = ["tasks", "schedule", "habits", "markets", "prefs"];

  function blankTasks(day) { return { day: day, top: [null, null, null], list: [], doneYesterday: 0 }; }
  function blankSchedule(day) { return { day: day, events: [] }; }
  function blankHabits() { return { days: {} }; }
  function blankMarkets() { return { items: {}, updatedAt: null }; }
  function blankPrefs() { return { installHintDismissed: false }; }

  /* ---------- storage: IndexedDB, falling back to localStorage ---------- */
  var store = {
    mode: "none",   /* "idb" | "ls" | "none" */
    db: null,
    ready: false,
    timers: {},
    pending: {},
    onError: null
  };

  var DB_NAME = "quietdesk", DB_STORE = "kv";

  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no indexeddb"));
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb open failed")); };
      req.onblocked = function () { reject(new Error("idb blocked")); };
    });
  }
  function idbGet(key) {
    return new Promise(function (resolve, reject) {
      var tx = store.db.transaction(DB_STORE, "readonly");
      var req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbSet(key, value) {
    return new Promise(function (resolve, reject) {
      var tx = store.db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  function lsGet(key) {
    var raw = window.localStorage.getItem("quietdesk:" + key);
    return raw == null ? undefined : JSON.parse(raw);
  }
  function lsSet(key, value) {
    window.localStorage.setItem("quietdesk:" + key, JSON.stringify(value));
  }

  function readKey(key, fallback) {
    try {
      if (store.mode === "idb") {
        return idbGet(key).then(function (v) { return v === undefined ? fallback : v; });
      }
      if (store.mode === "ls") {
        var v = lsGet(key);
        return Promise.resolve(v === undefined ? fallback : v);
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fallback);
  }
  function writeKey(key, value) {
    try {
      if (store.mode === "idb") return idbSet(key, value);
      if (store.mode === "ls") { lsSet(key, value); return Promise.resolve(); }
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve();
  }

  function flush(key) {
    var value = store.pending[key];
    delete store.pending[key];
    delete store.timers[key];
    if (value === undefined) return;
    writeKey(key, value).catch(function (e) { if (store.onError) store.onError(e); });
  }
  function save(key, value) {
    if (!store.ready) return;
    store.pending[key] = value;
    if (store.timers[key]) clearTimeout(store.timers[key]);
    store.timers[key] = setTimeout(function () { flush(key); }, 300);
  }
  function flushAll() {
    Object.keys(store.timers).forEach(function (k) { clearTimeout(store.timers[k]); flush(k); });
  }
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushAll();
  });

  /* ---------- rollover ---------- */
  function rollTasks(t, today) {
    if (!t || t.day === today) return t;
    var doneCount = 0;
    var top = (t.top || [null, null, null]).map(function (slot) {
      if (!slot) return null;
      if (slot.done) { doneCount++; return null; }
      return slot;
    });
    var list = (t.list || []).filter(function (task) {
      if (task.done) { doneCount++; return false; }
      return true;
    });
    while (top.length < 3) top.push(null);
    return { day: today, top: top, list: list, doneYesterday: doneCount };
  }
  function rollSchedule(s, today) {
    if (!s || s.day === today) return s;
    return { day: today, events: [] };
  }
  function pruneHabits(hb, today) {
    var keep = {};
    for (var i = 0; i < 30; i++) keep[shiftKey(today, -i)] = true;
    var out = {};
    Object.keys(hb.days || {}).forEach(function (k) { if (keep[k]) out[k] = hb.days[k]; });
    return { days: out };
  }

  /* ---------- normalisers ---------- */
  function normTasks(v, day) {
    if (!v || typeof v !== "object") return blankTasks(day);
    var top = Array.isArray(v.top) ? v.top.slice(0, 3) : [];
    while (top.length < 3) top.push(null);
    top = top.map(function (s) {
      return s && typeof s === "object" && s.text
        ? { id: s.id || uid(), text: String(s.text), done: !!s.done, at: s.at || Date.now() } : null;
    });
    var list = (Array.isArray(v.list) ? v.list : []).filter(function (t) {
      return t && typeof t === "object" && t.text;
    }).map(function (t) {
      return { id: t.id || uid(), text: String(t.text), done: !!t.done, at: t.at || Date.now() };
    });
    return {
      day: typeof v.day === "string" ? v.day : day,
      top: top, list: list,
      doneYesterday: typeof v.doneYesterday === "number" ? v.doneYesterday : 0
    };
  }
  function normSched(v, day) {
    if (!v || typeof v !== "object") return blankSchedule(day);
    var events = (Array.isArray(v.events) ? v.events : []).filter(function (e) {
      return e && typeof e === "object" && e.title;
    }).map(function (e) {
      return { id: e.id || uid(), time: String(e.time || "00:00"), title: String(e.title) };
    });
    events.sort(function (a, b) { return timeToMinutes(a.time) - timeToMinutes(b.time); });
    return { day: typeof v.day === "string" ? v.day : day, events: events };
  }
  function normHabits(v) {
    if (!v || typeof v !== "object" || !v.days || typeof v.days !== "object") return blankHabits();
    return { days: v.days };
  }
  function normMarkets(v) {
    if (!v || typeof v !== "object") return blankMarkets();
    var items = {};
    var src = v.items && typeof v.items === "object" ? v.items : {};
    MARKETS.forEach(function (m) {
      var row = src[m.id];
      items[m.id] = {
        price: row && row.price != null ? String(row.price) : "",
        change: row && row.change != null ? String(row.change) : ""
      };
    });
    return { items: items, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null };
  }
  function normPrefs(v) {
    if (!v || typeof v !== "object") return blankPrefs();
    return { installHintDismissed: !!v.installHintDismissed };
  }

  /* ---------- small components ---------- */
  function Check(props) {
    return div({ className: "check" + (props.on ? " on" : ""), "aria-hidden": "true" }, icon(I_CHECK, 16));
  }
  function Eyebrow(props) {
    return div({ className: "eyebrow" },
      span(null, props.title),
      props.hint ? span({ className: "hint" }, props.hint) : null);
  }

  /* ---------- swipeable task row ---------- */
  function TaskRow(props) {
    var task = props.task;
    var start = useRef(0), moved = useRef(false), dragging = useRef(false), offRef = useRef(0);
    var st = useState(0), offset = st[0], setOffset = st[1];

    function down(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("button")) return;
      start.current = e.clientX;
      moved.current = false;
      dragging.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (!dragging.current) return;
      var dx = e.clientX - start.current;
      if (Math.abs(dx) > 6) moved.current = true;
      var next = dx < 0 ? Math.max(dx, -132) : 0;
      offRef.current = next;
      setOffset(next);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      if (offRef.current < -80) { props.onDelete(); return; }
      offRef.current = 0;
      setOffset(0);
    }
    function toggle() {
      if (moved.current) { moved.current = false; return; }
      props.onToggle();
    }

    return div({ className: "rowwrap" + (offset < -8 ? " sliding" : "") },
      div({
        className: "row" + (task.done ? " done" : ""),
        style: {
          transform: "translateX(" + offset + "px)",
          transition: dragging.current ? "none" : "transform .18s ease"
        },
        onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up
      },
        button({
          className: "tapzone", onClick: toggle,
          "aria-pressed": task.done ? "true" : "false",
          "aria-label": (task.done ? "Mark not done: " : "Mark done: ") + task.text
        }, h(Check, { on: task.done }), span({ className: "txt" }, task.text)),
        props.canPromote ? button({
          className: "iconbtn", onClick: props.onPromote,
          "aria-label": "Move to Top 3: " + task.text
        }, icon(I_UP, 17)) : null,
        button({
          className: "iconbtn", onClick: props.onDelete,
          "aria-label": "Delete: " + task.text
        }, icon(I_X, 17))
      )
    );
  }

  /* ---------- top 3 ---------- */
  function TopThree(props) {
    var st = useState(-1), editing = st[0], setEditing = st[1];
    var st2 = useState(""), draft = st2[0], setDraft = st2[1];
    var committing = useRef(false);

    function commit(i) {
      if (committing.current) return;
      committing.current = true;
      setTimeout(function () { committing.current = false; }, 0);
      var text = draft.trim();
      if (text) props.onSet(i, text);
      setDraft("");
      setEditing(-1);
    }

    return div({ className: "top3" }, props.top.map(function (slot, i) {
      if (!slot && editing === i) {
        return div({ className: "slot empty", key: "e" + i },
          span({ className: "rank" }, String(i + 1)),
          h("form", {
            style: { flex: 1, minWidth: 0 },
            onSubmit: function (e) { e.preventDefault(); commit(i); }
          }, input({
            className: "field", autoFocus: true, value: draft,
            placeholder: "What matters most?", "aria-label": "Priority " + (i + 1),
            enterKeyHint: "done",
            onChange: function (e) { setDraft(e.target.value); },
            onBlur: function () { commit(i); }
          }))
        );
      }
      if (!slot) {
        return button({
          className: "slot empty", key: "e" + i,
          onClick: function () { setDraft(""); setEditing(i); },
          "aria-label": "Set priority " + (i + 1)
        },
          span({ className: "rank" }, String(i + 1)),
          div({ className: "body" },
            span({ className: "prompt" }, "Set your " + ["first", "second", "third"][i] + " priority"))
        );
      }
      return div({ className: "slot" + (slot.done ? " done" : ""), key: slot.id },
        span({ className: "rank" }, String(i + 1)),
        button({
          className: "tapzone", onClick: function () { props.onToggle(i); },
          "aria-pressed": slot.done ? "true" : "false",
          "aria-label": (slot.done ? "Mark not done: " : "Mark done: ") + slot.text
        }, h(Check, { on: slot.done }), span({ className: "txt" }, slot.text)),
        button({
          className: "iconbtn", onClick: function () { props.onDemote(i); },
          "aria-label": "Move down to the task list: " + slot.text
        }, icon(I_DOWN, 17))
      );
    }));
  }

  /* ---------- sheets ---------- */
  function Sheet(props) {
    useEffect(function () {
      function esc(e) { if (e.key === "Escape") props.onClose(); }
      window.addEventListener("keydown", esc);
      return function () { window.removeEventListener("keydown", esc); };
    }, []);
    return div({
      className: "scrim",
      onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); }
    }, div({ className: "sheet", role: "dialog", "aria-modal": "true", "aria-label": props.title },
      h2(null, props.title),
      props.children));
  }

  function BrainDump(props) {
    var st = useState(""), text = st[0], setText = st[1];
    var lines = text.split("\n").map(function (l) {
      return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    }).filter(Boolean);

    return h(Sheet, { title: "Brain dump", onClose: props.onClose },
      p(null, "One task per line. Everything lands in the list below your Top 3."),
      textarea({
        value: text, autoFocus: true, spellCheck: true,
        placeholder: "Ring the plumber\nDraft the Thursday update\nBook flights for October\nReply to Marcus",
        onChange: function (e) { setText(e.target.value); }
      }),
      div({ className: "sheetfoot" },
        button({ className: "btn", onClick: props.onClose }, "Cancel"),
        button({
          className: "btn primary", disabled: lines.length === 0,
          onClick: function () { props.onAdd(lines); props.onClose(); }
        }, lines.length === 0 ? "Add tasks"
          : "Add " + lines.length + (lines.length === 1 ? " task" : " tasks"))
      ));
  }

  function Backup(props) {
    var st = useState("export"), mode = st[0], setMode = st[1];
    var st2 = useState(""), paste = st2[0], setPaste = st2[1];
    var st3 = useState(""), note = st3[0], setNote = st3[1];
    var json = useMemo(function () { return JSON.stringify(props.snapshot, null, 2); }, [props.snapshot]);

    function copy() {
      var done = function () { setNote("Copied to the clipboard."); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(done).catch(function () {
          setNote("Could not copy. Select the text and copy it by hand.");
        });
      } else {
        setNote("Select the text above and copy it by hand.");
      }
    }
    function download() {
      try {
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "quiet-desk-" + todayKey() + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        setNote("Saved. Check your Files or Downloads.");
      } catch (e) {
        setNote("This browser blocked the download. Copy the text instead.");
      }
    }
    function restore() {
      var parsed;
      try { parsed = JSON.parse(paste); }
      catch (e) { setNote("That is not valid backup text. Paste the whole file, braces included."); return; }
      if (!parsed || typeof parsed !== "object") { setNote("That backup looks empty."); return; }
      props.onRestore(parsed);
      setNote("Restored.");
    }

    return h(Sheet, { title: "Back up & restore", onClose: props.onClose },
      p(null, mode === "export"
        ? "Your whole dashboard as text. Keep a copy somewhere safe — this app stores everything on this device only."
        : "Paste a backup below. This replaces everything currently in the app."),
      div({ className: "footrow", style: { gap: "1.25rem", paddingBottom: ".25rem" } },
        button({
          className: "linkbtn", style: mode === "export" ? { color: "var(--accent)" } : null,
          onClick: function () { setMode("export"); setNote(""); }
        }, "Back up"),
        button({
          className: "linkbtn", style: mode === "restore" ? { color: "var(--accent)" } : null,
          onClick: function () { setMode("restore"); setNote(""); }
        }, "Restore")),
      mode === "export"
        ? textarea({ className: "code", readOnly: true, value: json,
            onFocus: function (e) { e.target.select(); } })
        : textarea({ className: "code", value: paste, autoFocus: true,
            placeholder: '{ "tasks": { ... } }',
            onChange: function (e) { setPaste(e.target.value); } }),
      note ? p(null, note) : null,
      div({ className: "sheetfoot" },
        button({ className: "btn", onClick: props.onClose }, "Close"),
        mode === "export"
          ? h(React.Fragment, null,
              button({ className: "btn", onClick: copy }, "Copy"),
              button({ className: "btn primary", onClick: download }, "Save file"))
          : button({ className: "btn primary", disabled: !paste.trim(), onClick: restore }, "Replace everything")
      ));
  }

  /* ---------- markets ---------- */
  function Markets(props) {
    var st = useState(false), open = st[0], setOpen = st[1];
    var st2 = useState(function () { return props.data.items || {}; }), draft = st2[0], setDraft = st2[1];
    var st3 = useState(false), dirty = st3[0], setDirty = st3[1];
    var seen = useRef(props.data);

    /* pick up an external replacement (a restore, a reset) */
    useEffect(function () {
      if (props.data !== seen.current) {
        seen.current = props.data;
        setDraft(props.data.items || {});
        setDirty(false);
      }
    }, [props.data]);

    function edit(id, field, value) {
      var next = {};
      Object.keys(draft).forEach(function (k) { next[k] = { price: draft[k].price, change: draft[k].change }; });
      if (!next[id]) next[id] = { price: "", change: "" };
      next[id][field] = value;
      setDraft(next);
      setDirty(true);
    }
    function commit() { props.onSave(draft); setDirty(false); }

    var body = !open ? null : div({ className: "sec", style: { gap: 0, paddingTop: ".25rem" } },
      MARKETS.map(function (m) {
        var v = draft[m.id] || { price: "", change: "" };
        var num = parseFloat(String(v.change).replace(/[^0-9.\-+]/g, ""));
        var dir = isNaN(num) || num === 0 ? "" : (num > 0 ? " up" : " down");
        return div({ className: "mkt", key: m.id },
          div({ className: "nm" }, m.name, h("em", null, m.sym)),
          input({
            inputMode: "decimal", value: v.price, placeholder: "—",
            "aria-label": m.name + " price",
            onChange: function (e) { edit(m.id, "price", e.target.value); }
          }),
          div({ className: "chg" + dir },
            input({
              inputMode: "decimal", value: v.change, placeholder: "—",
              "aria-label": m.name + " percent change",
              onChange: function (e) { edit(m.id, "change", e.target.value); }
            })));
      }),
      div({ className: "mktfoot" },
        span({ className: "meta" }, dirty ? "Not saved yet" : staleness(props.data.updatedAt)),
        button({ className: "btn" + (dirty ? " primary" : ""), disabled: !dirty, onClick: commit }, "Save prices"))
    );

    return section({ className: "sec" },
      h(Eyebrow, { title: "Markets" }),
      button({
        className: "disc", onClick: function () { setOpen(!open); },
        "aria-expanded": open ? "true" : "false"
      },
        span({ className: "lbl" }, "Your positions"),
        span({ style: { display: "flex", alignItems: "center", gap: ".625rem" } },
          span({ className: "meta" }, dirty ? "Not saved yet" : staleness(props.data.updatedAt)),
          span({ className: "chev" + (open ? " open" : "") }, icon(I_CHEV, 18)))),
      body);
  }

  function weekLabel(habits, week, hab) {
    var n = week.filter(function (k) { return !!((habits.days[k] || {})[hab.id]); }).length;
    return hab.name + ": " + n + " of the last 7 days";
  }

  /* ---------- app ---------- */
  function App() {
    var s0 = useState(true), loading = s0[0], setLoading = s0[1];
    var s1 = useState(null), warn = s1[0], setWarn = s1[1];
    var s2 = useState(todayKey()), today = s2[0], setToday = s2[1];
    var s3 = useState(function () { return blankTasks(todayKey()); }), tasks = s3[0], setTasksRaw = s3[1];
    var s4 = useState(function () { return blankSchedule(todayKey()); }), sched = s4[0], setSchedRaw = s4[1];
    var s5 = useState(blankHabits), habits = s5[0], setHabitsRaw = s5[1];
    var s6 = useState(blankMarkets), markets = s6[0], setMarketsRaw = s6[1];
    var s7 = useState(blankPrefs), prefs = s7[0], setPrefsRaw = s7[1];
    var s8 = useState(""), quick = s8[0], setQuick = s8[1];
    var s9 = useState(false), dumping = s9[0], setDumping = s9[1];
    var s10 = useState(false), backing = s10[0], setBacking = s10[1];
    var s11 = useState(""), evTime = s11[0], setEvTime = s11[1];
    var s12 = useState(""), evTitle = s12[0], setEvTitle = s12[1];
    var s13 = useState(false), armed = s13[0], setArmed = s13[1];
    var s14 = useState(nowMinutes()), clock = s14[0], setClock = s14[1];

    var setTasks   = useCallback(function (v) { setTasksRaw(v);   save("tasks", v); }, []);
    var setSched   = useCallback(function (v) { setSchedRaw(v);   save("schedule", v); }, []);
    var setHabits  = useCallback(function (v) { setHabitsRaw(v);  save("habits", v); }, []);
    var setMarkets = useCallback(function (v) { setMarketsRaw(v); save("markets", v); }, []);
    var setPrefs   = useCallback(function (v) { setPrefsRaw(v);   save("prefs", v); }, []);

    /* boot */
    useEffect(function () {
      var cancelled = false;
      store.onError = function () {
        setWarn("A change could not be saved just now. It is still on screen and will save again on your next edit.");
      };

      openIDB().then(function (db) {
        store.db = db;
        store.mode = "idb";
      }).catch(function () {
        try {
          window.localStorage.setItem("quietdesk:probe", "1");
          window.localStorage.removeItem("quietdesk:probe");
          store.mode = "ls";
        } catch (e) {
          store.mode = "none";
          setWarn("This browser will not let the app store anything, so nothing here will persist. Everything still works for this session.");
        }
      }).then(function () {
        var day = todayKey();
        return Promise.all([
          readKey("tasks", null), readKey("schedule", null),
          readKey("habits", null), readKey("markets", null), readKey("prefs", null)
        ]).then(function (res) {
          if (cancelled) return;
          var t  = rollTasks(normTasks(res[0], day), day);
          var sc = rollSchedule(normSched(res[1], day), day);
          var hb = pruneHabits(normHabits(res[2]), day);
          setToday(day);
          setTasksRaw(t); setSchedRaw(sc); setHabitsRaw(hb);
          setMarketsRaw(normMarkets(res[3]));
          setPrefsRaw(normPrefs(res[4]));
          store.ready = store.mode !== "none";
          setLoading(false);
          if (!res[0] || res[0].day !== day) save("tasks", t);
          if (!res[1] || res[1].day !== day) save("schedule", sc);
        });
      }).catch(function () {
        if (cancelled) return;
        setWarn("Your saved data could not be read. Nothing has been deleted — close the app and open it again to retry.");
        store.ready = false;
        setLoading(false);
      });

      /* ask iOS to keep this data rather than evict it under pressure */
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {});
      }

      return function () { cancelled = true; };
    }, []);

    /* clock tick */
    useEffect(function () {
      function tick() { setClock(nowMinutes()); }
      var id = setInterval(tick, 20000);
      document.addEventListener("visibilitychange", tick);
      window.addEventListener("focus", tick);
      return function () {
        clearInterval(id);
        document.removeEventListener("visibilitychange", tick);
        window.removeEventListener("focus", tick);
      };
    }, []);

    /* midnight rollover, off the tick with fresh state in hand */
    useEffect(function () {
      if (loading) return;
      var now = todayKey();
      if (now === today) return;
      setToday(now);
      setTasks(rollTasks(tasks, now));
      setSched(rollSchedule(sched, now));
      setHabits(pruneHabits(habits, now));
    }, [clock, today, loading, tasks, sched, habits, setTasks, setSched, setHabits]);

    /* ---- actions ---- */
    function addTasks(texts) {
      var made = texts.map(function (t) { return { id: uid(), text: t, done: false, at: Date.now() }; });
      setTasks({ day: tasks.day, top: tasks.top, list: tasks.list.concat(made), doneYesterday: tasks.doneYesterday });
    }
    function toggleTask(id) {
      setTasks({ day: tasks.day, top: tasks.top, doneYesterday: tasks.doneYesterday,
        list: tasks.list.map(function (t) {
          return t.id === id ? { id: t.id, text: t.text, done: !t.done, at: t.at } : t; }) });
    }
    function deleteTask(id) {
      setTasks({ day: tasks.day, top: tasks.top, doneYesterday: tasks.doneYesterday,
        list: tasks.list.filter(function (t) { return t.id !== id; }) });
    }
    function freeSlot() { for (var i = 0; i < 3; i++) if (!tasks.top[i]) return i; return -1; }
    function promote(id) {
      var slot = freeSlot();
      if (slot < 0) return;
      var task = null;
      var rest = tasks.list.filter(function (t) {
        if (t.id === id) { task = t; return false; }
        return true;
      });
      if (!task) return;
      var top = tasks.top.slice();
      top[slot] = task;
      setTasks({ day: tasks.day, top: top, list: rest, doneYesterday: tasks.doneYesterday });
    }
    function demote(i) {
      var slot = tasks.top[i];
      if (!slot) return;
      var top = tasks.top.slice();
      top[i] = null;
      setTasks({ day: tasks.day, top: top, list: tasks.list.concat([slot]), doneYesterday: tasks.doneYesterday });
    }
    function setSlot(i, text) {
      var top = tasks.top.slice();
      top[i] = { id: uid(), text: text, done: false, at: Date.now() };
      setTasks({ day: tasks.day, top: top, list: tasks.list, doneYesterday: tasks.doneYesterday });
    }
    function toggleSlot(i) {
      var top = tasks.top.slice();
      var slot = top[i];
      if (!slot) return;
      top[i] = { id: slot.id, text: slot.text, done: !slot.done, at: slot.at };
      setTasks({ day: tasks.day, top: top, list: tasks.list, doneYesterday: tasks.doneYesterday });
    }
    function addEvent(e) {
      e.preventDefault();
      var title = evTitle.trim();
      if (!evTime || !title) return;
      var events = sched.events.concat([{ id: uid(), time: evTime, title: title }]);
      events.sort(function (a, b) { return timeToMinutes(a.time) - timeToMinutes(b.time); });
      setSched({ day: today, events: events });
      setEvTime(""); setEvTitle("");
    }
    function deleteEvent(id) {
      setSched({ day: today, events: sched.events.filter(function (ev) { return ev.id !== id; }) });
    }
    function toggleHabit(id) {
      var days = {};
      Object.keys(habits.days).forEach(function (k) { days[k] = habits.days[k]; });
      var cur = {};
      Object.keys(days[today] || {}).forEach(function (k) { cur[k] = days[today][k]; });
      cur[id] = !cur[id];
      days[today] = cur;
      setHabits({ days: days });
    }
    function resetAll() {
      var day = todayKey();
      setTasks(blankTasks(day)); setSched(blankSchedule(day));
      setHabits(blankHabits()); setMarkets(blankMarkets());
      setArmed(false); setWarn(null);
    }
    function restore(data) {
      var day = todayKey();
      setTasks(rollTasks(normTasks(data.tasks, day), day));
      setSched(rollSchedule(normSched(data.schedule, day), day));
      setHabits(pruneHabits(normHabits(data.habits), day));
      setMarkets(normMarkets(data.markets));
      setWarn(null);
    }
    var snapshot = useMemo(function () {
      return { app: "quiet-desk", version: 1, exportedAt: new Date().toISOString(),
        tasks: tasks, schedule: sched, habits: habits, markets: markets };
    }, [tasks, sched, habits, markets]);

    /* ---- derived ---- */
    var ordered = useMemo(function () {
      return tasks.list.filter(function (t) { return !t.done; })
        .concat(tasks.list.filter(function (t) { return t.done; }));
    }, [tasks.list]);

    var nextEventId = useMemo(function () {
      for (var i = 0; i < sched.events.length; i++) {
        if (timeToMinutes(sched.events[i].time) >= clock) return sched.events[i].id;
      }
      return null;
    }, [sched.events, clock]);

    var week = useMemo(function () {
      var out = [];
      for (var i = 6; i >= 0; i--) out.push(shiftKey(today, -i));
      return out;
    }, [today]);

    var showInstallHint = useMemo(function () {
      if (prefs.installHintDismissed) return false;
      var standalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (standalone) return false;
      return /iPad|iPhone|iPod/.test(navigator.userAgent);
    }, [prefs.installHintDismissed]);

    if (loading) {
      return div({ className: "loadwrap" },
        div({ className: "skel" }, h("i", { className: "line", style: { height: "34px", width: "58%" } })),
        div({ className: "skel" }, h("i", { className: "big" }), h("i", { className: "big" }), h("i", { className: "big" })),
        div({ className: "skel" }, h("i", { className: "line" }), h("i", { className: "line" }), h("i", { className: "line" })),
        span({ className: "sr" }, "Loading your dashboard"));
    }

    var d = keyToDate(today);
    var slotOpen = freeSlot() >= 0;

    return h(React.Fragment, null,
      div({ className: "page" },

        header({ className: "head" },
          span({ className: "wd" }, WD[d.getDay()]),
          span({ className: "dt" }, nzDate(d))),

        warn ? div({ className: "banner", role: "status" }, span(null, warn)) : null,

        showInstallHint ? div({ className: "banner" },
          span(null, "Tap Share, then ", h("strong", null, "Add to Home Screen"),
            ", to run this full screen and offline."),
          button({
            className: "x", "aria-label": "Dismiss",
            onClick: function () { setPrefs({ installHintDismissed: true }); }
          }, icon(I_X, 16))) : null,

        section({ className: "sec" },
          h(Eyebrow, { title: "Top 3 today" }),
          h(TopThree, { top: tasks.top, onSet: setSlot, onToggle: toggleSlot, onDemote: demote })),

        section({ className: "sec" },
          h(Eyebrow, {
            title: "Everything else",
            hint: ordered.length ? ordered.filter(function (t) { return !t.done; }).length + " open" : null
          }),
          ordered.length === 0
            ? p({ className: "empty-note" }, "Nothing else on the list. Add anything as it occurs to you.")
            : div({ className: "tasks" }, ordered.map(function (t) {
                return h(TaskRow, {
                  key: t.id, task: t, canPromote: slotOpen && !t.done,
                  onToggle: function () { toggleTask(t.id); },
                  onDelete: function () { deleteTask(t.id); },
                  onPromote: function () { promote(t.id); }
                });
              })),
          tasks.doneYesterday > 0
            ? p({ className: "tally" }, tasks.doneYesterday +
                (tasks.doneYesterday === 1 ? " task" : " tasks") + " done yesterday")
            : null),

        section({ className: "sec" },
          h(Eyebrow, { title: "Today's schedule" }),
          sched.events.length === 0
            ? p({ className: "empty-note" }, "Nothing scheduled.")
            : div(null, sched.events.map(function (ev) {
                var past = timeToMinutes(ev.time) < clock;
                var isNext = ev.id === nextEventId;
                return div({ className: "evrow" + (past ? " past" : "") + (isNext ? " next" : ""), key: ev.id },
                  span({ className: "t" }, ev.time),
                  span({ className: "ti" }, ev.title, isNext ? span({ className: "nextpill" }, "Next") : null),
                  button({
                    className: "iconbtn", onClick: function () { deleteEvent(ev.id); },
                    "aria-label": "Delete event: " + ev.title
                  }, icon(I_X, 16)));
              })),
          h("form", { className: "addrow", onSubmit: addEvent },
            input({
              className: "field time", type: "time", value: evTime, "aria-label": "Event time",
              onChange: function (e) { setEvTime(e.target.value); }
            }),
            input({
              className: "field", value: evTitle, placeholder: "Event", "aria-label": "Event title",
              enterKeyHint: "done",
              onChange: function (e) { setEvTitle(e.target.value); }
            }),
            button({
              className: "btn", type: "submit", disabled: !evTime || !evTitle.trim(),
              "aria-label": "Add event"
            }, icon(I_PLUS, 18)))),

        section({ className: "sec" },
          h(Eyebrow, { title: "Habits", hint: "Last 7 days" }),
          div(null, HABITS.map(function (hab) {
            var on = !!((habits.days[today] || {})[hab.id]);
            return div({ className: "habit", key: hab.id },
              button({
                className: "tapzone", onClick: function () { toggleHabit(hab.id); },
                "aria-pressed": on ? "true" : "false", "aria-label": hab.name + " today"
              }, h(Check, { on: on }),
                 span({ className: "name" }, hab.name, h("em", null, hab.sub))),
              div({ className: "dots", role: "img", "aria-label": weekLabel(habits, week, hab) },
                week.map(function (k, i) {
                  var lit = !!((habits.days[k] || {})[hab.id]);
                  return span({ key: k, className: "dot" + (lit ? " on" : "") + (i === 6 ? " today" : "") });
                })));
          }))),

        h(Markets, {
          data: markets,
          onSave: function (items) { setMarkets({ items: items, updatedAt: new Date().toISOString() }); }
        }),

        footer({ className: "foot" },
          p({ className: "note" },
            "Everything here is stored on this device and never leaves it. Unfinished tasks carry over to tomorrow; finished ones clear at midnight."),
          div({ className: "footrow" },
            button({ className: "linkbtn", onClick: function () { setBacking(true); } }, "Back up & restore"),
            button({
              className: "linkbtn danger" + (armed ? " armed" : ""),
              onClick: function () { if (armed) { resetAll(); } else { setArmed(true); } },
              onBlur: function () { setArmed(false); }
            }, armed ? "Tap again to erase everything" : "Reset all data")))
      ),

      div({ className: "composer" },
        h("form", {
          className: "inner",
          onSubmit: function (e) {
            e.preventDefault();
            var t = quick.trim();
            if (!t) return;
            addTasks([t]);
            setQuick("");
          }
        },
          input({
            className: "field", value: quick, placeholder: "Add a task",
            "aria-label": "Add a task", enterKeyHint: "done",
            onChange: function (e) { setQuick(e.target.value); }
          }),
          button({ className: "btn", type: "button", onClick: function () { setDumping(true); } }, "Brain dump"))),

      dumping ? h(BrainDump, { onClose: function () { setDumping(false); }, onAdd: addTasks }) : null,
      backing ? h(Backup, {
        onClose: function () { setBacking(false); },
        snapshot: snapshot, onRestore: restore
      }) : null
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));

  /* offline support */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
