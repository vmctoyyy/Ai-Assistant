/* The only two values the morning nudge needs, and neither is a secret.
   Both are blank until the Worker in /push is deployed — while they are
   blank the nudge stays dormant and the settings panel says why, so the app
   is never left pointing at a server that is not there.

   After deploying (see push/README.md), paste:
     url       the Worker's address, e.g. "https://life-today-nudge.you.workers.dev"
     publicKey the VAPID public key printed by push/keygen.mjs
     secret    the same SHARED_SECRET set on the Worker

   The secret is visible to anyone who views this file. That is unavoidable in
   a static app and it is not real access control — see push/README.md. */
window.QD_PUSH = {
  url: "",
  publicKey: "",
  secret: ""
};
