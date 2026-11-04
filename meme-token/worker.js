import { pushApi, checkRules } from "./push.js";
// Serves the static site and proxies the BTC ETF holdings JSON (the source has no CORS headers).
const ETF_URL = "https://btcetfdata.com/etfs.v1.current.json";

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/api/macro") return macro(u.origin);
    if (u.pathname === "/api/options") return options(u.origin, u.searchParams.get("c") === "ETH" ? "ETH" : "BTC");
    if (u.pathname === "/api/sol-whales") return solWhales(env, u.origin);
    if (u.pathname === "/api/okx-inst") {
      const cache = caches.default, key = new Request(u.origin + "/api/okx-inst"), hit = await cache.match(key);
      if (hit) return hit;
      try {
        const j = await (await fetch("https://www.okx.com/api/v5/public/instruments?instType=SWAP", { headers: { "user-agent": "spyder-trench" } })).json(), o = {};
        for (const i of j.data) o[i.instId] = [+i.ctVal, i.ctValCcy === "USD" ? 1 : 0];
        const res = new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" } });
        await cache.put(key, res.clone()); return res;
      } catch (e) { return new Response("{}", { status: 502, headers: { "content-type": "application/json" } }); }
    }
    if (u.pathname === "/api/push/run") {
      if (!env.PUSH_RUN_KEY || req.headers.get("x-run-key") !== env.PUSH_RUN_KEY) return new Response("{}", { status: 403 });
      await checkRules(env); return new Response('{"ok":1}');
    }
    if (u.pathname.startsWith("/api/push/")) return pushApi(req, env, u.pathname);
    if (u.pathname !== "/api/etf") return env.ASSETS.fetch(req);
    const cache = caches.default, key = new Request(u.origin + "/api/etf");
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      const up = await fetch(ETF_URL, { headers: { "user-agent": "spyder-trench" } });
      const res = new Response(await up.text(), { status: up.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
      if (up.ok) await cache.put(key, res.clone());
      return res;
    } catch (e) {
      return new Response('{"error":"upstream"}', { status: 502, headers: { "content-type": "application/json" } });
    }
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(checkRules(env)); },
};

// Large Jupiter swaps (SOL <-> token) via Helius; the key stays server-side as the HELIUS_KEY secret.
const STABLE = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", MIN_SOL = 3, J = { "content-type": "application/json" };
async function solWhales(env, origin) {
  if (!env.HELIUS_KEY) return new Response('{"error":"no key"}', { status: 503, headers: J });
  const cache = caches.default, key = new Request(origin + "/api/sol-whales");
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const up = await fetch(`https://api.helius.xyz/v0/addresses/${JUP}/transactions?api-key=${env.HELIUS_KEY}&type=SWAP&limit=100`);
    if (!up.ok) return new Response('{"error":"upstream"}', { status: 502, headers: J });
    const out = [];
    for (const t of await up.json()) {
      const s = t.events?.swap; if (!s) continue;
      const buy = s.nativeInput && s.tokenOutputs?.length, sell = s.nativeOutput && s.tokenInputs?.length;
      const lam = buy ? +s.nativeInput.amount : sell ? +s.nativeOutput.amount : 0, sol = lam / 1e9;
      if (sol < MIN_SOL) continue;
      const mint0 = (buy ? s.tokenOutputs[0] : s.tokenInputs[0]).mint; if (STABLE.has(mint0)) continue;
      out.push({ sig: t.signature, ts: t.timestamp, w: t.feePayer, side: buy ? "buy" : "sell", sol, mint: (buy ? s.tokenOutputs[0] : s.tokenInputs[0]).mint });
    }
    const res = new Response(JSON.stringify(out), { headers: { ...J, "cache-control": "public, max-age=8" } });
    await cache.put(key, res.clone());
    return res;
  } catch (e) {
    return new Response('{"error":"fail"}', { status: 502, headers: J });
  }
}

// Deribit option chain summary: OI by expiry / strike, put-call ratio and max pain (source has no CORS).
async function options(origin, cur) {
  const cache = caches.default, key = new Request(origin + "/api/options?c=" + cur);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const up = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`);
    if (!up.ok) return new Response('{"error":"upstream"}', { status: 502, headers: J });
    const rows = (await up.json()).result, ex = {};
    let spot = 0;
    for (const r of rows) {
      const [, d, k, t] = r.instrument_name.split("-"), strike = +k, oi = r.open_interest || 0;
      spot = r.underlying_price || spot;
      const e = ex[d] || (ex[d] = { d, call: 0, put: 0, k: {} });
      e[t === "C" ? "call" : "put"] += oi;
      const s = e.k[strike] || (e.k[strike] = { c: 0, p: 0 });
      s[t === "C" ? "c" : "p"] += oi;
    }
    const out = Object.values(ex).map((e) => {
      const ks = Object.keys(e.k).map(Number);
      let best = 0, pain = Infinity;
      for (const x of ks) {
        let v = 0;
        for (const k of ks) v += e.k[k].c * Math.max(0, x - k) + e.k[k].p * Math.max(0, k - x);
        if (v < pain) { pain = v; best = x; }
      }
      const near = ks.filter((k) => spot && Math.abs(k - spot) < spot * 0.5).sort((a, b) => a - b).map((k) => [k, e.k[k].c, e.k[k].p]);
      return { d: e.d, call: e.call, put: e.put, pain: best, strikes: near };
    });
    const res = new Response(JSON.stringify({ cur, spot, ex: out, ts: Date.now() }), { headers: { ...J, "cache-control": "public, max-age=120" } });
    await cache.put(key, res.clone());
    return res;
  } catch (e) {
    return new Response('{"error":"fail"}', { status: 502, headers: J });
  }
}

// Polymarket top events by 24h volume, trimmed (source has no CORS).
async function macro(origin) {
  const cache = caches.default, key = new Request(origin + "/api/macro");
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const up = await fetch("https://gamma-api.polymarket.com/events?limit=40&active=true&closed=false&order=volume24hr&ascending=false");
    if (!up.ok) return new Response('{"error":"upstream"}', { status: 502, headers: J });
    const out = [];
    for (const e of await up.json()) {
      const ms = (e.markets || []).filter((m) => m.outcomePrices && !m.closed).sort((a, b) => (+b.volume24hr || 0) - (+a.volume24hr || 0));
      const m = ms[0]; if (!m) continue;
      let names, prices;
      try { names = JSON.parse(m.outcomes); prices = JSON.parse(m.outcomePrices).map(Number); } catch (x) { continue; }
      out.push({ t: e.title, q: m.question, v24: +e.volume24hr || 0, liq: +e.liquidity || 0, end: m.endDate, o: names.map((n, i) => [n, prices[i]]).slice(0, 3), slug: e.slug });
    }
    const res = new Response(JSON.stringify(out.slice(0, 25)), { headers: { ...J, "cache-control": "public, max-age=300" } });
    await cache.put(key, res.clone());
    return res;
  } catch (e) {
    return new Response('{"error":"fail"}', { status: 502, headers: J });
  }
}

