/* Quiet Desk service worker — precache everything, serve cache-first.
   Bump CACHE when any asset below changes. */
var CACHE = "quiet-desk-v28";

var ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./logic.js",
  "./push-config.js",
  "./nudge-client.js",
  "./manifest.webmanifest",
  "./vendor/react.js",
  "./vendor/react-dom.js",
  "./assets/newsreader-400.woff2",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Pages serves this app from a subdirectory, so the worker's scope covers
   everything beside it too. These are the only paths Quiet Desk owns; anything
   else under the scope belongs to another app and is left alone. */
var OWN_DIRS = ["vendor/", "assets/", "icons/"];

function ours(url) {
  var scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return false;
  if (url.pathname.indexOf(scope.pathname) !== 0) return false;
  var rest = url.pathname.slice(scope.pathname.length);
  if (rest.indexOf("/") === -1) return true; // a file at the app root
  for (var i = 0; i < OWN_DIRS.length; i++) {
    if (rest.indexOf(OWN_DIRS[i]) === 0) return true;
  }
  return false;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (!ours(url)) return; // another app's page: straight to the network

  // Navigations: cached shell first so a cold, offline launch still works.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("./index.html").then(function (hit) {
        return hit || fetch(req);
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // Refresh in the background so the next launch is current.
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res); });
        }).catch(function () {});
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* ---- the morning nudge ----
   The payload is written by our own Worker, but it arrives over the network,
   so it is treated as untrusted: only known fields are read, and anything
   missing falls back to something safe rather than rendering undefined. */
self.addEventListener("push", function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  var title = typeof data.title === "string" ? data.title : "Life Today";
  var body = typeof data.body === "string" ? data.body : "Your day is ready.";
  var url = typeof data.url === "string" && data.url.charAt(0) === "/"
    ? data.url : "/?open=brief";
  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    tag: typeof data.tag === "string" ? data.tag : "morning-nudge",
    renotify: false,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: url }
  }));
});

/* Focus the app if it is already open rather than stacking another window. */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var want = (e.notification.data && e.notification.data.url) || "/?open=brief";
  var target = new URL(want, self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].url.indexOf(self.registration.scope) === 0 && "focus" in list[i]) {
            if ("navigate" in list[i]) { try { list[i].navigate(target); } catch (err) {} }
            return list[i].focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
