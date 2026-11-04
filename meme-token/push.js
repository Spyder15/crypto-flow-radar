// Web Push (RFC 8291 aes128gcm + VAPID) and the rule checker run by the cron trigger.
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

export async function encryptPayload(sub, text) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth), salt = crypto.getRandomValues(new Uint8Array(16));
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const prk = await hkdf(auth, ecdh, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}

async function vapidAuth(endpoint, env) {
  const pub = unb64u(env.VAPID_PUBLIC);
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:spyder@spyder-radar.workers.dev" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function sendPush(sub, payload, env) {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { authorization: await vapidAuth(sub.endpoint, env), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "3600", urgency: "high" },
    body: await encryptPayload(sub, JSON.stringify(payload)),
  });
  return res.status;
}

const sid = async (endpoint) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)));
const J = { "content-type": "application/json" };

export async function pushApi(req, env, path) {
  if (!env.PUSH || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return new Response('{"key":null}', { headers: J });
  if (path === "/api/push/key") return new Response(JSON.stringify({ key: env.VAPID_PUBLIC }), { headers: J });
  if (req.method !== "POST") return new Response("{}", { status: 405, headers: J });
  let b; try { b = await req.json(); } catch (e) { return new Response("{}", { status: 400, headers: J }); }
  if (path === "/api/push/unsub") { if (b.endpoint) await env.PUSH.delete(await sid(b.endpoint)); return new Response('{"ok":1}', { headers: J }); }
  const s = b.sub;
  if (!s?.endpoint?.startsWith("https://") || !s.keys?.p256dh || !s.keys?.auth) return new Response("{}", { status: 400, headers: J });
  const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 20).filter((r) => r && typeof r.s === "string" && ["price", "chg24", "fund"].includes(r.m) && [">", "<"].includes(r.op) && isFinite(r.v)).map((r) => ({ id: r.id, s: r.s.slice(0, 12), m: r.m, op: r.op, v: +r.v, once: !!r.once }));
  await env.PUSH.put(await sid(s.endpoint), JSON.stringify({ sub: { endpoint: s.endpoint, keys: s.keys }, rules, fired: {} }));
  return new Response('{"ok":1}', { headers: J });
}

const fmt = (n) => (Math.abs(n) >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+n.toPrecision(4)));
const NAMES = { price: "Price", chg24: "24h change", fund: "Funding (ann.)" };

export async function checkRules(env) {
  if (!env.PUSH || !env.VAPID_PRIVATE) return;
  const list = await env.PUSH.list();
  if (!list.keys.length) return;
  const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: J, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
  if (!r.ok) return;
  const [meta, ctx] = await r.json(), M = {};
  meta.universe.forEach((u, i) => { const c = ctx[i], p = +c.markPx, pd = +c.prevDayPx; M[u.name] = { price: p, chg24: pd ? (p / pd - 1) * 100 : null, fund: +c.funding * 24 * 365 * 100 }; });
  for (const k of list.keys) {
    const raw = await env.PUSH.get(k.name); if (!raw) continue;
    const rec = JSON.parse(raw); let dirty = false;
    for (const rule of [...rec.rules]) {
      const v = M[rule.s]?.[rule.m]; if (v == null || !isFinite(v)) continue;
      if (!(rule.op === ">" ? v > rule.v : v < rule.v)) continue;
      const now = Date.now();
      if (!rule.once && now - (rec.fired[rule.id] || 0) < 18e5) continue;
      const st = await sendPush(rec.sub, { title: `${rule.s} ${NAMES[rule.m]} ${rule.op} ${fmt(rule.v)}`, body: `Now ${fmt(v)}${rule.m === "price" ? "" : "%"} (Hyperliquid)` }, env).catch(() => 0);
      if (st === 404 || st === 410) { await env.PUSH.delete(k.name); dirty = false; break; }
      rec.fired[rule.id] = now; dirty = true;
      if (rule.once) rec.rules = rec.rules.filter((x) => x.id !== rule.id);
    }
    if (dirty) await env.PUSH.put(k.name, JSON.stringify(rec));
  }
}
