/* Web Push over WebCrypto — RFC 8291 (aes128gcm) and RFC 8292 (VAPID).
   Written against WebCrypto rather than Node's crypto so it runs unchanged on
   Cloudflare Workers, where Node's `web-push` package does not.
   No task data ever passes through here: the payload is a fixed calm line and
   a URL, nothing more. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WebPush = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NUL = String.fromCharCode(0);
  var enc = new TextEncoder();
  function utf8(s) { return enc.encode(s); }
  function concat() {
    var parts = Array.prototype.slice.call(arguments);
    var n = parts.reduce(function (t, p) { return t + p.length; }, 0);
    var out = new Uint8Array(n), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function b64urlToBytes(s) {
    var t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    var bin = typeof atob === "function"
      ? atob(t) : Buffer.from(t, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa === "function"
      ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* WebCrypto's HKDF does extract-then-expand in one call, which is exactly
     the shape RFC 8291 asks for at each step. */
  function hkdf(subtle, salt, ikm, info, len) {
    return subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
      .then(function (key) {
        return subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt: salt, info: info }, key, len * 8);
      }).then(function (bits) { return new Uint8Array(bits); });
  }

  /* One record, aes128gcm. The body is
       salt(16) | rs(4) | idlen(1) | as_public(65) | AES-GCM(plaintext | 0x02)
     where 0x02 is the last-record delimiter. */
  function encrypt(subtle, plaintext, p256dh, authSecret, opts) {
    opts = opts || {};
    var uaPublic = b64urlToBytes(p256dh);
    var auth = b64urlToBytes(authSecret);
    var salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
    var rs = opts.recordSize || 4096;
    var asPublic, asPrivate;

    var keysReady = opts.asKeys
      ? Promise.resolve(opts.asKeys)
      : subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

    return keysReady.then(function (pair) {
      asPrivate = pair.privateKey;
      return subtle.exportKey("raw", pair.publicKey);
    }).then(function (raw) {
      asPublic = new Uint8Array(raw);
      return subtle.importKey("raw", uaPublic,
        { name: "ECDH", namedCurve: "P-256" }, false, []);
    }).then(function (uaKey) {
      return subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256);
    }).then(function (secret) {
      var ecdh = new Uint8Array(secret);
      var info = concat(utf8("WebPush: info" + NUL), uaPublic, asPublic);
      return hkdf(subtle, auth, ecdh, info, 32);
    }).then(function (ikm) {
      return Promise.all([
        hkdf(subtle, salt, ikm, utf8("Content-Encoding: aes128gcm" + NUL), 16),
        hkdf(subtle, salt, ikm, utf8("Content-Encoding: nonce" + NUL), 12)
      ]);
    }).then(function (both) {
      var cek = both[0], nonce = both[1];
      return subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
        .then(function (key) {
          var padded = concat(plaintext, new Uint8Array([2]));
          return subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded);
        });
    }).then(function (ct) {
      var header = new Uint8Array(16 + 4 + 1 + 65);
      header.set(salt, 0);
      new DataView(header.buffer).setUint32(16, rs);
      header[20] = 65;
      header.set(asPublic, 21);
      return concat(header, new Uint8Array(ct));
    });
  }

  /* VAPID: an ES256 JWT saying who is sending, and to which push service. */
  function vapidAuth(subtle, endpoint, publicKey, privateKey, subject, nowMs) {
    var u = new URL(endpoint);
    var head = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    var body = bytesToB64url(utf8(JSON.stringify({
      aud: u.protocol + "//" + u.host,
      exp: Math.floor((nowMs || Date.now()) / 1000) + 12 * 60 * 60,
      sub: subject
    })));
    var pub = b64urlToBytes(publicKey);
    var jwk = {
      kty: "EC", crv: "P-256",
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: bytesToB64url(b64urlToBytes(privateKey)),
      ext: true
    };
    return subtle.importKey("jwk", jwk,
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
      .then(function (key) {
        return subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key,
          utf8(head + "." + body));
      }).then(function (sig) {
        return "vapid t=" + head + "." + body + "." +
          bytesToB64url(new Uint8Array(sig)) + ", k=" + publicKey;
      });
  }

  /* Returns the push service's response, so the caller can retire a dead
     subscription on 404 or 410. */
  function send(subtle, sub, payloadObj, vapid, opts) {
    opts = opts || {};
    var plaintext = utf8(JSON.stringify(payloadObj));
    return encrypt(subtle, plaintext, sub.keys.p256dh, sub.keys.auth, opts)
      .then(function (body) {
        return vapidAuth(subtle, sub.endpoint, vapid.publicKey, vapid.privateKey,
          vapid.subject, opts.now).then(function (auth) {
          return (opts.fetch || fetch)(sub.endpoint, {
            method: "POST",
            headers: {
              Authorization: auth,
              "Content-Encoding": "aes128gcm",
              "Content-Type": "application/octet-stream",
              TTL: String(opts.ttl || 3600),
              Urgency: "normal"
            },
            body: body
          });
        });
      });
  }

  return { encrypt: encrypt, vapidAuth: vapidAuth, send: send,
           b64urlToBytes: b64urlToBytes, bytesToB64url: bytesToB64url, hkdf: hkdf };
});
