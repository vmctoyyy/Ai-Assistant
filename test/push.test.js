/* Run: node test/push.test.js
   Covers the two parts of the nudge that have to be exactly right: when it
   fires, and whether the encryption a real push service will reject is
   actually correct. The second is checked against http_ece — an independent
   implementation, the one Node's web-push uses — rather than against itself. */
var assert = require("assert");
var Nudge = require("../push/nudge.js");
var WebPush = require("../push/webpush.js");
var nodeCrypto = require("crypto");
var subtle = nodeCrypto.webcrypto.subtle;

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
var pending = [];
function ta(name, fn) { pending.push({ name: name, fn: fn }); }

function sub(o) {
  o = o || {};
  return {
    subscription: { endpoint: "https://push.example/x", keys: { p256dh: "k", auth: "a" } },
    time: o.time || "07:00",
    days: o.days || [0, 1, 2, 3, 4, 5, 6],
    timezone: o.timezone || "Pacific/Auckland",
    enabled: o.enabled === false ? false : true,
    lastOpenedDate: o.lastOpenedDate || null,
    lastSentDate: o.lastSentDate || null
  };
}
/* 2026-09-16 is a Wednesday. Auckland is UTC+12 in September (NZST). */
function nzAt(hhmm, day) {
  var h = +hhmm.slice(0, 2), m = +hhmm.slice(3, 5);
  return Date.UTC(2026, 8, day || 16, h - 12, m, 0);
}

console.log("\nlocal time in the device's own zone");
t("an IANA zone, not an offset, so daylight saving is handled", function () {
  var winter = Nudge.localParts(Date.UTC(2026, 5, 16, 19, 0), "Pacific/Auckland");
  var summer = Nudge.localParts(Date.UTC(2026, 11, 16, 19, 0), "Pacific/Auckland");
  assert.strictEqual(winter.minutes, 7 * 60, "June: UTC+12");
  assert.strictEqual(summer.minutes, 8 * 60, "December: UTC+13, and nothing had to know");
});
t("it reports the local date, which can differ from the UTC one", function () {
  var at = Nudge.localParts(Date.UTC(2026, 8, 15, 20, 0), "Pacific/Auckland");
  assert.strictEqual(at.date, "2026-09-16", "already tomorrow in Auckland");
});
t("weekdays are 0-6 from Sunday, matching the stored days", function () {
  assert.strictEqual(Nudge.localParts(nzAt("09:00"), "Pacific/Auckland").weekday, 3);
});
t("an unknown zone falls back to UTC rather than stranding the run", function () {
  var at = Nudge.localParts(Date.UTC(2026, 8, 16, 9, 0), "Not/AZone");
  assert.strictEqual(at.minutes, 9 * 60);
});

