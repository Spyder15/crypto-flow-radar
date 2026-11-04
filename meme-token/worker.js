// Serves the static site and proxies the BTC ETF holdings JSON (the source has no CORS headers).
const ETF_URL = "https://btcetfdata.com/etfs.v1.current.json";

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/api/sol-whales") return solWhales(env, u.origin);
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
