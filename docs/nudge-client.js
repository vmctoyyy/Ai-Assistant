/* Talking to the nudge Worker. Kept apart from app.js because every call here
   is optional, deferred and allowed to fail: the app must work exactly as it
   always has with no signal, an undeployed Worker or a dead subscription.
   Nothing in this file ever sends a task, a habit, a goal or a list. */
(function () {
  "use strict";
  var QD = window.QD;

  function config() {
    var c = window.QD_PUSH || {};
    return (c.url && c.publicKey) ? c : null;
  }
  function supported() {
    return !!(window.PushManager && window.Notification &&
      navigator.serviceWorker && config());
  }
  /* iOS only allows push for a PWA added to the Home Screen. */
  function standalone() {
    return !!(window.navigator.standalone ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches));
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  /* Why the panel cannot offer the toggle, in the app's own words. */
  function blocker() {
    if (!config()) return "notset";
    if (!window.PushManager || !window.Notification) return "unsupported";
    if (isIOS() && !standalone()) return "needsinstall";
    if (window.Notification.permission === "denied") return "denied";
    return null;
  }

  function post(path, body) {
    var c = config();
    if (!c) return Promise.reject(new Error("not configured"));
    return fetch(c.url.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nudge-Key": c.secret || "" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      if (!res.ok) throw new Error("nudge server said " + res.status);
      return res.json().catch(function () { return {}; });
    });
  }

  function urlB64ToUint8(base64) {
    var pad = "=".repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function subscribe(nudge) {
    var c = config();
    if (!c) return Promise.reject(new Error("not configured"));
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(c.publicKey)
        });
      });
    }).then(function (sub) {
      var json = sub.toJSON();
      return post("/subscribe", {
        subscription: { endpoint: json.endpoint, keys: json.keys },
        time: nudge.time, days: nudge.days,
        timezone: nudge.timezone, enabled: true
      }).then(function () { return json.endpoint; });
    });
  }

  function unsubscribe() {
    var stop = navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) { return sub ? sub.unsubscribe() : true; })
      .catch(function () { return true; });
    /* Tell the server even if the local unsubscribe failed, or it would keep
       pushing to an endpoint the device has stopped listening to. */
    return stop.then(function () { return post("/unsubscribe", {}); });
  }

  /* Asked for only when the toggle is switched on — iOS requires the request
     to come from a tap, and asking on first launch is rude anyway. */
  function ask() {
    if (!window.Notification) return Promise.resolve("unsupported");
    if (window.Notification.permission !== "default") {
      return Promise.resolve(window.Notification.permission);
    }
    try {
      var out = window.Notification.requestPermission();
      return (out && out.then) ? out : new Promise(function (r) {
        window.Notification.requestPermission(r);
      });
    } catch (e) { return Promise.resolve("denied"); }
  }

  /* Once a day, so the server can skip a nudge for a day already started.
     A date and nothing else. Fire-and-forget: a failure is not worth a word. */
  function pingOpened(nudge, today) {
    if (!config() || !nudge.enabled || nudge.lastPingedOn === today) {
      return Promise.resolve(false);
    }
    return post("/opened", { date: today })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /* iOS drops push subscriptions quietly. Re-subscribing when the endpoint
     has changed underneath us is what keeps the nudge alive without the user
     ever being told to go and fix it. */
  function healthCheck(nudge) {
    if (!config() || !nudge.enabled) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub && sub.endpoint === nudge.endpoint) return null;
      return subscribe(nudge);
    }).catch(function () { return null; });
  }

  function sendTest() { return post("/test", {}); }

  window.QDNudge = {
    config: config, supported: supported, blocker: blocker, standalone: standalone,
    subscribe: subscribe, unsubscribe: unsubscribe, ask: ask,
    pingOpened: pingOpened, healthCheck: healthCheck, sendTest: sendTest
  };
})();
