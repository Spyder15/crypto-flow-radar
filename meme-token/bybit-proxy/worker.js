// Read-only Bybit market-data proxy. Bybit blocks US IPs (GitHub Actions and US Cloudflare edges),
// so this worker is pinned to Mumbai with a placement hint and the quant bot calls it instead.
const HOSTS = ["https://api.bybit.com", "https://api.bytick.com", "https://api.bybitglobal.com", "https://api.bybit.nl"];
export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method !== "GET" || !/^\/v5\/market\/(tickers|kline)$/.test(u.pathname)) return new Response("{}", { status: 404 });
    let status = 502;
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + u.pathname + u.search, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
        if (r.ok) return new Response(await r.text(), { headers: { "content-type": "application/json", "cache-control": "public, max-age=15" } });
        status = r.status;
      } catch { /* try next host */ }
    }
    return new Response(JSON.stringify({ error: "upstream " + status }), { status: 502 });
  },
};
