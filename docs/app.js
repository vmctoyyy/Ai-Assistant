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
  var I_BACK = "M15 19l-7-7 7-7";
  var I_DOTS = "M6 12h.01M12 12h.01M18 12h.01";
  var I_REPEAT = "M17 4l3 3-3 3M20 7H7a3 3 0 0 0-3 3v1M7 20l-3-3 3-3M4 17h13a3 3 0 0 0 3-3v-1";
  var I_DUMP = "M5 5h14M5 10h14M5 15h9M5 20h5";

  /* ---------- dates ---------- */
  var WD = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var WD3 = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MO3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function nzDate(d) { return WD3[d.getDay()] + " " + d.getDate() + " " + MO3[d.getMonth()]; }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  var todayKey = QD.todayKey, uid = QD.uid;

  /* ---------- fixed content ---------- */
  /* ---------- the six apps ----------
     Each tile's entire visual lives in this one array. To swap a placeholder
     for real artwork, give the entry an `img` and nothing else changes. */
  function strokes() {
    var d = Array.prototype.slice.call(arguments);
    return d.map(function (path, i) { return h("path", { key: i, d: path }); });
  }
  var APP_TILES = [
    { id: "tasks", name: "Tasks", tone: 1,
      draw: function () { return strokes("M5 12.5l4.2 4.2L19 7"); } },
    { id: "recap", name: "Recap", tone: 2,
      draw: function () {
        return [h("circle", { key: "c", cx: 12, cy: 12, r: 8 }),
                h("path", { key: "h", d: "M12 7.5V12l3 1.8" })];
      } },
    { id: "quotes", name: "Quotes", tone: 3,
      draw: function () { return strokes("M7 8.5h4v4a3.2 3.2 0 0 1-3.2 3.2",
                                         "M15 8.5h4v4a3.2 3.2 0 0 1-3.2 3.2"); } },
    { id: "shopping", name: "Shopping", tone: 4,
      draw: function () { return strokes("M5 8.5h14l-1.3 9.2a2 2 0 0 1-2 1.7H8.3a2 2 0 0 1-2-1.7z",
                                         "M9.2 8.5V6.8a2.8 2.8 0 0 1 5.6 0v1.7"); } },
    { id: "placeholder-1", name: "", tone: 5, placeholder: true,
      draw: function () { return strokes("M8.5 8.5l7 7", "M15.5 8.5l-7 7"); } },
    { id: "placeholder-2", name: "", tone: 5, placeholder: true,
      draw: function () { return strokes("M8.5 8.5l7 7", "M15.5 8.5l-7 7"); } }
  ];

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

  function normPrefs(v) {
    if (!v || typeof v !== "object") return blankPrefs();
    return {
      installHintDismissed: !!v.installHintDismissed,
      lastBriefShownOn: typeof v.lastBriefShownOn === "string" ? v.lastBriefShownOn : null,
      lastStaleAskOn: typeof v.lastStaleAskOn === "string" ? v.lastStaleAskOn : null
    };
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
          /* Keep focus where it is. Without this the composer's input blurs,
             its chip row unmounts, and the tap lands on nothing. */
          onMouseDown: function (e) { e.preventDefault(); },
          onClick: function () { props.onChange(o.value); }
        }, o.label);
      }));
  }
  function Toggle(props) {
    return button({
      type: "button", className: "togglebtn", role: "switch",
      "aria-checked": props.on ? "true" : "false",
      onMouseDown: function (e) { e.preventDefault(); },
      onClick: function () { props.onChange(!props.on); }
    },
      span({ className: "tick" + (props.on ? " on" : ""), "aria-hidden": "true" }, icon(I_CHECK, 13)),
      span({ className: "ticklabel" }, props.label));
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
    var due = QD.dueLabel(task.dueDate, task.dueTime, today);
    if (due && task.endTime) due = due.replace(task.dueTime, task.dueTime + "\u2013" + task.endTime);
    var fromHabit = QD.isHabitTask(task);
    /* Still hours off: on the list, but not asking to be read yet. */
    var waiting = QD.isWaiting(task, today, props.now);

    function down(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      /* Guarding on "button" made the swipe unreachable — the tap targets are
         buttons and cover the row. Only the icon button opts out. */
      if (e.target.closest(".iconbtn")) return;
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
    function tick() {
      if (moved.current) { moved.current = false; return; }
      props.onToggle();
    }
    function openOptions() {
      if (moved.current) { moved.current = false; return; }
      props.onOptions();
    }

    return div({ className: "rowwrap" + (offset < -8 ? " sliding" : "") },
      div({
        className: "row" + (done ? " done" : "") + (carry ? " carry" : "") +
          (waiting ? " waiting" : ""),
        style: {
          transform: "translateX(" + offset + "px)",
          transition: dragging.current ? "none" : "transform .18s ease"
        },
        onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up
      },
        /* Only the circle completes a task. The rest of the row opens its
           options, so a stray tap on the title cannot tick anything off. */
        button({
          className: "tickbtn", onClick: tick,
          "aria-pressed": done ? "true" : "false",
          "aria-label": (done ? "Mark not done: " : "Mark done: ") + task.title
        }, h(Check, { on: done })),
        button({
          className: "rowbody", onClick: openOptions,
          "aria-haspopup": "dialog",
          "aria-label": "Options for " + task.title
        },
          span({ className: "txt" },
            task.importance === "must" && !done
              ? span({ className: "mustdot", title: "Must-do", "aria-label": "Must-do" }) : null,
            /* Marked as coming from a habit, so it is clear the thing to edit
               is the standing arrangement rather than this one instance. */
            fromHabit ? span({ className: "habitmark", title: "From a habit",
              "aria-label": "From a habit" }, icon(I_REPEAT, 13)) : null,
            task.title,
            due ? span({ className: "duetag" }, due) : null,
            carry ? span({ className: "carrytag" }, "since " + QD.sinceLabel(task.firstTodayOn, today)) : null,
            task.notes ? span({ className: "notes" }, task.notes) : null)),
        button({
          className: "iconbtn", onClick: props.onDelete,
          "aria-label": "Delete: " + task.title
        }, icon(I_X, 17))
      )
    );
  }

  function segs(list, cls) {
    return list.map(function (seg, i) {
      return seg.em !== undefined
        ? span({ key: i, className: cls || "sh-title" }, seg.em)
        : span({ key: i }, seg.t);
    });
  }

  /* ---------- task options ---------- */
  function TaskSheet(props) {
    var task = props.task;
    var s1 = useState(task.title), title = s1[0], setTitle = s1[1];
    var s2 = useState(task.bucket), bucket = s2[0], setBucket = s2[1];
    var s3 = useState(task.importance), imp = s3[0], setImp = s3[1];
    var s4 = useState(task.notes || ""), notes = s4[0], setNotes = s4[1];
    var s5 = useState(false), armed = s5[0], setArmed = s5[1];
    var s6 = useState(!!task.dueDate), onDate = s6[0], setOnDate = s6[1];
    var s7 = useState(task.dueDate || props.today), date = s7[0], setDate = s7[1];
    var s8 = useState(!!task.dueTime), onTime = s8[0], setOnTime = s8[1];
    var s9 = useState(task.dueTime || "09:00"), time = s9[0], setTime = s9[1];
    var clean = title.trim();

    function save() {
      if (!clean) return;
      props.onSave({
        title: clean, bucket: bucket, importance: imp, notes: notes.trim(),
        dueDate: onDate ? date : null,
        dueTime: onTime ? time : null
      });
      props.onClose();
    }

    /* The same sheet builds a task and edits one. A task being made has
       nothing to delete, no history to report, and no calendar event worth
       exporting before it exists. */
    var isNew = !!props.isNew;

    return h(Sheet, {
      title: isNew ? "New task" : "Task options", onClose: props.onClose, footerSpread: true,
      footer: [
        isNew ? span({ key: "del" }) : button({
          key: "del",
          className: "linkbtn danger" + (armed ? " armed" : ""),
          onClick: function () {
            if (armed) { props.onDelete(); props.onClose(); } else { setArmed(true); }
          },
          onBlur: function () { setArmed(false); }
        }, armed ? "Tap again to delete" : "Delete"),
        div({ key: "acts", style: { display: "flex", gap: ".5rem" } },
          button({ className: "btn", onClick: props.onClose }, "Cancel"),
          button({ className: "btn primary", disabled: !clean, onClick: save },
            isNew ? "Add task" : "Save"))
      ]
    },
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
        !isNew && bucket !== task.bucket && bucket !== "today"
          ? span({ className: "fieldnote" }, "Moves off today's list.")
          : null,
        div({ className: "togglerow" },
          h(Toggle, { on: onDate, label: "Date", onChange: setOnDate }),
          onDate ? input({
            className: "field stamp", type: "date", value: date, "aria-label": "Date",
            onChange: function (e) { setDate(e.target.value); }
          }) : null),
        div({ className: "togglerow" },
          h(Toggle, { on: onTime, label: "Time", onChange: setOnTime }),
          onTime ? input({
            className: "field stamp", type: "time", value: time, "aria-label": "Time",
            onChange: function (e) { setTime(e.target.value); }
          }) : null),
        onDate || onTime
          ? span({ className: "fieldnote" },
              "Shown on the task. It stays in " + QD.BUCKET_LABEL[bucket].toLowerCase() + ".")
          : null,
        onTime && !isNew ? div({ className: "remindrow" },
          button({
            className: "btn small", type: "button",
            onClick: function () { props.onRemind({ dueDate: onDate ? date : null, dueTime: time }); }
          }, "Remind me 30 minutes before"),
          span({ className: "fieldnote" },
            "Adds a calendar event with a 30-minute alert, so it reaches you with the app closed.")
        ) : null),

      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "Note"),
        input({
          className: "field", value: notes, placeholder: "Optional",
          "aria-label": "Note", enterKeyHint: "done",
          onChange: function (e) { setNotes(e.target.value); }
        })),

      isNew ? null : p({ className: "addedline" }, QD.addedLabel(task.createdAt, props.today)));
  }

  /* ---------- morning brief ---------- */
  function Brief(props) {
    var today = props.today, items = props.items;
    var ranked = useMemo(function () { return QD.rankToday(items, today); }, [items, today]);
    var doneToday = useMemo(function () {
      return QD.completedInBucket(items, "today", today);
    }, [items, today]);
    var suggestions = useMemo(function () { return QD.pickSuggestions(items, today); }, [items, today]);
    var anchored = useMemo(function () { return QD.pickAnchored(items, today); }, [items, today]);
    var fixed = useMemo(function () { return QD.fixedPoints(items, today); }, [items, today]);
    var plan = useMemo(function () { return QD.planLine(items, today); }, [items, today]);
    var stale = useMemo(function () { return QD.pickStale(items, today, props.prefs); }, [items, today, props.prefs]);

    var fixedIds = {};
    fixed.forEach(function (t) { fixedIds[t.id] = true; });
    var loose = ranked.filter(function (t) { return !fixedIds[t.id]; });
    var carryIns = loose.filter(function (t) { return QD.isCarryIn(t, today); });
    var rest = loose.filter(function (t) { return !QD.isCarryIn(t, today); });
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

      plan ? p({ className: "starthere" }, segs(plan.lead)) : null,
      plan && plan.advice ? p({ className: "planadvice" }, segs(plan.advice)) : null,

      fixed.length ? section({ className: "sec" },
        h(Eyebrow, { title: fixed.length === 1 ? "Fixed point" : "Fixed points" }),
        div({ className: "tasks" }, fixed.map(row))) : null,

      carryIns.length ? section({ className: "sec carrysec" },
        h(Eyebrow, { title: "Carried over" }),
        div({ className: "tasks" }, carryIns.map(row))) : null,

      rest.length ? section({ className: "sec" },
        carryIns.length || fixed.length ? h(Eyebrow, { title: "The rest of today" }) : null,
        div({ className: "tasks" }, rest.map(row))) : null,

      doneToday.length ? section({ className: "sec" },
        h(Eyebrow, { title: "Done today" }),
        div({ className: "tasks" }, doneToday.map(row))) : null,

      anchored.length ? section({ className: "sec" },
        h(Eyebrow, { title: "Dated today" }),
        p({ className: "seclead" },
          anchored.length === 1
            ? "This is dated today but filed under " +
              QD.BUCKET_LABEL[anchored[0].bucket].toLowerCase() + "."
            : "These are dated today but filed elsewhere."),
        anchored.map(function (t) {
          var due = QD.dueLabel(t.dueDate, t.dueTime, today);
          return div({ className: "suggest", key: t.id },
            div({ className: "sg-title" },
              t.importance === "must" ? span({ className: "mustdot" }) : null, t.title,
              due ? span({ className: "duetag" }, due) : null),
            div({ className: "sg-acts" },
              button({ className: "btn small primary",
                onClick: function () { props.onPromote(t.id); } }, "Add to today"),
              button({ className: "btn small",
                onClick: function () { props.onNotToday(t.id); } }, "Not today")));
        })) : null,

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
      h2(null, props.title),
      div({ className: "sheetbody" }, props.children),
      props.footer ? div({ className: "sheetfoot" + (props.footerSpread ? " spread" : "") },
        props.footer) : null));
  }

  function BrainDump(props) {
    var st = useState(""), text = st[0], setText = st[1];
    var today = props.today;
    var parsed = useMemo(function () {
      return QD.parseBrainDump(text, today);
    }, [text, today]);

    return h(Sheet, {
      title: "Brain dump", onClose: props.onClose,
      footer: [
        button({ key: "c", className: "btn", onClick: props.onClose }, "Cancel"),
        button({
          key: "a", className: "btn primary", disabled: parsed.length === 0,
          onClick: function () { props.onAdd(parsed); props.onClose(); }
        }, parsed.length === 0 ? "Add tasks"
          : "Add " + parsed.length + (parsed.length === 1 ? " task" : " tasks"))
      ]
    },
      p(null, "One task per line. Times, dates and notes are picked up where it can."),
      textarea({
        className: parsed.length ? "short" : null,
        value: text, autoFocus: true, spellCheck: true,
        placeholder: "Ring the plumber\nMRI in Napier at 10:00, Tue 15 Sep. Add 18 Ossian Street to notes\nMust renew car insurance",
        onChange: function (e) { setText(e.target.value); }
      }),
      parsed.length ? div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "What it read"),
        div({ className: "preview" }, parsed.map(function (r, i) {
          var due = QD.dueLabelLong(r.dueDate, r.dueTime, today);
          return div({ className: "pv", key: i },
            div({ className: "pv-title" }, r.title),
            div({ className: "pv-meta" },
              due ? span({ className: "pv-tag when" }, due) : null,
              span({ className: "pv-tag" }, QD.BUCKET_LABEL[r.bucket]),
              r.importance !== "should"
                ? span({ className: "pv-tag" }, QD.IMPORTANCE_LABEL[r.importance]) : null),
            r.notes ? div({ className: "pv-note" }, r.notes) : null);
        }))) : null);
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
    return h(Sheet, {
      title: "Back up & restore", onClose: props.onClose,
      footer: [
        button({ key: "c", className: "btn", onClick: props.onClose }, "Close"),
        mode === "export"
          ? button({ key: "cp", className: "btn", onClick: copy }, "Copy")
          : null,
        mode === "export"
          ? button({ key: "dl", className: "btn primary", onClick: download }, "Save file")
          : button({ key: "rs", className: "btn primary", disabled: !paste.trim(),
              onClick: restore }, "Replace everything")
      ]
    },
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
      note ? p(null, note) : null);
  }

  /* ---------- home ---------- */
  function Home(props) {
    var d = QD.keyToDate(props.today);
    return div({ className: "home" + (props.anim ? " " + props.anim : "") },
      div({ className: "home-head" },
        div({ className: "hh-date" }, nzDate(d)),
        props.quote ? div({ className: "hh-quote" }, props.quote.text) : null),
      div({ className: "home-grid" }, APP_TILES.map(function (tile) {
        var art = h("svg", {
          className: "tile-art", viewBox: "0 0 24 24", fill: "none",
          stroke: "currentColor", strokeWidth: 1.4,
          strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
        }, tile.draw());
        if (tile.placeholder) {
          return div({ className: "tile tone" + tile.tone + " placeholder", key: tile.id,
            "aria-hidden": "true" }, art);
        }
        return button({
          className: "tile tone" + tile.tone, key: tile.id,
          onClick: function () { props.onOpen(tile.id); },
          "aria-label": tile.name
        }, art);
      })),
      props.warn ? div({ className: "home-warn", role: "status" }, props.warn) : null);
  }

  /* ---------- app screen shell ---------- */
  function Screen(props) {
    return div({ className: "screen" },
      div({ className: "bubble" + (props.anim ? " " + props.anim : "") },
        div({ className: "screen-top" },
          button({ className: "backbtn", onClick: props.onBack, "aria-label": "Back to home" },
            icon(I_BACK, 18), span(null, "Back")),
          props.title ? span({ className: "screen-title" }, props.title) : null),
        /* The body is the only scroller, so the composer sits on the bubble's
           bottom edge instead of floating over the content. */
        div({ className: "screen-body" }, props.children),
        props.footer || null));
  }

  /* ---------- quotes ---------- */
  function QuotesApp(props) {
    var s1 = useState(""), text = s1[0], setText = s1[1];
    var s2 = useState(""), source = s2[0], setSource = s2[1];
    var list = props.list, usingDefaults = !!(list[0] && list[0].builtIn);

    function add(e) {
      e.preventDefault();
      var t = text.trim();
      if (!t) return;
      props.onAdd(t, source.trim());
      setText(""); setSource("");
    }
    return h(Screen, { title: "Quotes", onBack: props.onBack, anim: props.anim },
      props.quote ? div({ className: "quote-today" },
        div({ className: "qt-text" }, props.quote.text),
        props.quote.source ? div({ className: "qt-source" }, props.quote.source) : null,
        div({ className: "qt-label" }, "Today")) : null,

      h("form", { className: "quote-add", onSubmit: add },
        input({ className: "field", value: text, placeholder: "Add a quote",
          "aria-label": "Quote", enterKeyHint: "done",
          onChange: function (e) { setText(e.target.value); } }),
        div({ className: "quote-add-row" },
          input({ className: "field", value: source, placeholder: "Who said it (optional)",
            "aria-label": "Source", enterKeyHint: "done",
            onChange: function (e) { setSource(e.target.value); } }),
          button({ className: "btn primary", type: "submit", disabled: !text.trim(),
            onMouseDown: function (e) { e.preventDefault(); } }, "Add"))),

      usingDefaults ? div({ className: "quote-note" },
        p(null, "These are the built-in quotes. Add one of your own and the list becomes yours, or start from these."),
        button({ className: "btn", onClick: props.onAdoptDefaults }, "Start from these")) : null,

      div({ className: "quote-list" }, list.map(function (q) {
        return div({ className: "quote-row", key: q.id },
          div({ className: "qr-body" },
            div({ className: "qr-text" }, q.text),
            q.source ? div({ className: "qr-source" }, q.source) : null),
          usingDefaults ? null : button({
            className: "iconbtn", onClick: function () { props.onDelete(q.id); },
            "aria-label": "Delete quote: " + q.text.slice(0, 40)
          }, icon(I_X, 17)));
      })));
  }

  /* ---------- recap ---------- */
  function RecapApp(props) {
    var days = props.days;
    var total = days.reduce(function (n, d) { return n + d.items.length; }, 0);
    return h(Screen, { title: "Recap", onBack: props.onBack, anim: props.anim },
      p({ className: "recap-lead" }, total === 0
        ? "Nothing finished in the last seven days."
        : total + (total === 1 ? " thing" : " things") + " finished in the last seven days."),
      days.map(function (d) {
        var dd = QD.keyToDate(d.date);
        var label = d.date === props.today ? "Today"
          : d.date === QD.shiftKey(props.today, -1) ? "Yesterday"
          : WD[dd.getDay()] + " " + dd.getDate() + " " + MO3[dd.getMonth()];
        return section({ className: "sec", key: d.date },
          h(Eyebrow, { title: label, hint: String(d.items.length) }),
          div({ className: "recap-day" }, d.items.map(function (it, i) {
            return div({ className: "recap-row", key: i },
              span({ className: "recap-tick" }, icon(I_CHECK, 14)),
              span({ className: "recap-title" }, it.title));
          })));
      }));
  }

  /* ---------- a heavier confirmation ----------
     Deliberately unlike the app's inline "tap again" affordances: both of
     these lose items for good, so they get a dialog that names what goes. */
  function Confirm(props) {
    return h(Sheet, {
      title: props.title, onClose: props.onClose,
      footer: [
        button({ key: "c", className: "btn", onClick: props.onClose }, "Keep it"),
        button({ key: "y", className: "btn danger", onClick: function () {
          props.onConfirm(); props.onClose();
        } }, props.confirmLabel)
      ]
    },
      div({ className: "confirm-body" },
        p({ className: "confirm-lead" }, props.lead),
        props.detail ? p({ className: "confirm-detail" }, props.detail) : null));
  }

  /* ---------- shopping carts ----------
     Its own component so typing an item name re-renders the form, not the
     list of items behind it. */
  function AddRow(props) {
    var st = useState(""), text = st[0], setText = st[1];
    function submit(e) {
      e.preventDefault();
      var v = text.trim();
      if (!v) return;
      props.onAdd(v);
      setText("");
      var el = e.currentTarget.querySelector("input");
      if (el) el.focus();
    }
    return h("form", { className: "shop-add", onSubmit: submit },
      input({ className: "field", value: text, placeholder: props.placeholder,
        "aria-label": props.placeholder, enterKeyHint: "done",
        onChange: function (e) { setText(e.target.value); } }),
      button({ className: "btn primary", type: "submit", disabled: !text.trim(),
        onMouseDown: function (e) { e.preventDefault(); } }, "Add"));
  }

  function ColourField(props) {
    return div({ className: "colour-field" },
      span({ className: "swatch", style: { background: props.value } }),
      input({ type: "color", value: props.value, className: "colour-input",
        "aria-label": "Colour",
        onChange: function (e) { props.onChange(e.target.value); } }),
      span({ className: "colour-hex" }, props.value.toUpperCase()));
  }

  function CartsApp(props) {
    var carts = props.carts;
    return h(Screen, { title: "Shopping", onBack: props.onBack, anim: props.anim },
      div({ className: "carts-top" },
        button({ className: "btn primary wide", onClick: props.onAddCart }, "Add cart"),
        button({ className: "linkbtn", onClick: props.onShops }, "Shops")),
      carts.length === 0
        ? p({ className: "empty-note", style: { padding: "0 1.125rem" } },
            "No carts yet. Add one for a shop you are heading to.")
        : div({ className: "cart-grid" }, carts.map(function (c) {
            var preview = QD.cartPreview(c, 5);
            var open = QD.cartOpenCount(c);
            return div({ className: "cart-bubble", key: c.id,
              style: { background: c.colour } },
              button({ className: "cart-open", onClick: function () { props.onOpen(c.id); },
                "aria-label": "Open " + c.shop },
                div({ className: "cart-head",
                  style: { color: QD.contrastInk(c.colour) } },
                  span({ className: "cart-shop" }, c.shop),
                  span({ className: "cart-count" }, open ? String(open) : "")),
                div({ className: "cart-inner" },
                  preview.length
                    ? preview.map(function (i, n) {
                        return div({ className: "cart-line", key: n }, i.text);
                      })
                    : div({ className: "cart-line empty" }, "Empty"))),
              button({ className: "cart-menu", onClick: function () { props.onRemove(c.id); },
                style: { color: QD.contrastInk(c.colour) },
                "aria-label": "Remove cart: " + c.shop }, icon(I_DOTS, 18)));
          })));
  }

  function CartScreen(props) {
    var cart = props.cart;
    var ink = QD.contrastInk(cart.colour);
    var open = cart.items.filter(function (i) { return !i.checked; });
    var got = cart.items.filter(function (i) { return i.checked; });
    function row(i) {
      return div({ className: "row" + (i.checked ? " done" : ""), key: i.id },
        button({ className: "tickbtn", onClick: function () { props.onToggle(i.id); },
          "aria-pressed": i.checked ? "true" : "false",
          "aria-label": (i.checked ? "Put back: " : "Got: ") + i.text },
          h(Check, { on: i.checked })),
        span({ className: "rowbody" }, span({ className: "txt" }, i.text)),
        button({ className: "iconbtn", onClick: function () { props.onDelete(i.id); },
          "aria-label": "Delete: " + i.text }, icon(I_X, 17)));
    }
    return div({ className: "screen" },
      div({ className: "bubble cart-full" + (props.anim ? " " + props.anim : "") },
        div({ className: "cart-banner", style: { background: cart.colour, color: ink } },
          button({ className: "backbtn", onClick: props.onBack, style: { color: ink },
            "aria-label": "Back to carts" }, icon(I_BACK, 18), span(null, "Carts")),
          span({ className: "cart-banner-name" }, cart.shop),
          button({ className: "iconbtn", onClick: props.onEmpty, style: { color: ink },
            "aria-label": "Empty cart" }, icon(I_DOTS, 18))),
        div({ className: "screen-body" },
          div({ className: "cart-pad" },
            open.length === 0 && got.length === 0
              ? p({ className: "empty-note" }, "Nothing in this cart yet.")
              : null,
            open.length ? div({ className: "tasks" }, open.map(row)) : null,
            got.length ? section({ className: "sec", style: { paddingTop: "1.25rem" } },
              h(Eyebrow, { title: "Got", hint: String(got.length) }),
              div({ className: "tasks" }, got.map(row)),
              p({ className: "note", style: { paddingTop: ".75rem" } },
                "Ticked things clear at midnight.")) : null)),
        h(AddRow, { placeholder: "Add an item", onAdd: props.onAdd })));
  }

  function AddCartSheet(props) {
    var s1 = useState(""), name = s1[0], setName = s1[1];
    var s2 = useState(QD.CART_FALLBACK), colour = s2[0], setColour = s2[1];
    var s3 = useState(false), keep = s3[0], setKeep = s3[1];
    var shops = props.shops;
    return h(Sheet, {
      title: "Add a cart", onClose: props.onClose,
      footer: [
        button({ key: "c", className: "btn", onClick: props.onClose }, "Cancel"),
        button({ key: "a", className: "btn primary", disabled: !name.trim(),
          onMouseDown: function (e) { e.preventDefault(); },
          onClick: function () { props.onCreate(name.trim(), colour, keep); props.onClose(); } },
          "Create cart")
      ]
    },
      shops.length ? div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, "A shop you have saved"),
        div({ className: "shop-chips" }, shops.map(function (sh) {
          return button({ key: sh.id, className: "shop-chip",
            style: { background: sh.colour, color: QD.contrastInk(sh.colour) },
            onClick: function () { props.onCreate(sh.name, sh.colour); props.onClose(); } },
            sh.name);
        }))) : null,
      div({ className: "sheetfield" },
        span({ className: "fieldlabel" }, shops.length ? "Or a one-off shop" : "Shop"),
        input({ className: "field", value: name, placeholder: "Shop name",
          "aria-label": "Shop name", enterKeyHint: "done",
          onChange: function (e) { setName(e.target.value); } }),
        h(ColourField, { value: colour, onChange: setColour }),
        div({ className: "togglerow" },
          h(Toggle, { on: keep, label: "Save this shop for next time",
            onChange: setKeep })),
        span({ className: "fieldnote" }, keep
          ? "It will be waiting as a chip next time you add a cart."
          : "A one-off — it will not appear in your saved shops.")),
      div({ className: "sheetfield" },
        button({ className: "linkbtn", onClick: function () { props.onClose(); props.onShops(); } },
          "Manage saved shops")));
  }

  function ShopsApp(props) {
    var s1 = useState(""), name = s1[0], setName = s1[1];
    var s2 = useState(QD.CART_FALLBACK), colour = s2[0], setColour = s2[1];
    var s3 = useState(null), armed = s3[0], setArmed = s3[1];
    var s4 = useState(null), editing = s4[0], setEditing = s4[1];
    return h(Screen, { title: "Shops", onBack: props.onBack, anim: props.anim },
      div({ className: "cart-pad" },
        p({ className: "note", style: { marginBottom: "1.25rem" } },
          "A saved shop is a starting point. Changing one here never changes a cart you have already made."),
        h("form", { className: "shop-new", onSubmit: function (e) {
          e.preventDefault();
          if (!name.trim()) return;
          props.onAdd(name.trim(), colour);
          setName(""); setColour(QD.CART_FALLBACK);
        } },
          input({ className: "field", value: name, placeholder: "Shop name",
            "aria-label": "New shop name", enterKeyHint: "done",
            onChange: function (e) { setName(e.target.value); } }),
          div({ className: "shop-new-row" },
            h(ColourField, { value: colour, onChange: setColour }),
            button({ className: "btn primary", type: "submit", disabled: !name.trim(),
              onMouseDown: function (e) { e.preventDefault(); } }, "Save shop"))),

        props.shops.length === 0
          ? p({ className: "empty-note" }, "No saved shops yet.")
          : div({ className: "shop-list" }, props.shops.map(function (sh) {
              var isEditing = editing === sh.id;
              return div({ className: "shop-row", key: sh.id },
                isEditing
                  ? div({ className: "shop-edit" },
                      input({ className: "field", defaultValue: sh.name,
                        "aria-label": "Rename " + sh.name, enterKeyHint: "done",
                        onChange: function (e) { props.onRename(sh.id, e.target.value); } }),
                      h(ColourField, { value: sh.colour,
                        onChange: function (v) { props.onRecolour(sh.id, v); } }),
                      button({ className: "btn", onClick: function () { setEditing(null); } }, "Done"))
                  : h(React.Fragment, null,
                      span({ className: "swatch big", style: { background: sh.colour } }),
                      span({ className: "shop-name" }, sh.name),
                      button({ className: "linkbtn", onClick: function () { setEditing(sh.id); } }, "Edit"),
                      button({ className: "linkbtn danger" + (armed === sh.id ? " armed" : ""),
                        onClick: function () {
                          if (armed === sh.id) { props.onDelete(sh.id); setArmed(null); }
                          else { setArmed(sh.id); }
                        },
                        onBlur: function () { setArmed(null); } },
                        armed === sh.id ? "Tap again" : "Delete")));
            }))));
  }

  /* ---------- bucket section ---------- */
  function BucketSection(props) {
    var st = useState(false), expanded = st[0], setExpanded = st[1];
    var openItems = props.items, done = props.done || [];
    var list = openItems.concat(done);
    var count = openItems.length
      ? String(openItems.length)
      : (done.length ? "all done" : "empty");
    return section({ className: "sec" },
      button({ className: "disc", onClick: function () { setExpanded(!expanded); },
        "aria-expanded": expanded ? "true" : "false" },
        span({ className: "lbl" }, props.label),
        span({ style: { display: "flex", alignItems: "center", gap: ".625rem" } },
          span({ className: "meta" }, count),
          span({ className: "chev" + (expanded ? " open" : "") }, icon(I_CHEV, 18)))),
      expanded && list.length
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

  /* ---------- habits ---------- */
  var REC_OPTS = [
    { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" }, { value: "dates", label: "Dates" }
  ];
  /* Monday first: the week reads Mon–Sun even though the model counts from
     Sunday, so the picker matches the summary line. */
  var DAY_PICKS = [1, 2, 3, 4, 5, 6, 0];

  function blankSlot() {
    return { id: uid(), recurrence: "weekly", daysOfWeek: [], dayOfMonth: 1,
             monthsOfYear: [], specificDates: [], startTime: "09:00", endTime: "" };
  }
  function slotToDraft(s) {
    return { id: s.id, recurrence: s.recurrence,
             daysOfWeek: s.daysOfWeek.slice(), dayOfMonth: s.dayOfMonth || 1,
             monthsOfYear: s.monthsOfYear.slice(), specificDates: s.specificDates.slice(),
             startTime: s.startTime, endTime: s.endTime || "" };
  }

  /* One slot's editor. Only the fields the chosen recurrence actually uses
     are shown — a weekly slot has no business asking for a month. */
  function SlotEditor(props) {
    var slot = props.slot, onChange = props.onChange;
    function set(patch) { onChange(Object.assign({}, slot, patch)); }
    function toggleIn(list, v) {
      return list.indexOf(v) >= 0
        ? list.filter(function (x) { return x !== v; })
        : list.concat([v]);
    }
    var bad = !QD.normSlot(slot);

    return div({ className: "slot" + (bad ? " slot-bad" : "") },
      div({ className: "slot-top" },
        span({ className: "slot-n" }, props.label),
        props.onRemove ? button({
          className: "iconbtn", type: "button", onClick: props.onRemove,
          "aria-label": "Remove " + props.label
        }, icon(I_X, 16)) : null),

      h(Chips, { label: "Repeats", options: REC_OPTS, value: slot.recurrence,
        onChange: function (v) { set({ recurrence: v }); } }),

      slot.recurrence === "weekly" ? div({ className: "daypick", role: "group",
        "aria-label": "Days of the week" },
        DAY_PICKS.map(function (n) {
          var on = slot.daysOfWeek.indexOf(n) >= 0;
          return button({
            key: n, type: "button", className: "day" + (on ? " on" : ""),
            "aria-pressed": on ? "true" : "false", "aria-label": WD[n],
            onMouseDown: function (e) { e.preventDefault(); },
            onClick: function () { set({ daysOfWeek: toggleIn(slot.daysOfWeek, n) }); }
          }, WD3[n].slice(0, 2));
        })) : null,

      slot.recurrence === "monthly" || slot.recurrence === "yearly"
        ? div({ className: "slot-row" },
            h("label", { className: "slot-lab" }, "Day of the month"),
            input({ className: "field num", type: "number", min: 1, max: 31,
              value: slot.dayOfMonth, "aria-label": "Day of the month",
              onChange: function (e) { set({ dayOfMonth: e.target.value }); } }))
        : null,

      slot.recurrence === "yearly" ? div({ className: "monthpick", role: "group",
        "aria-label": "Months" },
        MO3.map(function (m, i) {
          var on = slot.monthsOfYear.indexOf(i + 1) >= 0;
          return button({
            key: m, type: "button", className: "day mon" + (on ? " on" : ""),
            "aria-pressed": on ? "true" : "false", "aria-label": m,
            onMouseDown: function (e) { e.preventDefault(); },
            onClick: function () { set({ monthsOfYear: toggleIn(slot.monthsOfYear, i + 1) }); }
          }, m);
        })) : null,

      slot.recurrence === "dates" ? div({ className: "datepick" },
        slot.specificDates.map(function (d) {
          return div({ className: "datechip", key: d },
            span(null, QD.dueLabelLong(d, null, props.today)),
            button({ className: "iconbtn", type: "button", "aria-label": "Remove " + d,
              onClick: function () {
                set({ specificDates: slot.specificDates.filter(function (x) { return x !== d; }) });
              } }, icon(I_X, 15)));
        }),
        div({ className: "slot-row" },
          input({ className: "field", type: "date", value: props.draftDate || "",
            "aria-label": "Add a date",
            onChange: function (e) { props.onDraftDate(e.target.value); } }),
          button({ className: "btn", type: "button", disabled: !props.draftDate,
            onMouseDown: function (e) { e.preventDefault(); },
            onClick: function () {
              if (!props.draftDate) return;
              set({ specificDates: slot.specificDates.concat([props.draftDate]) });
              props.onDraftDate("");
            } }, "Add date"))) : null,

      div({ className: "slot-row" },
        h("label", { className: "slot-lab" }, "Starts"),
        input({ className: "field", type: "time", value: slot.startTime,
          "aria-label": "Start time",
          onChange: function (e) { set({ startTime: e.target.value }); } })),
      div({ className: "slot-row" },
        h("label", { className: "slot-lab" }, "Ends",
          slot.endTime ? null : span({ className: "opt" }, "optional")),
        input({ className: "field", type: "time", value: slot.endTime,
          "aria-label": "End time",
          onChange: function (e) { set({ endTime: e.target.value }); } }),
        slot.endTime ? button({ className: "linkbtn", type: "button",
          onMouseDown: function (e) { e.preventDefault(); },
          onClick: function () { set({ endTime: "" }); } }, "Clear") : null),

      bad ? p({ className: "slot-warn" }, props.slot.recurrence === "weekly"
        ? "Pick at least one day."
        : (props.slot.recurrence === "dates" ? "Add at least one date."
          : (props.slot.recurrence === "yearly" ? "Pick at least one month and a day."
            : "Give this a day of the month."))) : null);
  }

  /* Add or edit one habit. The preview line is the same summary the list
     shows, so what will be saved is legible before it is. */
  function HabitSheet(props) {
    var habit = props.habit;
    var s1 = useState(habit ? habit.name : ""), name = s1[0], setName = s1[1];
    var s2 = useState(habit ? habit.importance : "should"), imp = s2[0], setImp = s2[1];
    var s3 = useState(function () {
      return habit ? habit.schedule.map(slotToDraft) : [blankSlot()];
    }), slots = s3[0], setSlots = s3[1];
    var s4 = useState(""), draftDate = s4[0], setDraftDate = s4[1];
    var s5 = useState(false), armed = s5[0], setArmed = s5[1];
    var clean = name.trim();

    var built = useMemo(function () {
      return QD.makeHabit(clean || "Untitled", {
        id: habit ? habit.id : undefined,
        importance: imp, active: habit ? habit.active : true,
        schedule: slots, now: habit ? habit.createdAt : Date.now()
      });
    }, [clean, imp, slots, habit]);
    var usable = slots.filter(function (s) { return !!QD.normSlot(s); }).length;
    var canSave = !!clean && usable === slots.length && usable > 0;

    function setSlot(i, next) {
      setSlots(slots.map(function (s, j) { return j === i ? next : s; }));
    }
    return h(Sheet, {
      title: habit ? "Edit habit" : "New habit", onClose: props.onClose,
      footerSpread: true,
      footer: [
        habit ? button({
          key: "del", className: "btn danger" + (armed ? " armed" : ""),
          onClick: function () {
            if (armed) { props.onDelete(habit.id); props.onClose(); } else setArmed(true);
          },
          onBlur: function () { setArmed(false); }
        }, armed ? "Tap again to remove" : "Remove") : span({ key: "sp" }),
        button({ key: "save", className: "btn primary", disabled: !canSave,
          onClick: function () {
            if (!canSave || !built) return;
            props.onSave(built);
            props.onClose();
          } }, "Save")
      ]
    },
      div({ className: "sheetfield" },
        h("label", { className: "sheetlab", htmlFor: "habit-name" }, "NAME"),
        input({ id: "habit-name", className: "field", value: name,
          placeholder: "Gym", "aria-label": "Habit name", enterKeyHint: "done",
          onChange: function (e) { setName(e.target.value); } })),

      div({ className: "sheetfield" },
        h("label", { className: "sheetlab" }, "IMPORTANCE"),
        h(Chips, { label: "Importance", options: IMP_OPTS, value: imp, onChange: setImp })),

      div({ className: "sheetfield" },
        h("label", { className: "sheetlab" }, "WHEN"),
        slots.map(function (s, i) {
          return h(SlotEditor, {
            key: s.id, slot: s, today: props.today,
            label: slots.length > 1 ? "Time " + (i + 1) : "Schedule",
            draftDate: draftDate, onDraftDate: setDraftDate,
            onChange: function (next) { setSlot(i, next); },
            onRemove: slots.length > 1 ? function () {
              setSlots(slots.filter(function (x, j) { return j !== i; }));
            } : null
          });
        }),
        button({ className: "btn", type: "button",
          onMouseDown: function (e) { e.preventDefault(); },
          onClick: function () { setSlots(slots.concat([blankSlot()])); }
        }, "+ Add another time")),

      built ? p({ className: "habit-preview" },
        "Saves as: " + QD.habitSummary(built)) : null);
  }

  function HabitsApp(props) {
    var list = props.habits;
    return h(Screen, { title: "Habits", onBack: props.onBack, anim: props.anim },
      div({ className: "habit-lead" },
        button({ className: "btn", onClick: function () { props.onEdit("new"); } },
          icon(I_PLUS, 16), span(null, "Add habit"))),

      list.length === 0
        ? div({ className: "habit-empty" },
            p(null, "Nothing here yet."),
            p({ className: "muted" },
              "A habit is a standing arrangement — the gym on Tuesdays, the rubbish on Wednesday nights. Each morning the ones that fall on that day put themselves on your list."),
            p({ className: "muted" },
              "One or two is a good place to start. The whole week at once tends to become another thing to keep up with."))
        : div({ className: "habit-list" }, list.map(function (hb) {
            var on = QD.habitSlotsOn(hb, props.today).length > 0;
            var next = hb.active && !on ? QD.nextHabitDay(hb, QD.shiftKey(props.today, 1)) : null;
            return div({ className: "habit-bubble" + (hb.active ? "" : " paused"), key: hb.id },
              button({ className: "habit-body",
                onClick: function () { props.onEdit(hb.id); },
                "aria-label": "Edit habit: " + hb.name },
                div({ className: "habit-name" }, hb.name,
                  hb.active ? null : span({ className: "habit-tag" }, "Paused")),
                div({ className: "habit-when" }, QD.habitSummary(hb)),
                div({ className: "habit-meta" },
                  hb.importance === "must" ? span({ className: "imp-must" }, "Must") : null,
                  hb.active
                    ? span(null, on ? "On today's list"
                        : (next ? "Next on " + QD.dueLabelLong(next, null, props.today) : "Not scheduled"))
                    : span(null, "Not generating tasks"))),
              button({
                className: "habit-toggle" + (hb.active ? " on" : ""),
                "aria-pressed": hb.active ? "true" : "false",
                "aria-label": (hb.active ? "Pause" : "Resume") + " " + hb.name,
                onClick: function () { props.onSetActive(hb.id, !hb.active); }
              }, hb.active ? "On" : "Off"));
          })),

      list.length
        ? p({ className: "habit-foot" },
            "Pausing keeps a habit and its schedule but stops it adding anything. Ticking off a day's task is just that day.")
        : null);
  }

  /* ---------- app ---------- */
  function App() {
    var s0 = useState(true), loading = s0[0], setLoading = s0[1];
    var s1 = useState(null), warn = s1[0], setWarn = s1[1];
    var s2 = useState(todayKey()), today = s2[0], setToday = s2[1];
    var s3 = useState(function () { return { version: 2, items: [], doneYesterday: 0, lastRollOn: todayKey() }; });
    var tasks = s3[0], setTasksRaw = s3[1];
    var s4 = useState(QD.blankRecap), recap = s4[0], setRecapRaw = s4[1];
    var s5 = useState(function () { return { list: [] }; }), quotes = s5[0], setQuotesRaw = s5[1];
    var s6 = useState(QD.blankCarts), carts = s6[0], setCartsRaw = s6[1];
    var sH = useState(QD.blankHabits), habits = sH[0], setHabitsRaw = sH[1];
    var sHE = useState(null), editingHabit = sHE[0], setEditingHabit = sHE[1];
    var sHF = useState("home"), habitsFrom = sHF[0], setHabitsFrom = sHF[1];
    var sC = useState(null), openCartId = sC[0], setOpenCartId = sC[1];
    var sA = useState(false), addingCart = sA[0], setAddingCart = sA[1];
    var sX = useState(null), confirming = sX[0], setConfirming = sX[1];
    /* Markets, Schedule and Habits are gone from the UI. Their keys are read
       once and carried untouched so a backup still round-trips them and the
       data is here if any comes back. */
    var sR = useState({}), retired = sR[0], setRetired = sR[1];
    var s7 = useState(blankPrefs), prefs = s7[0], setPrefsRaw = s7[1];
    var s8 = useState(""), quick = s8[0], setQuick = s8[1];
    var quickRef = useRef("");
    quickRef.current = quick;
    var s9 = useState(false), composerOpen = s9[0], setComposerOpen = s9[1];
    /* The footer rests as a three-button bar and becomes the quick-add
       composer on demand. */
    var sAdd = useState(false), adding = sAdd[0], setAdding = sAdd[1];
    var addRef = useRef(null);
    /* A task being built in the full sheet, before it exists. */
    var sD = useState(null), draft = sD[0], setDraft = sD[1];
    var s10 = useState("today"), addBucket = s10[0], setAddBucket = s10[1];
    var s11 = useState("should"), addImp = s11[0], setAddImp = s11[1];
    var s12 = useState(false), dumping = s12[0], setDumping = s12[1];
    var s13 = useState(false), backing = s13[0], setBacking = s13[1];
    var s16 = useState(false), armed = s16[0], setArmed = s16[1];
    var s17 = useState(nowMinutes()), clock = s17[0], setClock = s17[1];
    var s18 = useState(false), briefOpen = s18[0], setBriefOpen = s18[1];
    var s19 = useState(null), editingId = s19[0], setEditingId = s19[1];
    var s20 = useState("home"), route = s20[0], setRoute = s20[1];
    var s21 = useState(""), build = s21[0], setBuild = s21[1];
    /* Which way the last move went, so the incoming screen animates like iOS:
       an app comes forward, screens inside push and pop, home settles back. */
    var s22 = useState({ anim: "a-in", n: 0 }), nav = s22[0], setNav = s22[1];
    var go = useCallback(function (anim, fn) {
      setNav(function (prev) { return { anim: anim, n: prev.n + 1 }; });
      fn();
    }, []);

    var setTasks    = useCallback(function (v) { setTasksRaw(v);    save("tasks", v); }, []);
    var setRecap    = useCallback(function (v) { setRecapRaw(v);    save("recap", v); }, []);
    var setQuotes   = useCallback(function (v) { setQuotesRaw(v);   save("quotes", v); }, []);
    var setCarts    = useCallback(function (v) { setCartsRaw(v);    save("carts", v); }, []);
    /* habitsv2, not habits: the old toggle app's dot history still sits under
       `habits` and is carried untouched. */
    var setHabits   = useCallback(function (v) { setHabitsRaw(v);   save("habitsv2", v); }, []);
    var setPrefs    = useCallback(function (v) { setPrefsRaw(v);    save("prefs", v); }, []);

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
            readKey("tasks", null), readKey("prefs", null),
            readKey("recap", null), readKey("quotes", null), readKey("shopping", null),
            readKey("carts", null),
            readKey("habits", null), readKey("markets", null), readKey("schedule", null),
            readKey("habitsv2", null)
          ]).then(function (res) {
            if (cancelled) return;
            var t = QD.migrate(res[0], day);
            var rc = QD.normRecap(res[2]);
            /* A day has turned since last open: file the finished work away
               before rollDay clears it, so Recap keeps the history. */
            if (t.lastRollOn !== day) {
              rc = QD.pruneRecap(QD.archiveCompleted(rc, t.items, t.lastRollOn), day);
            }
            t = QD.rollDay(t, day);
            /* Habits mint their instances on open, after the rollover has
               cleared yesterday's — a PWA gets no time to run while closed,
               so this is the only moment the day's routine can appear. */
            var hb = QD.generateHabitTasks(QD.normHabits(res[9]), t.items, day);
            t = { version: 2, items: hb.items, doneYesterday: t.doneYesterday,
                  lastRollOn: t.lastRollOn };
            var pf = normPrefs(res[1]);

            setToday(day);
            setTasksRaw(t);
            setHabitsRaw(hb.habits);
            setRecapRaw(rc);
            setQuotesRaw(QD.normQuotes(res[3]));
            /* Carts absorb the old flat shopping list on first run. */
            var ct = QD.sweepCarts(QD.normCarts(res[5], QD.normShopping(res[4])), day);
            setCartsRaw(ct);
            setRetired({ habits: res[6], markets: res[7], schedule: res[8],
                         shopping: res[4] });
            setPrefsRaw(pf);
            store.ready = store.mode !== "none";
            setLoading(false);
            save("tasks", t);
            save("recap", rc);
            save("carts", ct);
            save("habitsv2", hb.habits);
          });
        })
        .catch(function () {
          if (cancelled) return;
          setWarn("Your saved data could not be read. Nothing has been deleted — close the app and open it again to retry.");
          store.ready = false;
          setLoading(false);
        });

      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      /* Read the version actually being served rather than a constant that
         can drift from the service worker. On a first install the cache does
         not exist yet at boot, so ask again once the worker is ready. */
      function readBuild() {
        if (!window.caches || !caches.keys) return;
        caches.keys().then(function (names) {
          if (cancelled) return;
          var mine = names.filter(function (n) { return n.indexOf("quiet-desk-") === 0; });
          if (mine.length) setBuild(mine.sort().pop().replace("quiet-desk-", ""));
        }).catch(function () {});
      }
      readBuild();
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(readBuild).catch(function () {});
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

    /* local midnight rollover — the day's finished work is archived first */
    useEffect(function () {
      if (loading) return;
      var now = todayKey();
      if (now === today) return;
      setToday(now);
      setRecap(QD.pruneRecap(QD.archiveCompleted(recap, tasks.items, today), now));
      var rolled = QD.rollDay(tasks, now);
      var minted = QD.generateHabitTasks(habits, rolled.items, now);
      setTasks({ version: 2, items: minted.items, doneYesterday: rolled.doneYesterday,
                 lastRollOn: rolled.lastRollOn });
      setHabits(minted.habits);
      setCarts(QD.sweepCarts(carts, now));
      /* lastBriefShownOn is deliberately left on yesterday, so the first
         visit to Tasks after midnight still opens the brief. */
    }, [clock, today, loading, tasks, recap, carts, habits,
        setTasks, setRecap, setCarts, setHabits]);

    /* ---- task actions ---- */
    function commit(items) {
      setTasks({ version: 2, items: items, doneYesterday: tasks.doneYesterday, lastRollOn: tasks.lastRollOn });
    }
    function patch(id, changes) {
      commit(tasks.items.map(function (t) {
        return t.id === id ? QD.applyPatch(t, changes, today) : t;
      }));
    }
    function addParsed(specs) {
      /* Stagger createdAt so a batch keeps the order it was typed in —
         identical timestamps would fall through to the random id tie-break. */
      var base = Date.now();
      var made = specs.map(function (r, i) {
        return QD.makeTask(r.title, {
          bucket: r.bucket, importance: r.importance, today: today, now: base + i,
          notes: r.notes, dueDate: r.dueDate, dueTime: r.dueTime
        });
      });
      commit(tasks.items.concat(made));
    }
    function addTasks(titles, bucket, importance) {
      var base = Date.now();
      var made = titles.map(function (title, i) {
        return QD.makeTask(title, {
          bucket: bucket || "today", importance: importance || "should",
          today: today, now: base + i
        });
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

    /* ---- quotes ---- */
    function addQuote(text, source) {
      setQuotes({ list: quotes.list.concat([{ id: QD.uid(), text: text, source: source || "" }]) });
    }
    function deleteQuote(id) {
      setQuotes({ list: quotes.list.filter(function (q) { return q.id !== id; }) });
    }
    function adoptDefaults() {
      setQuotes({ list: QD.DEFAULT_QUOTES.map(function (q) {
        return { id: QD.uid(), text: q.text, source: q.source };
      }) });
    }

    /* ---- carts ---- */
    function putCarts(list) {
      setCarts({ carts: list, shops: carts.shops, lastSweptOn: carts.lastSweptOn });
    }
    function putShops(list) {
      setCarts({ carts: carts.carts, shops: list, lastSweptOn: carts.lastSweptOn });
    }
    function mapCart(id, fn) {
      putCarts(carts.carts.map(function (c) { return c.id === id ? fn(c) : c; }));
    }
    /* One write, not two: saving the shop and creating the cart both change
       the same record, so a second setCarts would drop the first. */
    function createCart(shop, colour, alsoSave) {
      var made = QD.makeCart(shop, colour);
      setCarts({
        carts: carts.carts.concat([made]),
        shops: alsoSave ? QD.addShopIfNew(carts.shops, made.shop, made.colour) : carts.shops,
        lastSweptOn: carts.lastSweptOn
      });
      go("a-push", function () { setOpenCartId(made.id); });
    }
    function removeCart(id) {
      putCarts(carts.carts.filter(function (c) { return c.id !== id; }));
      if (openCartId === id) setOpenCartId(null);
    }
    function addCartItem(id, text) {
      mapCart(id, function (c) {
        return Object.assign({}, c, { items: c.items.concat([
          { id: QD.uid(), text: text, checked: false, checkedAt: null }]) });
      });
    }
    function toggleCartItem(id, itemId) {
      mapCart(id, function (c) {
        return Object.assign({}, c, { items: c.items.map(function (i) {
          if (i.id !== itemId) return i;
          var next = !i.checked;
          return { id: i.id, text: i.text, checked: next,
                   checkedAt: next ? Date.now() : null };
        }) });
      });
    }
    function deleteCartItem(id, itemId) {
      mapCart(id, function (c) {
        return Object.assign({}, c, {
          items: c.items.filter(function (i) { return i.id !== itemId; }) });
      });
    }
    function emptyCart(id) {
      mapCart(id, function (c) { return Object.assign({}, c, { items: [] }); });
    }
    function addShop(name, colour) {
      putShops(carts.shops.concat([{ id: QD.uid(), name: name, colour: colour }]));
    }
    function renameShop(id, name) {
      putShops(carts.shops.map(function (sh) {
        return sh.id === id ? { id: sh.id, name: name, colour: sh.colour } : sh;
      }));
    }
    function recolourShop(id, colour) {
      putShops(carts.shops.map(function (sh) {
        return sh.id === id ? { id: sh.id, name: sh.name, colour: colour } : sh;
      }));
    }
    function deleteShop(id) {
      putShops(carts.shops.filter(function (sh) { return sh.id !== id; }));
    }

    /* No push server exists for a static site, so a reminder is a real
       calendar event with a 30-minute alarm — which fires with the app shut. */
    function remind(task, when) {
      var subject = QD.applyPatch(task, when, today);
      var ics = QD.buildICS(subject, today);
      if (!ics) return;
      var name = (task.title || "reminder").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reminder";
      var blob = new Blob([ics], { type: "text/calendar" });
      try {
        var file = new File([blob], name + ".ics", { type: "text/calendar" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: task.title }).catch(function () {});
          return;
        }
      } catch (e) { /* File unsupported: fall through to a download */ }
      try {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = name + ".ics";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      } catch (e2) {
        setWarn("This browser would not hand over the calendar file. Add the time to your calendar by hand.");
      }
    }

    /* ---- habit actions ----
       Saving a habit mints anything it has already missed today: the ledger
       is keyed per slot, so a habit added at nine on a Wednesday still puts
       its Wednesday task up rather than waiting until tomorrow. */
    function commitHabits(list, gen) {
      var next = { habits: list, gen: gen || habits.gen, lastGenOn: null };
      var minted = QD.generateHabitTasks(next, tasks.items, today);
      setHabits(minted.habits);
      if (minted.added.length) {
        setTasks({ version: 2, items: minted.items,
                   doneYesterday: tasks.doneYesterday, lastRollOn: tasks.lastRollOn });
      }
    }
    function saveHabit(habit) {
      var exists = habits.habits.some(function (hb) { return hb.id === habit.id; });
      commitHabits(exists
        ? habits.habits.map(function (hb) { return hb.id === habit.id ? habit : hb; })
        : habits.habits.concat([habit]));
    }
    function setHabitActive(id, active) {
      commitHabits(habits.habits.map(function (hb) {
        return hb.id === id ? Object.assign({}, hb, { active: active }) : hb;
      }));
    }
    /* Removing a habit takes its ledger entries with it, so a habit added
       back under a new id is not held back by the old one's record. Tasks it
       already minted are left on today's list — they are the user's now. */
    function deleteHabit(id) {
      var gen = {};
      Object.keys(habits.gen).forEach(function (k) {
        if (k.split(":")[0] !== id) gen[k] = habits.gen[k];
      });
      commitHabits(habits.habits.filter(function (hb) { return hb.id !== id; }), gen);
    }

    /* Clears the apps that are live. Retired keys are deliberately left
       alone — the old toggle app's habit history is meant to survive. */
    function resetAll() {
      var day = todayKey();
      setTasks({ version: 2, items: [], doneYesterday: 0, lastRollOn: day });
      setRecap(QD.blankRecap());
      setCarts(QD.blankCarts());
      setQuotes({ list: [] });
      setHabits(QD.blankHabits());
      setArmed(false); setWarn(null);
    }
    function restore(data) {
      var day = todayKey();
      setTasks(QD.rollDay(QD.migrate(data.tasks, day), day));
      setRecap(QD.pruneRecap(QD.normRecap(data.recap), day));
      setQuotes(QD.normQuotes(data.quotes));
      setCarts(QD.sweepCarts(QD.normCarts(data.carts, QD.normShopping(data.shopping)), day));
      setHabits(QD.normHabits(data.habitsv2));
      if (data.habits || data.markets || data.schedule) {
        setRetired({ habits: data.habits, markets: data.markets, schedule: data.schedule });
      }
      setWarn(null);
    }
    var snapshot = useMemo(function () {
      return { app: "quiet-desk", version: 3, exportedAt: new Date().toISOString(),
        tasks: tasks, recap: recap, quotes: quotes, carts: carts, habitsv2: habits,
        habits: retired.habits, markets: retired.markets, schedule: retired.schedule,
        shopping: retired.shopping };
    }, [tasks, recap, quotes, carts, habits, retired]);

    /* ---- derived ---- */
    var rankedToday = useMemo(function () {
      return QD.rankToday(tasks.items, today, clock);
    }, [tasks.items, today, clock]);
    var doneToday = useMemo(function () {
      return QD.completedInBucket(tasks.items, "today", today);
    }, [tasks.items, today]);
    var quoteList = useMemo(function () { return QD.activeQuotes(quotes); }, [quotes]);
    var todayQuote = useMemo(function () {
      return QD.quoteForDay(quoteList, today);
    }, [quoteList, today]);
    var cartList = useMemo(function () { return QD.cartsNewestFirst(carts); }, [carts]);
    /* Newest last, so the list does not reshuffle as habits are added. */
    var habitList = useMemo(function () {
      return habits.habits.slice().sort(function (a, b) {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
    }, [habits]);
    var shopList = useMemo(function () { return QD.shopsByName(carts); }, [carts]);
    var openCart = useMemo(function () {
      return carts.carts.filter(function (c) { return c.id === openCartId; })[0] || null;
    }, [carts, openCartId]);
    var recapWeek = useMemo(function () {
      return QD.recapDays(recap, tasks.items, today, 7);
    }, [recap, tasks.items, today]);
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

    /* Opening the composer has to focus the input inside the tap that asked
       for it — iOS only raises the keyboard for a focus() call that is still
       inside the gesture, so the state change is flushed first rather than
       left to the next render. */
    function openAdd() {
      if (adding) { if (addRef.current) addRef.current.focus(); return; }
      try { ReactDOM.flushSync(function () { setAdding(true); }); }
      catch (e) { setAdding(true); }
      if (addRef.current) addRef.current.focus();
    }
    function closeAdd() {
      setAdding(false); setComposerOpen(false);
      setQuick(""); setAddBucket("today"); setAddImp("should");
    }
    /* Hand the half-typed task to the full sheet rather than making the user
       add it and then go back in to say when it is. */
    function openDetails() {
      setDraft(QD.makeTask(quick.trim(), {
        bucket: addBucket, importance: addImp, today: today
      }));
    }
    function saveDraft(changes) {
      commit(tasks.items.concat([QD.makeTask(changes.title, {
        id: draft.id, bucket: changes.bucket, importance: changes.importance,
        notes: changes.notes, dueDate: changes.dueDate, dueTime: changes.dueTime,
        today: today, now: Date.now()
      })]));
      closeAdd();
    }

    var hotbar = div({ className: "hotbar" },
      button({ className: "hot", type: "button", onClick: openAdd },
        icon(I_PLUS, 18), span(null, "Add task")),
      button({ className: "hot", type: "button",
        onClick: function () { openApp("habits"); } },
        icon(I_REPEAT, 18), span(null, "Habits")),
      button({ className: "hot", type: "button",
        onClick: function () { setDumping(true); } },
        icon(I_DUMP, 18), span(null, "Brain dump")));

    var composer = div({ className: "composer" },
      adding ? h(React.Fragment, null,
        composerOpen ? div({ className: "compchips" },
          h(Chips, { label: "Bucket", options: BUCKET_OPTS, value: addBucket, onChange: setAddBucket }),
          h(Chips, { label: "Importance", options: IMP_OPTS, value: addImp, onChange: setAddImp }),
          div({ className: "compmore" },
            button({
              className: "linkbtn", type: "button",
              /* Same reason the chips do it: without this the input blurs,
                 the row unmounts, and the tap lands on nothing. */
              onMouseDown: function (e) { e.preventDefault(); },
              onClick: openDetails
            }, "Date, time \u0026 note"))) : null,
        h("form", {
          className: "inner",
          onSubmit: function (e) {
            e.preventDefault();
            var t = quick.trim();
            if (!t) return;
            addTasks([t], addBucket, addImp);
            setQuick(""); setAddBucket("today"); setAddImp("should");
            var el = e.currentTarget.querySelector("input");
            if (el) el.focus();
          }
        },
          input({
            className: "field", value: quick, ref: addRef,
            placeholder: briefOpen ? "Anything else for today?" : "Add a task",
            "aria-label": "Add a task", enterKeyHint: "done",
            onFocus: function () { setComposerOpen(true); },
            onBlur: function () {
              /* Safety net for browsers that blur before the click: only fold
                 the composer away once focus has genuinely left it. */
              setTimeout(function () {
                var el = document.activeElement;
                if (el && el.closest && el.closest(".composer")) return;
                if (!quickRef.current.trim()) { setAdding(false); setComposerOpen(false); }
              }, 200);
            },
            onChange: function (e) { setQuick(e.target.value); }
          }),
          button({
            className: "btn primary addbtn", type: "submit", disabled: !quick.trim(),
            /* Hold focus so the keyboard stays up for the next task. */
            onMouseDown: function (e) { e.preventDefault(); },
            "aria-label": "Add task"
          }, "Add"),
          button({
            className: "btn closebtn", type: "button", "aria-label": "Close the composer",
            onMouseDown: function (e) { e.preventDefault(); },
            onClick: closeAdd
          }, icon(I_X, 17))))
        : hotbar);

    var editingTask = editingId
      ? tasks.items.filter(function (t) { return t.id === editingId; })[0] : null;
    var taskSheet = editingTask ? h(TaskSheet, {
      key: editingTask.id, task: editingTask, today: today,
      onClose: function () { setEditingId(null); },
      onSave: function (changes) { patch(editingTask.id, changes); },
      onDelete: function () { deleteTask(editingTask.id); },
      onRemind: function (when) { remind(editingTask, when); }
    }) : null;

    var draftSheet = draft ? h(TaskSheet, {
      key: "draft", task: draft, today: today, isNew: true,
      onClose: function () { setDraft(null); },
      onSave: saveDraft,
      onDelete: function () {}, onRemind: function () {}
    }) : null;

    var overlays = h(React.Fragment, null,
      draftSheet,
      dumping ? h(BrainDump, { onClose: function () { setDumping(false); },
        today: today, onAdd: addParsed }) : null,
      backing ? h(Backup, { onClose: function () { setBacking(false); },
        snapshot: snapshot, onRestore: restore }) : null,
      taskSheet);

    function home() { go("a-in", function () { setBriefOpen(false); setRoute("home"); }); }

    /* The morning brief belongs to Tasks: it opens the first time Tasks is
       visited each day, and is reachable from its header after that. */
    function openApp(id) {
      if (id === "habits" && route === "tasks") {
        go("a-push", function () { setHabitsFrom("tasks"); setRoute("habits"); });
        return;
      }
      go("a-open", function () {
        if (id === "habits") setHabitsFrom("home");
        if (id === "tasks" && prefs.lastBriefShownOn !== today) {
          setBriefOpen(true);
          setPrefs({ installHintDismissed: prefs.installHintDismissed,
                     lastBriefShownOn: today, lastStaleAskOn: prefs.lastStaleAskOn });
        }
        setRoute(id);
      });
    }

    /* ---------- home ---------- */
    if (route === "home") {
      return h(Home, { key: nav.n, anim: nav.anim, today: today, quote: todayQuote,
        warn: warn, onOpen: openApp });
    }

    /* ---------- tasks ---------- */
    if (route === "tasks") {
      if (briefOpen) {
        return h(React.Fragment, null,
          h(Screen, { key: nav.n, anim: nav.anim, title: null, onBack: home, footer: composer },
            h(Brief, {
              today: today, items: tasks.items, prefs: prefs,
              onToggle: toggleTask, onDelete: deleteTask, onOptions: setEditingId,
              onPromote: promoteToToday, onNotToday: notToday, onStale: onStale,
              onClose: function () { setBriefOpen(false); }
            })),
          overlays);
      }
      var d = QD.keyToDate(today);
      return h(React.Fragment, null,
        h(Screen, { key: nav.n, anim: nav.anim, title: "Tasks", onBack: home, footer: composer },
          div({ className: "page" },
            header({ className: "head" },
              span({ className: "wd" }, WD[d.getDay()]),
              span({ className: "dt" }, nzDate(d)),
              button({ className: "briefLink", onClick: function () { setBriefOpen(true); } },
                "Today's brief")),

            warn ? div({ className: "banner", role: "status" }, span(null, warn)) : null,

            showInstallHint ? div({ className: "banner" },
              span(null, "Tap Share, then ", h("strong", null, "Add to Home Screen"),
                ", to run this full screen and offline."),
              button({ className: "x", "aria-label": "Dismiss",
                onClick: function () {
                  setPrefs(Object.assign({}, prefs, { installHintDismissed: true }));
                } }, icon(I_X, 16))) : null,

            section({ className: "sec" },
              h(Eyebrow, { title: "Today",
                hint: rankedToday.length ? rankedToday.length + " open" : null }),
              rankedToday.length === 0 && doneToday.length === 0
                ? p({ className: "empty-note" }, "Nothing on today's list.")
                : div({ className: "tasks" }, rankedToday.concat(doneToday).map(function (t) {
                    return h(TaskRow, {
                      key: t.id, task: t, today: today, now: clock,
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
                done: QD.completedInBucket(tasks.items, b, today),
                onToggle: toggleTask, onDelete: deleteTask, onOptions: setEditingId
              });
            }),

            footer({ className: "foot" },
              p({ className: "note" },
                "Everything here is stored on this device and never leaves it.",
                build ? span({ className: "build" }, "Build " + build) : null),
              div({ className: "footrow" },
                button({ className: "linkbtn", onClick: function () { setBacking(true); } },
                  "Back up & restore"),
                button({ className: "linkbtn danger" + (armed ? " armed" : ""),
                  onClick: function () { if (armed) { resetAll(); } else { setArmed(true); } },
                  onBlur: function () { setArmed(false); } },
                  armed ? "Tap again to erase everything" : "Reset all data"))))),
        overlays);
    }

    /* ---------- the other apps ---------- */
    if (route === "quotes") {
      return h(React.Fragment, null,
        h(QuotesApp, { key: nav.n, anim: nav.anim, onBack: home, quote: todayQuote, list: quoteList,
          onAdd: addQuote, onDelete: deleteQuote, onAdoptDefaults: adoptDefaults }),
        overlays);
    }
    if (route === "recap") {
      return h(React.Fragment, null,
        h(RecapApp, { key: nav.n, anim: nav.anim, onBack: home, days: recapWeek, today: today }), overlays);
    }
    if (route === "habits") {
      var habitSheet = editingHabit ? h(HabitSheet, {
        key: editingHabit,
        habit: editingHabit === "new" ? null
          : habits.habits.filter(function (hb) { return hb.id === editingHabit; })[0],
        today: today,
        onClose: function () { setEditingHabit(null); },
        onSave: saveHabit, onDelete: deleteHabit
      }) : null;
      return h(React.Fragment, null,
        h(HabitsApp, { key: nav.n, anim: nav.anim, today: today,
          habits: habitList,
          onBack: habitsFrom === "tasks"
            ? function () { go("a-pop", function () { setRoute("tasks"); }); }
            : home,
          onEdit: setEditingHabit,
          onSetActive: setHabitActive }),
        habitSheet, overlays);
    }
    if (route === "shopping" || route === "shops") {
      var sheets = h(React.Fragment, null,
        addingCart ? h(AddCartSheet, {
          shops: shopList, onClose: function () { setAddingCart(false); },
          onCreate: createCart,
          onShops: function () { go("a-push", function () { setRoute("shops"); }); }
        }) : null,
        confirming ? h(Confirm, confirming) : null);

      if (route === "shops") {
        return h(React.Fragment, null,
          h(ShopsApp, { key: nav.n, anim: nav.anim,
            onBack: function () { go("a-pop", function () { setRoute("shopping"); }); },
            shops: shopList,
            onAdd: addShop, onRename: renameShop, onRecolour: recolourShop,
            onDelete: deleteShop }),
          sheets, overlays);
      }
      if (openCart) {
        return h(React.Fragment, null,
          h(CartScreen, {
            key: nav.n, anim: nav.anim,
            cart: openCart,
            onBack: function () { go("a-pop", function () { setOpenCartId(null); }); },
            onAdd: function (text) { addCartItem(openCart.id, text); },
            onToggle: function (i) { toggleCartItem(openCart.id, i); },
            onDelete: function (i) { deleteCartItem(openCart.id, i); },
            onEmpty: function () {
              setConfirming({
                title: "Empty this cart?",
                lead: "Everything in " + openCart.shop + " goes — " +
                      openCart.items.length +
                      (openCart.items.length === 1 ? " item" : " items") + ", ticked or not.",
                detail: "There is no undo for this.",
                confirmLabel: "Empty it",
                onConfirm: function () { emptyCart(openCart.id); },
                onClose: function () { setConfirming(null); }
              });
            }
          }),
          sheets, overlays);
      }
      return h(React.Fragment, null,
        h(CartsApp, { key: nav.n, anim: nav.anim, onBack: home, carts: cartList,
          onAddCart: function () { setAddingCart(true); },
          onShops: function () { go("a-push", function () { setRoute("shops"); }); },
          onOpen: function (id) { go("a-push", function () { setOpenCartId(id); }); },
          onRemove: function (id) {
            var c = carts.carts.filter(function (x) { return x.id === id; })[0];
            if (!c) return;
            setConfirming({
              title: "Remove this cart?",
              lead: "The " + c.shop + " cart goes, along with its " + c.items.length +
                    (c.items.length === 1 ? " item" : " items") + ".",
              detail: "There is no undo for this.",
              confirmLabel: "Remove it",
              onConfirm: function () { removeCart(id); },
              onClose: function () { setConfirming(null); }
            });
          }
        }),
        sheets, overlays);
    }
    return h(Home, { key: nav.n, anim: nav.anim, today: today, quote: todayQuote,
      warn: warn, onOpen: openApp });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));

  if ("serviceWorker" in navigator) {
    /* A new worker used to sit installed until the app was fully relaunched,
       so an update could be live and still invisible. When one takes over,
       reload once so the new build is on screen immediately. The guard stops
       the very first install (which has no previous controller) reloading a
       page that is already current. */
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        /* Ask on every launch and whenever the app comes back to the front,
           rather than only when the browser feels like it. */
        reg.update().catch(function () {});
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") reg.update().catch(function () {});
        });
      }).catch(function () {});
    });
  }
})();
