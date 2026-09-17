/* Cloudflare Worker: the only server Life Today has.
   It holds a push subscription, a time, some days, a timezone and two dates.
   It has never seen a task, a habit, a goal, a cart or a quote, and there is
   no endpoint here that could accept one. */
import Nudge from "./nudge.js";
import WebPush from "./webpush.js";

const KEY = "nudge:me";           /* one user, one record */
const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}

/* The app is served from a different origin, so the browser preflights. */
function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Nudge-Key",
    "Access-Control-Max-Age": "86400"
  };
}
function withCors(res, env) {
  const out = new Response(res.body, res);
  Object.entries(cors(env)).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

/* A shared secret in a public client is a speed bump, not a lock — see the
   README. Compared in constant time anyway, so it is not also a timing oracle. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function read(env) {
  const raw = await env.NUDGE.get(KEY);
  return raw ? Nudge.normRecord(JSON.parse(raw)) : null;
}
async function write(env, record) {
  await env.NUDGE.put(KEY, JSON.stringify(record));
}

async function deliver(env, record, dateKey) {
  const res = await WebPush.send(crypto.subtle, record.subscription,
    Nudge.payloadFor(dateKey), {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || "mailto:nobody@example.com"
    });
  /* The subscription is gone for good — drop it rather than retrying for ever. */
  if (res.status === 404 || res.status === 410) {
    await env.NUDGE.delete(KEY);
    return { ok: false, status: res.status, dropped: true };
  }
  return { ok: res.ok, status: res.status };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    const url = new URL(request.url);
    if (request.method !== "POST") return withCors(json({ error: "POST only" }, 405), env);
    if (!sameSecret(request.headers.get("X-Nudge-Key") || "", env.SHARED_SECRET || "")) {
      return withCors(json({ error: "no" }, 401), env);
    }

    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }

    if (url.pathname === "/subscribe") {
      const existing = await read(env);
      const record = Nudge.normRecord({
        subscription: body.subscription,
        time: body.time, days: body.days, timezone: body.timezone,
        enabled: body.enabled,
        /* Carried over, so changing the time does not un-mute a day. */
        lastOpenedDate: existing ? existing.lastOpenedDate : null,
        lastSentDate: existing ? existing.lastSentDate : null
      });
      if (!record) return withCors(json({ error: "need a subscription" }, 400), env);
      await write(env, record);
      return withCors(json({ ok: true }), env);
    }

    if (url.pathname === "/unsubscribe") {
      await env.NUDGE.delete(KEY);
      return withCors(json({ ok: true }), env);
    }

    /* The app says "I have been opened today". A date and nothing else. */
    if (url.pathname === "/opened") {
      const record = await read(env);
      if (!record) return withCors(json({ ok: true, note: "nothing subscribed" }), env);
      const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date : Nudge.localParts(Date.now(), record.timezone).date;
      record.lastOpenedDate = date;
      await write(env, record);
      return withCors(json({ ok: true }), env);
    }

    if (url.pathname === "/test") {
      const record = await read(env);
      if (!record) return withCors(json({ error: "nothing subscribed" }, 404), env);
      const at = Nudge.localParts(Date.now(), record.timezone);
      const out = await deliver(env, record, at.date);
      return withCors(json(out, out.ok ? 200 : 502), env);
    }

    return withCors(json({ error: "unknown" }, 404), env);
  },

  /* Every 15 minutes. One record, so this is a handful of milliseconds. */
  async scheduled(event, env, ctx) {
    const record = await read(env);
    if (!record) return;
    const now = event.scheduledTime || Date.now();
    const verdict = Nudge.shouldSend(record, now);
    if (!verdict.send) return;
    /* Marked before sending: a push that fails is better than one sent twice
       because the write lost a race with the next tick. */
    record.lastSentDate = verdict.at.date;
    await write(env, record);
    ctx.waitUntil(deliver(env, record, verdict.at.date));
  }
};