console.log("\nwhen it fires");
t("at the chosen time, on a chosen day", function () {
  var out = Nudge.shouldSend(sub(), nzAt("07:00"));
  assert.strictEqual(out.send, true, out.why);
});
t("a run a few minutes late still sends", function () {
  assert.strictEqual(Nudge.shouldSend(sub(), nzAt("07:12")).send, true);
});
t("but not hours later", function () {
  var out = Nudge.shouldSend(sub(), nzAt("09:30"));
  assert.strictEqual(out.send, false);
  assert.strictEqual(out.why, "window has passed");
});
t("and never before the time asked for", function () {
  assert.strictEqual(Nudge.shouldSend(sub(), nzAt("06:45")).why, "too early");
});
t("nothing on a day not chosen", function () {
  var out = Nudge.shouldSend(sub({ days: [1, 2, 4, 5] }), nzAt("07:00"));
  assert.strictEqual(out.send, false);
  assert.strictEqual(out.why, "not one of its days");
});
t("never twice in a day", function () {
  var out = Nudge.shouldSend(sub({ lastSentDate: "2026-09-16" }), nzAt("07:05"));
  assert.strictEqual(out.why, "already sent today");
});
t("and not at all if the app has already been opened", function () {
  var out = Nudge.shouldSend(sub({ lastOpenedDate: "2026-09-16" }), nzAt("07:00"));
  assert.strictEqual(out.send, false);
  assert.strictEqual(out.why, "already opened today", "a 5am gym day needs no nudge");
});
t("yesterday's open does not silence today", function () {
  assert.strictEqual(Nudge.shouldSend(sub({ lastOpenedDate: "2026-09-15" }), nzAt("07:00")).send, true);
});
t("turned off means silent", function () {
  assert.strictEqual(Nudge.shouldSend(sub({ enabled: false }), nzAt("07:00")).why, "turned off");
});
t("no subscription means silent", function () {
  assert.strictEqual(Nudge.shouldSend({ time: "07:00" }, nzAt("07:00")).why, "no subscription");
});
t("the window is the cron interval, so no minute is unreachable", function () {
  var fired = 0;
  for (var m = 0; m < 24 * 60; m += Nudge.WINDOW_MINUTES) {
    var at = Date.UTC(2026, 8, 16, 0, 0) + m * 60000;
    if (Nudge.shouldSend(sub({ time: "07:00" }), at).send) fired++;
  }
  assert.strictEqual(fired, 1, "exactly one run in a whole day can fire");
});
t("a time between cron ticks is still caught by the next one", function () {
  var out = Nudge.shouldSend(sub({ time: "07:07" }), nzAt("07:15"));
  assert.strictEqual(out.send, true, out.why);
});
t("the very end of the window is excluded, not double-counted", function () {
  assert.strictEqual(Nudge.shouldSend(sub(), nzAt("07:14")).send, true);
  assert.strictEqual(Nudge.shouldSend(sub(), nzAt("07:15")).send, false);
});

