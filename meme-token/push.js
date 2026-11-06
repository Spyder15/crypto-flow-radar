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
const PUSHHOST = /^https:\/\/([\w-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//;
const HOOK = /^https:\/\/(discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+|hooks\.slack\.com\/services\/[\w/]+)$/;
const METRICS = ["price", "chg24", "fund", "rsi", "vsma"];
// Keep an index of subscriber ids so the checker only needs KV reads (the free tier allows few list/write ops per day).
async function idxSet(env, id, add) {
  const cur = JSON.parse((await env.PUSH.get("idx")) || "[]"), has = cur.includes(id);
  if (add === has) return;
  await env.PUSH.put("idx", JSON.stringify(add ? [...cur, id] : cur.filter((x) => x !== id)));
}

export async function pushApi(req, env, path) {
  if (!env.PUSH || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return new Response('{"key":null}', { headers: J });
  if (path === "/api/push/key") return new Response(JSON.stringify({ key: env.VAPID_PUBLIC }), { headers: J });
  if (req.method !== "POST") return new Response("{}", { status: 405, headers: J });
  let b; try { b = await req.json(); } catch (e) { return new Response("{}", { status: 400, headers: J }); }
  if (path === "/api/push/unsub") {
    for (const k of [b.endpoint, typeof b.cid === "string" && b.cid ? "hook:" + b.cid : null]) if (k) { const id = await sid(k); if (await env.PUSH.get(id)) { await env.PUSH.delete(id); await idxSet(env, id, false); } }
    return new Response('{"ok":1}', { headers: J });
  }
  const s = b.sub, hook = typeof b.hook === "string" && HOOK.test(b.hook) ? b.hook : null, cid = typeof b.cid === "string" ? b.cid.slice(0, 40) : "";
  const hasSub = s?.endpoint?.length < 600 && PUSHHOST.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth;
  if (!hasSub && !(hook && cid)) return new Response("{}", { status: 400, headers: J });
  const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 20).filter((r) => r && typeof r.s === "string" && METRICS.includes(r.m) && [">", "<"].includes(r.op) && isFinite(r.v)).map((r) => ({ id: r.id, s: r.s.slice(0, 12), m: r.m, op: r.op, v: +r.v, once: !!r.once }));
  const id = await sid(hasSub ? s.endpoint : "hook:" + cid), old = JSON.parse((await env.PUSH.get(id)) || "{}");
  await env.PUSH.put(id, JSON.stringify({ sub: hasSub ? { endpoint: s.endpoint, keys: s.keys } : undefined, hook: hook || undefined, whale: !!b.whale, rules, fired: old.fired || {} }));
  await idxSet(env, id, true);
  if (hasSub && cid) { const hid = await sid("hook:" + cid); if (await env.PUSH.get(hid)) { await env.PUSH.delete(hid); await idxSet(env, hid, false); } }
  return new Response('{"ok":1}', { headers: J });
}

const fmt = (n) => (Math.abs(n) >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+n.toPrecision(4)));
const NAMES = { price: "Price", chg24: "24h change", fund: "Funding (ann.)", rsi: "RSI 14 (1h)", vsma: "Price vs 50-SMA (1h)" };
const UNIT = { price: "", chg24: "%", fund: "%", rsi: "", vsma: "%" };
const hl = (body) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: J, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));

// Wilder RSI(14) and distance from the 50-period SMA, from 1h closes.
export function indicators(closes) {
  const out = {}; if (closes.length < 51) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= 14; l /= 14;
  for (let i = 15; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; }
  out.rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  const last = closes.slice(-50), sma = last.reduce((a, x) => a + x, 0) / 50;
  out.vsma = (closes[closes.length - 1] / sma - 1) * 100;
  return out;
}

async function notify(rec, title, body) {
  const hook = rec.hook ? fetch(rec.hook, { method: "POST", headers: J, body: JSON.stringify({ content: `**${title}**\n${body}`, text: `*${title}*\n${body}` }) }).catch(() => 0) : null;
  return hook;
}

