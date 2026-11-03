// Market data from Bybit public API (Binance blocks Cloudflare Workers with 403).
const HOSTS = ["https://api.bybit.com", "https://api.bytick.com", "https://api.bybitglobal.com", "https://api.bybit.nl", "https://api.bybit.kz", "https://api.byhkbit.com"];
const IV = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const OI_IV = { "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d" };

async function get(path) {
  let last = "";
  for (let round = 0; round < 1; round++) { // one pass only: every failed host costs a subrequest (free plan limit 50 per run)
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + path, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
        if (r.ok) { const j = await r.json(); if (j.retCode === 0) return j.result; last = "retCode " + j.retCode; } else last = String(r.status);
      } catch (e) { last = e.message; }
    }
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
  const res = await get(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${IV[tf]}&limit=${tf === "15m" ? 1000 : 400}`);
  return res.list.slice().reverse().map((x) => [+x[0], x[1], x[2], x[3], x[4], x[5], 0, x[6]]);
}

// Open interest history (oldest first) for the trend score's OI check.
export async function openInterest(symbol, tf) {
  const res = await get(`/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${OI_IV[tf]}&limit=5`);
  return res.list.slice().reverse().map((x) => +x.openInterest);
}

// 15m candles since `start` (ms), oldest first, for TP/SL tracking. Includes the forming candle; caller filters.
export async function klines15(symbol, start) {
  const res = await get(`/v5/market/kline?category=linear&symbol=${symbol}&interval=15&start=${start}&limit=1000`);
  return res.list.slice().reverse().map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
}