console.log("\nwhat it says");
t("calm, and knowing nothing about the day", function () {
  Nudge.LINES.forEach(function (line) {
    assert.ok(line.indexOf("!") === -1, line);
    assert.ok(!/\d/.test(line), "no counts: " + line);
    assert.ok(!/overdue|late|behind|missed|don't forget|streak/i.test(line), line);
  });
});
t("the wording rotates by date but holds within a day", function () {
  assert.strictEqual(Nudge.bodyFor("2026-09-16"), Nudge.bodyFor("2026-09-16"));
  var seen = {};
  ["2026-09-16","2026-09-17","2026-09-18","2026-09-19","2026-09-20"].forEach(function (d) {
    seen[Nudge.bodyFor(d)] = true;
  });
  assert.ok(Object.keys(seen).length > 1);
});
t("the payload carries a tag so a second can never stack", function () {
  var p = Nudge.payloadFor("2026-09-16");
  assert.strictEqual(p.tag, "morning-nudge");
  assert.strictEqual(p.url, "/?open=brief");
  assert.strictEqual(p.title, "Life Today");
});
t("and carries nothing about the user's data", function () {
  var json = JSON.stringify(Nudge.payloadFor("2026-09-16"));
  assert.ok(!/task|habit|goal|shopping|cart|quote/i.test(json), json);
});

console.log("\nthe stored record");
t("junk days are dropped and the rest kept, deduped and sorted", function () {
  var r = Nudge.normRecord(sub({ days: [9, 3, "1", -2, 3] }));
  assert.deepStrictEqual(r.days, [1, 3]);
});
t("an empty day list means every day rather than never", function () {
  assert.deepStrictEqual(Nudge.normRecord(sub({ days: [] })).days, [0,1,2,3,4,5,6]);
});
t("a bad time falls back to the default", function () {
  assert.strictEqual(Nudge.normRecord(sub({ time: "25:99" })).time, "07:00");
});
t("the record holds nothing but scheduling", function () {
  var keys = Object.keys(Nudge.normRecord(sub())).sort();
  assert.deepStrictEqual(keys,
    ["days","enabled","lastOpenedDate","lastSentDate","subscription","time","timezone"]);
});

console.log("\nencryption, checked against an independent implementation");
ta("a real push service would be able to decrypt what we send", async function () {
  var ece = require("http_ece");
  var ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  var uaPub = Buffer.from(await subtle.exportKey("raw", ua.publicKey));
  var jwk = await subtle.exportKey("jwk", ua.privateKey);
  var authSecret = Buffer.from(nodeCrypto.randomBytes(16));
  var message = JSON.stringify(Nudge.payloadFor("2026-09-16"));

  var cipher = await WebPush.encrypt(subtle, new TextEncoder().encode(message),
    uaPub.toString("base64url"), authSecret.toString("base64url"));

  var recv = nodeCrypto.createECDH("prime256v1");
  recv.setPrivateKey(Buffer.from(jwk.d, "base64url"));
  var out = ece.decrypt(Buffer.from(cipher), {
    version: "aes128gcm", privateKey: recv, authSecret: authSecret
  });
  assert.strictEqual(out.toString("utf8"), message);
});
ta("the header is shaped the way RFC 8291 requires", async function () {
  var ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  var uaPub = Buffer.from(await subtle.exportKey("raw", ua.publicKey));
  var cipher = Buffer.from(await WebPush.encrypt(subtle,
    new TextEncoder().encode("hi"), uaPub.toString("base64url"),
    Buffer.from(nodeCrypto.randomBytes(16)).toString("base64url")));
  assert.strictEqual(cipher.readUInt32BE(16), 4096, "record size");
  assert.strictEqual(cipher[20], 65, "key id length");
  assert.strictEqual(cipher[21], 4, "uncompressed point");
  assert.ok(cipher.length > 86, "and a body after the header");
});
ta("every send uses a fresh salt and key, so two are never identical", async function () {
  var ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  var uaPub = Buffer.from(await subtle.exportKey("raw", ua.publicKey)).toString("base64url");
  var auth = Buffer.from(nodeCrypto.randomBytes(16)).toString("base64url");
  var msg = new TextEncoder().encode("same message");
  var a = Buffer.from(await WebPush.encrypt(subtle, msg, uaPub, auth));
  var b = Buffer.from(await WebPush.encrypt(subtle, msg, uaPub, auth));
  assert.ok(!a.equals(b), "identical ciphertexts would leak that nothing changed");
});

console.log("\nVAPID");
ta("the JWT is signed, scoped to the push service, and carries the key", async function () {
  var pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  var pubRaw = Buffer.from(await subtle.exportKey("raw", pair.publicKey));
  var jwk = await subtle.exportKey("jwk", pair.privateKey);
  var pub = pubRaw.toString("base64url");
  var priv = Buffer.from(jwk.d, "base64url").toString("base64url");

  var header = await WebPush.vapidAuth(subtle, "https://fcm.googleapis.com/fcm/send/abc",
    pub, priv, "mailto:someone@example.com", Date.UTC(2026, 8, 16, 0, 0));
  assert.ok(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(header), header.slice(0, 40));
  var jwt = header.slice(8, header.indexOf(", k="));
  var parts = jwt.split(".");
  var claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  assert.strictEqual(claims.aud, "https://fcm.googleapis.com", "the service, not the full path");
  assert.strictEqual(claims.sub, "mailto:someone@example.com");
  assert.ok(claims.exp > Date.UTC(2026, 8, 16, 0, 0) / 1000, "expires in the future");
  assert.ok(claims.exp - Date.UTC(2026, 8, 16, 0, 0) / 1000 <= 24 * 3600,
    "and within the 24 hours push services allow");

  var ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    Buffer.from(parts[2], "base64url"), new TextEncoder().encode(parts[0] + "." + parts[1]));
  assert.strictEqual(ok, true, "signature verifies against the public key");
});

(async function () {
  for (var i = 0; i < pending.length; i++) {
    try { await pending[i].fn(); pass++; console.log("  ok   " + pending[i].name); }
    catch (e) { fail++; console.log("  FAIL " + pending[i].name + "\n       " + e.message); }
  }
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
