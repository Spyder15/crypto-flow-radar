// Serves the static site and proxies the BTC ETF holdings JSON (the source has no CORS headers).
const ETF_URL = "https://btcetfdata.com/etfs.v1.current.json";

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
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
