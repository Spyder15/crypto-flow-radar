// Market data from Bybit public API (Binance blocks Cloudflare Workers with 403).
const HOSTS = ["https://api.bybit.com", "https://api.bytick.com"];
const IV = { "1h": "60", "4h": "240", "1d": "D" };

async function get(path) {
  let last = "";
  for (const h of HOSTS) {
    const r = await fetch(h + path, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
    if (r.ok) { const j = await r.json(); if (j.retCode === 0) return j.result; last = "retCode " + j.retCode; } else last = String(r.status);
  }
  throw new Error(`${path} -> ${last}`);
}

// All linear USDT perps with 24h turnover and funding in one call.
export async function tickers() {
  const res = await get("/v5/market/tickers?category=linear");
  return res.list.filter((t) => t.symbol.endsWith("USDT")).map((t) => ({ symbol: t.symbol, vol: +t.turnover24h, fund: t.fundingRate === "" ? null : +t.fundingRate * 100 }));
}

// Same row layout as Binance klines (oldest first, last = forming candle).
export async function klines(symbol, tf) {
  const res = await get(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${IV[tf]}&limit=400`);
  return res.list.slice().reverse().map((x) => [+x[0], x[1], x[2], x[3], x[4], x[5], 0, x[6]]);
}
