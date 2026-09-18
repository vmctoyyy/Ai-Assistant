/* Last Card service worker.
   Scoped to this directory only — Quiet Desk's worker sits one level up at the
   site root and deliberately leaves everything under here alone.

   Bump CACHE whenever the shell changes. Assets are content-hashed by the
   build, so they are cached on first use rather than listed here. */
var CACHE_PREFIX = "last-card-";
var CACHE = CACHE_PREFIX + "v1";

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(["./", "./manifest.webmanifest"]); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        /* Shared origin: Quiet Desk's cache sits beside this one and must be
           left alone, or its offline launch breaks. */
        if (k.indexOf(CACHE_PREFIX) !== 0) return null;
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  if (url.pathname.indexOf(scope.pathname) !== 0) return;

  /* The shell can change with a deploy, so take the network first and fall
     back to the cache — which is what makes a cold, offline launch work. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put("./", copy); });
          return res;
        })
        .catch(function () {
          return caches.match("./").then(function (hit) {
            return hit || caches.match("./index.html");
          });
        })
    );
    return;
  }

  /* Everything else is content-hashed, so a cache hit is always current. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
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