// Top Hyperliquid whales (from the 30-min snapshot): alert on $1M+ positions opened, closed or flipped. Baseline lives in KV key "wpos".
async function whaleEvents(env, origin) {
  const snap = await (await env.ASSETS.fetch(new Request(origin + "/hl-snap.json"))).json(), top = (snap.whales || []).slice(0, 20), cur = {};
  await Promise.all(top.map(async (w) => {
    try { const st = await hl({ type: "clearinghouseState", user: w.a }); cur[w.a] = {}; for (const { position: p } of st.assetPositions) cur[w.a][p.coin] = Math.round(Math.sign(+p.szi) * +p.positionValue); } catch (e) { /* skip wallet */ }
  }));
  const prev = JSON.parse((await env.PUSH.get("wpos")) || "null"), ev = [], BIG = 1e6, SMALL = 25e4;
  if (prev?.p) for (const a in cur) for (const c of new Set([...Object.keys(cur[a]), ...Object.keys(prev.p[a] || {})])) {
    if (!prev.p[a]) continue;
    const o = prev.p[a][c] || 0, n = cur[a][c] || 0, who = a.slice(0, 6) + "…" + a.slice(-4), side = (v) => (v > 0 ? "LONG" : "SHORT");
    if (Math.abs(o) < SMALL && Math.abs(n) >= BIG) ev.push(`🐋 ${who} opened ${side(n)} ${c} $${fmt(Math.abs(n) / 1e6)}M`);
    else if (Math.abs(o) >= BIG && Math.abs(n) < SMALL) ev.push(`🐋 ${who} closed ${side(o)} ${c} (was $${fmt(Math.abs(o) / 1e6)}M)`);
    else if (Math.abs(o) >= BIG && Math.abs(n) >= BIG && Math.sign(o) !== Math.sign(n)) ev.push(`🐋 ${who} flipped ${c} ${side(o)} → ${side(n)} $${fmt(Math.abs(n) / 1e6)}M`);
  }
  if (Object.keys(cur).length && (!prev?.p || ev.length || Date.now() - (prev.at || 0) > 6 * 36e5)) await env.PUSH.put("wpos", JSON.stringify({ at: Date.now(), p: { ...(prev?.p || {}), ...cur } }));
  return ev.slice(0, 5);
}

export async function checkRules(env, origin) {
  if (!env.PUSH || !env.VAPID_PRIVATE) return;
  const ids = JSON.parse((await env.PUSH.get("idx")) || "[]").filter(Boolean);
  if (!ids.length) return;
  const recs = (await Promise.all(ids.map(async (id) => { const raw = await env.PUSH.get(id); return raw ? { id, rec: JSON.parse(raw) } : null; }))).filter(Boolean);
  const wantWhale = recs.some((x) => x.rec.whale), wantRules = recs.some((x) => x.rec.rules.length);
  if (!wantWhale && !wantRules) return;
  const M = {};
  if (wantRules) {
    const [meta, ctx] = await hl({ type: "metaAndAssetCtxs" });
    meta.universe.forEach((u, i) => { const c = ctx[i], p = +c.markPx, pd = +c.prevDayPx; M[u.name] = { price: p, chg24: pd ? (p / pd - 1) * 100 : null, fund: +c.funding * 24 * 365 * 100 }; });
    const coins = [...new Set(recs.flatMap((x) => x.rec.rules.filter((r) => r.m === "rsi" || r.m === "vsma").map((r) => r.s)))].filter((c) => M[c]).slice(0, 8);
    await Promise.all(coins.map(async (c) => {
      try { const k = await hl({ type: "candleSnapshot", req: { coin: c, interval: "1h", startTime: Date.now() - 90 * 36e5 } }); Object.assign(M[c], indicators(k.map((x) => +x.c))); } catch (e) { /* no indicator this run */ }
    }));
  }
  const wev = wantWhale ? await whaleEvents(env, origin).catch(() => []) : [];
  for (const { id, rec } of recs) {
    let dirty = false, dead = false;
    const send = async (title, body) => {
      if (rec.hook) await notify(rec, title, body);
      if (rec.sub) { const st = await sendPush(rec.sub, { title, body }, env).catch(() => 0); if (st === 404 || st === 410) { if (rec.hook) { rec.sub = undefined; dirty = true; } else dead = true; } }
    };
    for (const rule of [...rec.rules]) {
      const v = M[rule.s]?.[rule.m]; if (v == null || !isFinite(v)) continue;
      if (!(rule.op === ">" ? v > rule.v : v < rule.v)) continue;
      const now = Date.now();
      if (!rule.once && now - (rec.fired[rule.id] || 0) < 18e5) continue;
      await send(`${rule.s} ${NAMES[rule.m]} ${rule.op} ${fmt(rule.v)}`, `Now ${fmt(v)}${UNIT[rule.m]} (Hyperliquid)`);
      if (dead && !rec.hook) break;
      rec.fired[rule.id] = now; dirty = true;
      if (rule.once) rec.rules = rec.rules.filter((x) => x.id !== rule.id);
    }
    if (rec.whale && !(dead && !rec.hook)) for (const e of wev) await send("Whale move", e);
    if (dead && !rec.hook) { await env.PUSH.delete(id); await idxSet(env, id, false); continue; }
    if (dirty) await env.PUSH.put(id, JSON.stringify(rec));
  }
}
