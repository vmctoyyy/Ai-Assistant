/* Generates a VAPID key pair. Run once:  node push/keygen.mjs
   The public key goes in docs/push-config.js (it is not a secret).
   The private key goes ONLY into `wrangler secret put VAPID_PRIVATE_KEY`.
   Neither is written to disk here, so neither can be committed by accident. */
import { webcrypto } from "crypto";

const pair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

console.log("VAPID_PUBLIC_KEY  (goes in the app, not secret)");
console.log("  " + raw.toString("base64url"));
console.log();
console.log("VAPID_PRIVATE_KEY (server secret — do not commit, do not paste in the app)");
console.log("  " + Buffer.from(jwk.d, "base64url").toString("base64url"));
console.log();
console.log("SHARED_SECRET     (suggested random value)");
console.log("  " + Buffer.from(webcrypto.getRandomValues(new Uint8Array(24))).toString("base64url"));
