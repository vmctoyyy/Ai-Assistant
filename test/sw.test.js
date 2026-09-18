/* Service worker scoping.
   Pages serves Quiet Desk from /Ai-Assistant/, so the worker's scope covers
   every sibling app on the same site. Getting this wrong makes another app's
   page silently render the Quiet Desk shell — which is invisible in every
   other test, because nothing else loads the worker. */

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var passed = 0;
var failed = 0;

function is(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log("  FAIL " + label + " — expected " + expected + ", got " + actual);
  }
}

/* Load sw.js with just enough of a worker global to evaluate it. */
function loadWorker(scope) {
  var listeners = {};
  var sandbox = {
    self: {
      registration: { scope: scope },
      addEventListener: function (name, fn) { listeners[name] = fn; },
      skipWaiting: function () {},
      clients: { claim: function () {} }
    },
    caches: {
      open: function () { return Promise.resolve({ put: function () {}, addAll: function () {} }); },
      keys: function () { return Promise.resolve([]); },
      match: function () { return Promise.resolve(null); }
    },
    fetch: function () {},
    URL: URL,
    console: console
  };
  sandbox.self.URL = URL;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "docs", "sw.js"), "utf8"), sandbox);
  return { sandbox: sandbox, listeners: listeners };
}

var SCOPE = "https://vmctoyyy.github.io/Ai-Assistant/";
var w = loadWorker(SCOPE);
var ours = w.sandbox.ours;

console.log("scoping");

is("claims its own root", ours(new URL(SCOPE)), true);
is("claims its own shell", ours(new URL(SCOPE + "index.html")), true);
is("claims its own script", ours(new URL(SCOPE + "app.js")), true);
is("claims vendored React", ours(new URL(SCOPE + "vendor/react.js")), true);
is("claims its font", ours(new URL(SCOPE + "assets/newsreader-400.woff2")), true);
is("claims its icons", ours(new URL(SCOPE + "icons/icon-192.png")), true);

is("leaves a sibling app's page alone", ours(new URL(SCOPE + "last-card/")), false);
is("leaves a sibling app's shell alone", ours(new URL(SCOPE + "last-card/index.html")), false);
is("leaves a sibling app's bundle alone", ours(new URL(SCOPE + "last-card/assets/index-abc.js")), false);
is("leaves any future sibling alone", ours(new URL(SCOPE + "something-else/page.html")), false);

is("ignores another origin", ours(new URL("https://example.com/Ai-Assistant/app.js")), false);
is("ignores a path outside the scope", ours(new URL("https://vmctoyyy.github.io/other/app.js")), false);

/* The navigation branch is what actually broke the sibling page: it answered
   every in-scope navigation with Quiet Desk's own shell. */
console.log("navigation handling");

function navigatedTo(url) {
  var handled = false;
  var fake = {
    request: { method: "GET", mode: "navigate", url: url },
    respondWith: function () { handled = true; }
  };
  w.listeners.fetch(fake);
  return handled;
}

is("answers its own navigation from cache", navigatedTo(SCOPE), true);
is("does not answer a sibling app's navigation", navigatedTo(SCOPE + "last-card/"), false);

/* A stale CACHE name is how an update silently fails to reach the phone. */
console.log("cache version");
var src = fs.readFileSync(path.join(__dirname, "..", "docs", "sw.js"), "utf8");
is("CACHE is set", /var CACHE = CACHE_PREFIX \+ "v\d+";/.test(src), true);

/* CacheStorage is per-origin, not per-scope. Both apps keep a cache here, so
   a worker that sweeps every key it does not recognise deletes the other
   app's offline copy — which is exactly what happened the first time. */
console.log("cache sweeping");

function sweptBy(swPath, prefix, keys) {
  var deleted = [];
  var listeners = {};
  var sandbox = {
    self: {
      registration: { scope: SCOPE },
      addEventListener: function (name, fn) { listeners[name] = fn; },
      skipWaiting: function () {},
      clients: { claim: function () { return Promise.resolve(); } }
    },
    caches: {
      open: function () { return Promise.resolve({ put: function () {}, addAll: function () {} }); },
      keys: function () { return Promise.resolve(keys); },
      match: function () { return Promise.resolve(null); },
      delete: function (k) { deleted.push(k); return Promise.resolve(true); }
    },
    fetch: function () { return Promise.resolve(); },
    URL: URL,
    Promise: Promise,
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(swPath, "utf8"), sandbox);
  var waited = null;
  listeners.activate({ waitUntil: function (p) { waited = p; } });
  return waited.then(function () { return deleted; });
}

var qdPath = path.join(__dirname, "..", "docs", "sw.js");
var lcPath = path.join(__dirname, "..", "last-card", "public", "sw.js");
var keys = ["quiet-desk-v27", "quiet-desk-v29", "last-card-v1", "last-card-v0", "something-else"];

var pending = Promise.all([
  sweptBy(qdPath, "quiet-desk-", keys).then(function (deleted) {
    is("Quiet Desk drops its own old version", deleted.indexOf("quiet-desk-v27") !== -1, true);
    is("Quiet Desk keeps its current one", deleted.indexOf("quiet-desk-v29"), -1);
    is("Quiet Desk leaves Last Card's cache alone", deleted.indexOf("last-card-v1"), -1);
    is("Quiet Desk leaves Last Card's old cache alone", deleted.indexOf("last-card-v0"), -1);
    is("Quiet Desk leaves anything unrecognised alone", deleted.indexOf("something-else"), -1);
  }),
  sweptBy(lcPath, "last-card-", keys).then(function (deleted) {
    is("Last Card drops its own old version", deleted.indexOf("last-card-v0") !== -1, true);
    is("Last Card keeps its current one", deleted.indexOf("last-card-v1"), -1);
    is("Last Card leaves Quiet Desk's cache alone", deleted.indexOf("quiet-desk-v29"), -1);
    is("Last Card leaves Quiet Desk's old cache alone", deleted.indexOf("quiet-desk-v27"), -1);
  })
]);

pending.then(function () {
  console.log("");
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
});
