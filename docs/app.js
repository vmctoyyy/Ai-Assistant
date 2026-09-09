/* Quiet Desk — a personal daily dashboard.
   Everything lives on this device. Nothing is sent anywhere.
   Task model, ranking and brief copy live in logic.js (window.QD). */
(function () {
  "use strict";

  var QD = window.QD;
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
  var I_PLUS = "M12 5v14M5 12h14";
  var I_CHEV = "M6 9l6 6 6-6";
  var I_DOTS = "M6 12h.01M12 12h.01M18 12h.01";

  /* ---------- dates ---------- */
  var WD = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var WD3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MO3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function nzDate(d) { return WD3[d.getDay()] + " " + d.getDate() + " " + MO3[d.getMonth()]; }
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
  var todayKey = QD.todayKey, uid = QD.uid;

  /* ---------- fixed content ---------- */
  var HABITS = [
    { id: "move",  name: "Movement",           sub: "Exercise, a walk, anything physical" },
    { id: "fuel",  name: "Water & food",       sub: "Ate properly, drank enough" },
    { id: "sleep", name: "Sleep & wind-down",  sub: "Screens down, bed on time" },
    { id: "focus", name: "Focused work block", sub: "One uninterrupted stretch" }
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

  function blankSchedule(day) { return { day: day, events: [] }; }
  function blankHabits() { return { days: {} }; }
  function blankMarkets() { return { items: {}, updatedAt: null }; }
  function blankPrefs() {
    return { installHintDismissed: false, lastBriefShownOn: null, lastStaleAskOn: null };
  }

  /* ---------- storage: IndexedDB, falling back to localStorage ---------- */
  var store = { mode: "none", db: null, ready: false, timers: {}, pending: {}, onError: null };
  var DB_NAME = "quietdesk", DB_STORE = "kv";

  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no indexeddb"));
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
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
  function readKey(key, fallback) {
    try {
      if (store.mode === "idb") return idbGet(key).then(function (v) { return v === undefined ? fallback : v; });
      if (store.mode === "ls") { var v = lsGet(key); return Promise.resolve(v === undefined ? fallback : v); }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fallback);
  }
  function writeKey(key, value) {
    try {
      if (store.mode === "idb") return idbSet(key, value);
      if (store.mode === "ls") {
        window.localStorage.setItem("quietdesk:" + key, JSON.stringify(value));
        return Promise.resolve();
      }
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

  /* ---------- normalisers for the sections logic.js does not own ---------- */
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
    var items = {}, src = v.items && typeof v.items === "object" ? v.items : {};
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
    return {
      installHintDismissed: !!v.installHintDismissed,
      lastBriefShownOn: typeof v.lastBriefShownOn === "string" ? v.lastBriefShownOn : null,
      lastStaleAskOn: typeof v.lastStaleAskOn === "string" ? v.lastStaleAskOn : null
    };
  }
  function rollSchedule(s, today) {
    if (!s || s.day === today) return s;
    return { day: today, events: [] };
  }
  function pruneHabits(hb, today) {
    var keep = {};
    for (var i = 0; i < 30; i++) keep[QD.shiftKey(today, -i)] = true;
    var out = {};
    Object.keys(hb.days || {}).forEach(function (k) { if (keep[k]) out[k] = hb.days[k]; });
    return { days: out };
  }

  /* ---------- shared bits ---------- */
  function Check(props) {
    return div({ className: "check" + (props.on ? " on" : ""), "aria-hidden": "true" }, icon(I_CHECK, 16));
  }
  function Eyebrow(props) {
    return div({ className: "eyebrow" },
      span(null, props.title),
      props.hint ? span({ className: "hint" }, props.hint) : null);
  }
  function Chips(props) {
    return div({ className: "chips", role: "group", "aria-label": props.label },
      props.options.map(function (o) {
        var on = o.value === props.value;
        return button({
          key: o.value, type: "button",
          className: "chip" + (on ? " on" : ""),
          "aria-pressed": on ? "true" : "false",
          onClick: function () { props.onChange(o.value); }
        }, o.label);
      }));
  }
  var BUCKET_OPTS = QD.BUCKETS.map(function (b) {
    return { value: b, label: b === "today" ? "Today"
      : b === "this_week" ? "Week" : b === "this_month" ? "Month" : "Future" };
  });
  var IMP_OPTS = QD.IMPORTANCE.map(function (i) {
    return { value: i, label: QD.IMPORTANCE_LABEL[i] };
  });

  /* ---------- task row ---------- */
  function TaskRow(props) {
    var task = props.task, today = props.today;
    var start = useRef(0), moved = useRef(false), dragging = useRef(false), offRef = useRef(0);
    var st = useState(0), offset = st[0], setOffset = st[1];
    var done = !!task.completedAt;
    var carry = QD.isCarryIn(task, today);

    function down(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("button")) return;
      start.current = e.clientX; moved.current = false; dragging.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (!dragging.current) return;
      var dx = e.clientX - start.current;
      if (Math.abs(dx) > 6) moved.current = true;
      var next = dx < 0 ? Math.max(dx, -132) : 0;
      offRef.current = next; setOffset(next);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      if (offRef.current < -80) { props.onDelete(); return; }
      offRef.current = 0; setOffset(0);
    }
    function toggle() {
      if (moved.current) { moved.current = false; return; }
      props.onToggle();
    }

    return div({ className: "rowwrap" + (offset < -8 ? " sliding" : "") },
      div({
        className: "row" + (done ? " done" : "") + (carry ? " carry" : ""),
        style: {
          transform: "translateX(" + offset + "px)",
          transition: dragging.current ? "none" : "transform .18s ease"
        },
        onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up
      },
        button({
          className: "tapzone", onClick: toggle,
          "aria-pressed": done ? "true" : "false",
          "aria-label": (done ? "Mark not done: " : "Mark done: ") + task.title
        },
          h(Check, { on: done }),
          span({ className: "txt" },
            task.importance === "must" && !done
              ? span({ className: "mustdot", title: "Must-do", "aria-label": "Must-do" }) : null,
            task.title,
            carry ? span({ className: "carrytag" }, "since " + QD.sinceLabel(task.firstTodayOn, today)) : null,
            task.notes ? span({ className: "notes" }, task.notes) : null)),
        button({
          className: "iconbtn", onClick: props.onOptions,
          "aria-haspopup": "dialog",
          "aria-label": "Options for " + task.title
        }, icon(I_DOTS, 18)),
        button({
          className: "iconbtn", onClick: props.onDelete,
          "aria-label": "Delete: " + task.title
        }, icon(I_X, 17))
      )
    );
  }

  /* ---------- task options ---------- */
  function TaskSheet(props) {
    var task = props.task;
    var s1 = useState(task.title), title = s1[0], setTitle = s1[1];
    var s2 = useState(task.bucket), bucket = s2[0], setBucket = s2[1];
    var s3 = useState(task.importance), imp = s3[0], setImp = s3[1];
    var s4 = useState(task.notes || ""), notes = s4[0], setNotes = s4[1];
    var s5 = useState(false), armed = s5[0], setArmed = s5[1];
    var clean = title.trim();

    function save() {
      if (!clean) return;
      props.onSave({ title: clean, bucket: bucket, importance: imp, notes: notes.trim() });
      props.onClose();
    }

    return h(Sheet, { title: "Task options", onClose: props.onClose },
      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "Name"),
        input({
          className: "field", value: title, "aria-label": "Task name",
          enterKeyHint: "done", spellCheck: true,
          onChange: function (e) { setTitle(e.target.value); },
          onKeyDown: function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } }
        }),
        clean ? null : span({ className: "fieldnote" }, "A task needs a name.")),

      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "Importance"),
        h(Chips, { label: "Importance", options: IMP_OPTS, value: imp, onChange: setImp })),

      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "When"),
        h(Chips, { label: "Bucket", options: BUCKET_OPTS, value: bucket, onChange: setBucket }),
        bucket !== task.bucket && bucket !== "today"
          ? span({ className: "fieldnote" }, "Moves off today's list.")
          : null),

      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "Note"),
        input({
          className: "field", value: notes, placeholder: "Optional",
          "aria-label": "Note", enterKeyHint: "done",
          onChange: function (e) { setNotes(e.target.value); }
        })),

      div({ className: "sheetfoot spread" },
        button({
          className: "linkbtn danger" + (armed ? " armed" : ""),
          onClick: function () {
            if (armed) { props.onDelete(); props.onClose(); } else { setArmed(true); }
          },
          onBlur: function () { setArmed(false); }
        }, armed ? "Tap again to delete" : "Delete"),
        div({ style: { display: "flex", gap: ".5rem" } },
          button({ className: "btn", onClick: props.onClose }, "Cancel"),
          button({ className: "btn primary", disabled: !clean, onClick: save }, "Save"))));
  }

  /* ---------- morning brief ---------- */
  function Brief(props) {
    var today = props.today, items = props.items;
    var ranked = useMemo(function () { return QD.rankToday(items, today); }, [items, today]);
    var doneToday = useMemo(function () {
      return items.filter(function (t) {
        return t.bucket === "today" && t.completedAt && QD.msToKey(t.completedAt) === today;
      });
    }, [items, today]);
    var suggestions = useMemo(function () { return QD.pickSuggestions(items, today); }, [items, today]);
    var stale = useMemo(function () { return QD.pickStale(items, today, props.prefs); }, [items, today, props.prefs]);

    var carryIns = ranked.filter(function (t) { return QD.isCarryIn(t, today); });
    var rest = ranked.filter(function (t) { return !QD.isCarryIn(t, today); });
    var start = QD.startHere(ranked, today);
    var d = QD.keyToDate(today);

    function row(t) {
      return h(TaskRow, {
        key: t.id, task: t, today: today,
        onToggle: function () { props.onToggle(t.id); },
        onDelete: function () { props.onDelete(t.id); },
        onOptions: function () { props.onOptions(t.id); }
      });
    }

    return div({ className: "page brief" },
      header({ className: "head" },
        span({ className: "wd" }, WD[d.getDay()]),
        span({ className: "dt" }, nzDate(d))),

      p({ className: "greeting" }, ranked.length === 0
        ? QD.allDoneLine(items, today)
        : QD.greetingLine(ranked.length)),

      start ? p({ className: "starthere" },
        start.before, span({ className: "sh-title" }, start.title), start.after) : null,

      carryIns.length ? section({ className: "sec carrysec" },
        h(Eyebrow, { title: "Carried over" }),
        div({ className: "tasks" }, carryIns.map(row))) : null,

      rest.length ? section({ className: "sec" },
        carryIns.length ? h(Eyebrow, { title: "The rest of today" }) : null,
        div({ className: "tasks" }, rest.map(row))) : null,

      doneToday.length ? section({ className: "sec" },
        h(Eyebrow, { title: "Done today" }),
        div({ className: "tasks" }, doneToday.map(row))) : null,

      suggestions.length ? section({ className: "sec" },
        h(Eyebrow, { title: "Not on today's list yet" }),
        p({ className: "seclead" }, ranked.length === 0
          ? "Today is empty. These are waiting in " + QD.BUCKET_LABEL[suggestions[0].bucket].toLowerCase() + "."
          : "Today is light. These are waiting in " + QD.BUCKET_LABEL[suggestions[0].bucket].toLowerCase() + "."),
        suggestions.map(function (t) {
          return div({ className: "suggest", key: t.id },
            div({ className: "sg-title" },
              t.importance === "must" ? span({ className: "mustdot" }) : null, t.title),
            div({ className: "sg-acts" },
              button({ className: "btn small primary", onClick: function () { props.onPromote(t.id); } }, "Add to today"),
              button({ className: "btn small", onClick: function () { props.onNotToday(t.id); } }, "Not today")));
        })) : null,

      stale ? section({ className: "sec" },
        h(Eyebrow, { title: "Still relevant?" }),
        div({ className: "suggest stale" },
          div({ className: "sg-title" }, stale.title),
          p({ className: "sg-meta" }, "In this week since " +
            QD.sinceLabel(QD.msToKey(stale.updatedAt || stale.createdAt), today) + "."),
          div({ className: "sg-acts" },
            button({ className: "btn small", onClick: function () { props.onStale(stale.id, "keep"); } }, "Keep"),
            button({ className: "btn small", onClick: function () { props.onStale(stale.id, "push"); } }, "Push to this month"),
            button({ className: "btn small", onClick: function () { props.onStale(stale.id, "delete"); } }, "Delete")))) : null,

      div({ className: "briefend" },
        button({ className: "btn", onClick: props.onClose }, "Go to the full list"))
    );
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
      h2(null, props.title), props.children));
  }

  function BrainDump(props) {
    var st = useState(""), text = st[0], setText = st[1];
    var lines = text.split("\n").map(function (l) {
      return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    }).filter(Boolean);
    return h(Sheet, { title: "Brain dump", onClose: props.onClose },
      p(null, "One task per line. Everything lands in today, marked should."),
      textarea({
        value: text, autoFocus: true, spellCheck: true,
        placeholder: "Ring the plumber\nDraft the Thursday update\nBook flights for October",
        onChange: function (e) { setText(e.target.value); }
      }),
      div({ className: "sheetfoot" },
        button({ className: "btn", onClick: props.onClose }, "Cancel"),
        button({
          className: "btn primary", disabled: lines.length === 0,
          onClick: function () { props.onAdd(lines); props.onClose(); }
        }, lines.length === 0 ? "Add tasks"
          : "Add " + lines.length + (lines.length === 1 ? " task" : " tasks"))));
  }

  function Backup(props) {
    var st = useState("export"), mode = st[0], setMode = st[1];
    var st2 = useState(""), paste = st2[0], setPaste = st2[1];
    var st3 = useState(""), note = st3[0], setNote = st3[1];
    var json = useMemo(function () { return JSON.stringify(props.snapshot, null, 2); }, [props.snapshot]);

    function copy() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json)
          .then(function () { setNote("Copied to the clipboard."); })
          .catch(function () { setNote("Could not copy. Select the text and copy it by hand."); });
      } else { setNote("Select the text above and copy it by hand."); }
    }
    function download() {
      try {
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "quiet-desk-" + todayKey() + ".json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        setNote("Saved. Check your Files or Downloads.");
      } catch (e) { setNote("This browser blocked the download. Copy the text instead."); }
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
        button({ className: "linkbtn", style: mode === "export" ? { color: "var(--accent)" } : null,
          onClick: function () { setMode("export"); setNote(""); } }, "Back up"),
        button({ className: "linkbtn", style: mode === "restore" ? { color: "var(--accent)" } : null,
          onClick: function () { setMode("restore"); setNote(""); } }, "Restore")),
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
          : button({ className: "btn primary", disabled: !paste.trim(), onClick: restore }, "Replace everything")));
  }

  /* ---------- markets ---------- */
  function Markets(props) {
    var st = useState(false), open = st[0], setOpen = st[1];
    var st2 = useState(function () { return props.data.items || {}; }), draft = st2[0], setDraft = st2[1];
    var st3 = useState(false), dirty = st3[0], setDirty = st3[1];
    var seen = useRef(props.data);

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
      setDraft(next); setDirty(true);
    }
    var body = !open ? null : div({ className: "sec", style: { gap: 0, paddingTop: ".25rem" } },
      MARKETS.map(function (m) {
        var v = draft[m.id] || { price: "", change: "" };
        var num = parseFloat(String(v.change).replace(/[^0-9.\-+]/g, ""));
        var dir = isNaN(num) || num === 0 ? "" : (num > 0 ? " up" : " down");
        return div({ className: "mkt", key: m.id },
          div({ className: "nm" }, m.name, h("em", null, m.sym)),
          input({ inputMode: "decimal", value: v.price, placeholder: "—",
            "aria-label": m.name + " price",
            onChange: function (e) { edit(m.id, "price", e.target.value); } }),
          div({ className: "chg" + dir },
            input({ inputMode: "decimal", value: v.change, placeholder: "—",
              "aria-label": m.name + " percent change",
              onChange: function (e) { edit(m.id, "change", e.target.value); } })));
      }),
      div({ className: "mktfoot" },
        span({ className: "meta" }, dirty ? "Not saved yet" : staleness(props.data.updatedAt)),
        button({ className: "btn" + (dirty ? " primary" : ""), disabled: !dirty,
          onClick: function () { props.onSave(draft); setDirty(false); } }, "Save prices")));

    return section({ className: "sec" },
      h(Eyebrow, { title: "Markets" }),
      button({ className: "disc", onClick: function () { setOpen(!open); },
        "aria-expanded": open ? "true" : "false" },
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

  /* ---------- bucket section ---------- */
  function BucketSection(props) {
    var st = useState(false), open = st[0], setOpen = st[1];
    var list = props.items;
    return section({ className: "sec" },
      button({ className: "disc", onClick: function () { setOpen(!open); },
        "aria-expanded": open ? "true" : "false" },
        span({ className: "lbl" }, props.label),
        span({ style: { display: "flex", alignItems: "center", gap: ".625rem" } },
          span({ className: "meta" }, list.length ? String(list.length) : "empty"),
          span({ className: "chev" + (open ? " open" : "") }, icon(I_CHEV, 18)))),
      open && list.length
        ? div({ className: "tasks" }, list.map(function (t) {
            return h(TaskRow, {
              key: t.id, task: t, today: props.today,
              onToggle: function () { props.onToggle(t.id); },
              onDelete: function () { props.onDelete(t.id); },
              onOptions: function () { props.onOptions(t.id); }
            });
          }))
        : null);
  }

  /* ---------- app ---------- */
  function App() {
    var s0 = useState(true), loading = s0[0], setLoading = s0[1];
    var s1 = useState(null), warn = s1[0], setWarn = s1[1];
    var s2 = useState(todayKey()), today = s2[0], setToday = s2[1];
    var s3 = useState(function () { return { version: 2, items: [], doneYesterday: 0, lastRollOn: todayKey() }; });
    var tasks = s3[0], setTasksRaw = s3[1];
    var s4 = useState(function () { return blankSchedule(todayKey()); }), sched = s4[0], setSchedRaw = s4[1];
    var s5 = useState(blankHabits), habits = s5[0], setHabitsRaw = s5[1];
    var s6 = useState(blankMarkets), markets = s6[0], setMarketsRaw = s6[1];
    var s7 = useState(blankPrefs), prefs = s7[0], setPrefsRaw = s7[1];
    var s8 = useState(""), quick = s8[0], setQuick = s8[1];
    var s9 = useState(false), composerOpen = s9[0], setComposerOpen = s9[1];
    var s10 = useState("today"), addBucket = s10[0], setAddBucket = s10[1];
    var s11 = useState("should"), addImp = s11[0], setAddImp = s11[1];
    var s12 = useState(false), dumping = s12[0], setDumping = s12[1];
    var s13 = useState(false), backing = s13[0], setBacking = s13[1];
    var s14 = useState(""), evTime = s14[0], setEvTime = s14[1];
    var s15 = useState(""), evTitle = s15[0], setEvTitle = s15[1];
    var s16 = useState(false), armed = s16[0], setArmed = s16[1];
    var s17 = useState(nowMinutes()), clock = s17[0], setClock = s17[1];
    var s18 = useState(false), briefOpen = s18[0], setBriefOpen = s18[1];
    var s19 = useState(null), editingId = s19[0], setEditingId = s19[1];

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
      openIDB().then(function (db) { store.db = db; store.mode = "idb"; })
        .catch(function () {
          try {
            window.localStorage.setItem("quietdesk:probe", "1");
            window.localStorage.removeItem("quietdesk:probe");
            store.mode = "ls";
          } catch (e) {
            store.mode = "none";
            setWarn("This browser will not let the app store anything, so nothing here will persist. Everything still works for this session.");
          }
        })
        .then(function () {
          var day = todayKey();
          return Promise.all([
            readKey("tasks", null), readKey("schedule", null),
            readKey("habits", null), readKey("markets", null), readKey("prefs", null)
          ]).then(function (res) {
            if (cancelled) return;
            var t  = QD.rollDay(QD.migrate(res[0], day), day);
            var sc = rollSchedule(normSched(res[1], day), day);
            var hb = pruneHabits(normHabits(res[2]), day);
            var pf = normPrefs(res[4]);
            var firstOpenToday = pf.lastBriefShownOn !== day;

            setToday(day);
            setTasksRaw(t); setSchedRaw(sc); setHabitsRaw(hb);
            setMarketsRaw(normMarkets(res[3]));
            store.ready = store.mode !== "none";
            setLoading(false);

            save("tasks", t);
            if (!res[1] || res[1].day !== day) save("schedule", sc);
            if (firstOpenToday) {
              setBriefOpen(true);
              pf = { installHintDismissed: pf.installHintDismissed,
                     lastBriefShownOn: day, lastStaleAskOn: pf.lastStaleAskOn };
            }
            setPrefsRaw(pf);
            if (firstOpenToday) save("prefs", pf);
          });
        })
        .catch(function () {
          if (cancelled) return;
          setWarn("Your saved data could not be read. Nothing has been deleted — close the app and open it again to retry.");
          store.ready = false;
          setLoading(false);
        });

      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
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

    /* local midnight rollover — new day means a new brief */
    useEffect(function () {
      if (loading) return;
      var now = todayKey();
      if (now === today) return;
      setToday(now);
      setTasks(QD.rollDay(tasks, now));
      setSched(rollSchedule(sched, now));
      setHabits(pruneHabits(habits, now));
      if (prefs.lastBriefShownOn !== now) {
        setBriefOpen(true);
        setPrefs({ installHintDismissed: prefs.installHintDismissed,
                   lastBriefShownOn: now, lastStaleAskOn: prefs.lastStaleAskOn });
      }
    }, [clock, today, loading, tasks, sched, habits, prefs, setTasks, setSched, setHabits, setPrefs]);

    /* ---- task actions ---- */
    function commit(items) {
      setTasks({ version: 2, items: items, doneYesterday: tasks.doneYesterday, lastRollOn: tasks.lastRollOn });
    }
    function patch(id, changes) {
      commit(tasks.items.map(function (t) {
        return t.id === id ? QD.applyPatch(t, changes, today) : t;
      }));
    }
    function addTasks(titles, bucket, importance) {
      var made = titles.map(function (title) {
        return QD.makeTask(title, { bucket: bucket || "today", importance: importance || "should", today: today });
      });
      commit(tasks.items.concat(made));
    }
    function toggleTask(id) {
      commit(tasks.items.map(function (t) {
        if (t.id !== id) return t;
        return Object.assign({}, t, {
          completedAt: t.completedAt ? null : Date.now(), updatedAt: Date.now()
        });
      }));
    }
    function deleteTask(id) {
      commit(tasks.items.filter(function (t) { return t.id !== id; }));
    }
    function promoteToToday(id) { patch(id, { bucket: "today" }); }
    function notToday(id) {
      commit(tasks.items.map(function (t) {
        return t.id === id ? Object.assign({}, t, { notTodayOn: today }) : t;
      }));
    }
    function onStale(id, action) {
      var nextPrefs = { installHintDismissed: prefs.installHintDismissed,
                        lastBriefShownOn: prefs.lastBriefShownOn, lastStaleAskOn: today };
      setPrefs(nextPrefs);
      if (action === "delete") { deleteTask(id); return; }
      commit(tasks.items.map(function (t) {
        if (t.id !== id) return t;
        return Object.assign({}, t, {
          bucket: action === "push" ? "this_month" : t.bucket,
          updatedAt: Date.now(), staleAskedOn: today
        });
      }));
    }

    /* ---- other sections ---- */
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
      setTasks({ version: 2, items: [], doneYesterday: 0, lastRollOn: day });
      setSched(blankSchedule(day)); setHabits(blankHabits()); setMarkets(blankMarkets());
      setArmed(false); setWarn(null);
    }
    function restore(data) {
      var day = todayKey();
      setTasks(QD.rollDay(QD.migrate(data.tasks, day), day));
      setSched(rollSchedule(normSched(data.schedule, day), day));
      setHabits(pruneHabits(normHabits(data.habits), day));
      setMarkets(normMarkets(data.markets));
      setWarn(null);
    }
    var snapshot = useMemo(function () {
      return { app: "quiet-desk", version: 2, exportedAt: new Date().toISOString(),
        tasks: tasks, schedule: sched, habits: habits, markets: markets };
    }, [tasks, sched, habits, markets]);

    /* ---- derived ---- */
    var rankedToday = useMemo(function () { return QD.rankToday(tasks.items, today); }, [tasks.items, today]);
    var doneToday = useMemo(function () {
      return tasks.items.filter(function (t) {
        return t.bucket === "today" && t.completedAt && QD.msToKey(t.completedAt) === today;
      });
    }, [tasks.items, today]);
    var nextEventId = useMemo(function () {
      for (var i = 0; i < sched.events.length; i++) {
        if (timeToMinutes(sched.events[i].time) >= clock) return sched.events[i].id;
      }
      return null;
    }, [sched.events, clock]);
    var week = useMemo(function () {
      var out = [];
      for (var i = 6; i >= 0; i--) out.push(QD.shiftKey(today, -i));
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

    var composer = div({ className: "composer" },
      composerOpen ? div({ className: "compchips" },
        h(Chips, { label: "Bucket", options: BUCKET_OPTS, value: addBucket, onChange: setAddBucket }),
        h(Chips, { label: "Importance", options: IMP_OPTS, value: addImp, onChange: setAddImp })) : null,
      h("form", {
        className: "inner",
        onSubmit: function (e) {
          e.preventDefault();
          var t = quick.trim();
          if (!t) return;
          addTasks([t], addBucket, addImp);
          setQuick(""); setAddBucket("today"); setAddImp("should");
        }
      },
        input({
          className: "field", value: quick,
          placeholder: briefOpen ? "Anything else for today?" : "Add a task",
          "aria-label": "Add a task", enterKeyHint: "done",
          onFocus: function () { setComposerOpen(true); },
          onBlur: function () { if (!quick.trim()) setComposerOpen(false); },
          onChange: function (e) { setQuick(e.target.value); }
        }),
        button({ className: "btn", type: "button", onClick: function () { setDumping(true); } }, "Brain dump")));

    var editingTask = editingId
      ? tasks.items.filter(function (t) { return t.id === editingId; })[0] : null;
    var taskSheet = editingTask ? h(TaskSheet, {
      key: editingTask.id, task: editingTask,
      onClose: function () { setEditingId(null); },
      onSave: function (changes) { patch(editingTask.id, changes); },
      onDelete: function () { deleteTask(editingTask.id); }
    }) : null;

    if (briefOpen) {
      return h(React.Fragment, null,
        h(Brief, {
          today: today, items: tasks.items, prefs: prefs,
          onToggle: toggleTask, onDelete: deleteTask, onOptions: setEditingId,
          onPromote: promoteToToday, onNotToday: notToday, onStale: onStale,
          onClose: function () { setBriefOpen(false); }
        }),
        composer,
        dumping ? h(BrainDump, { onClose: function () { setDumping(false); },
          onAdd: function (lines) { addTasks(lines, "today", "should"); } }) : null,
        taskSheet);
    }

    var d = QD.keyToDate(today);
    return h(React.Fragment, null,
      div({ className: "page" },
        header({ className: "head" },
          span({ className: "wd" }, WD[d.getDay()]),
          span({ className: "dt" }, nzDate(d)),
          button({ className: "briefLink", onClick: function () { setBriefOpen(true); } }, "Today's brief")),

        warn ? div({ className: "banner", role: "status" }, span(null, warn)) : null,

        showInstallHint ? div({ className: "banner" },
          span(null, "Tap Share, then ", h("strong", null, "Add to Home Screen"),
            ", to run this full screen and offline."),
          button({ className: "x", "aria-label": "Dismiss",
            onClick: function () {
              setPrefs(Object.assign({}, prefs, { installHintDismissed: true }));
            } }, icon(I_X, 16))) : null,

        section({ className: "sec" },
          h(Eyebrow, { title: "Today", hint: rankedToday.length ? rankedToday.length + " open" : null }),
          rankedToday.length === 0 && doneToday.length === 0
            ? p({ className: "empty-note" }, "Nothing on today's list.")
            : div({ className: "tasks" }, rankedToday.concat(doneToday).map(function (t) {
                return h(TaskRow, {
                  key: t.id, task: t, today: today,
                  onToggle: function () { toggleTask(t.id); },
                  onDelete: function () { deleteTask(t.id); },
                  onOptions: function () { setEditingId(t.id); }
                });
              })),
          tasks.doneYesterday > 0
            ? p({ className: "tally" }, tasks.doneYesterday +
                (tasks.doneYesterday === 1 ? " task" : " tasks") + " done yesterday")
            : null),

        ["this_week", "this_month", "future"].map(function (b) {
          return h(BucketSection, {
            key: b, label: QD.BUCKET_LABEL[b], today: today,
            items: QD.inBucket(tasks.items, b),
            onToggle: toggleTask, onDelete: deleteTask, onOptions: setEditingId
          });
        }),

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
                  button({ className: "iconbtn", onClick: function () { deleteEvent(ev.id); },
                    "aria-label": "Delete event: " + ev.title }, icon(I_X, 16)));
              })),
          h("form", { className: "addrow", onSubmit: addEvent },
            input({ className: "field time", type: "time", value: evTime, "aria-label": "Event time",
              onChange: function (e) { setEvTime(e.target.value); } }),
            input({ className: "field", value: evTitle, placeholder: "Event", "aria-label": "Event title",
              enterKeyHint: "done", onChange: function (e) { setEvTitle(e.target.value); } }),
            button({ className: "btn", type: "submit", disabled: !evTime || !evTitle.trim(),
              "aria-label": "Add event" }, icon(I_PLUS, 18)))),

        section({ className: "sec" },
          h(Eyebrow, { title: "Habits", hint: "Last 7 days" }),
          div(null, HABITS.map(function (hab) {
            var on = !!((habits.days[today] || {})[hab.id]);
            return div({ className: "habit", key: hab.id },
              button({ className: "tapzone", onClick: function () { toggleHabit(hab.id); },
                "aria-pressed": on ? "true" : "false", "aria-label": hab.name + " today" },
                h(Check, { on: on }),
                span({ className: "name" }, hab.name, h("em", null, hab.sub))),
              div({ className: "dots", role: "img", "aria-label": weekLabel(habits, week, hab) },
                week.map(function (k, i) {
                  var lit = !!((habits.days[k] || {})[hab.id]);
                  return span({ key: k, className: "dot" + (lit ? " on" : "") + (i === 6 ? " today" : "") });
                })));
          }))),

        h(Markets, { data: markets,
          onSave: function (items) { setMarkets({ items: items, updatedAt: new Date().toISOString() }); } }),

        footer({ className: "foot" },
          p({ className: "note" },
            "Everything here is stored on this device and never leaves it. Unfinished tasks stay until you finish them; finished ones clear at midnight."),
          div({ className: "footrow" },
            button({ className: "linkbtn", onClick: function () { setBacking(true); } }, "Back up & restore"),
            button({ className: "linkbtn danger" + (armed ? " armed" : ""),
              onClick: function () { if (armed) { resetAll(); } else { setArmed(true); } },
              onBlur: function () { setArmed(false); } },
              armed ? "Tap again to erase everything" : "Reset all data")))),

      composer,
      dumping ? h(BrainDump, { onClose: function () { setDumping(false); },
        onAdd: function (lines) { addTasks(lines, "today", "should"); } }) : null,
      backing ? h(Backup, { onClose: function () { setBacking(false); },
        snapshot: snapshot, onRestore: restore }) : null,
      taskSheet);
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
