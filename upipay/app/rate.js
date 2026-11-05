// INR per USDC: live market price plus a spread, cached, with a fixed fallback.
const TTL_MS = 60_000;
let cached = null;

async function marketRate() {
  const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=inr', { signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  const v = j?.['usd-coin']?.inr;
  if (!(v > 0)) throw new Error('bad rate payload');
  return v;
}

// Payers pay the market rate plus `spreadPct` (the LP's margin).
async function getRate({ fallback, spreadPct = 1 }) {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let market = fallback, source = 'fallback';
  try { market = await marketRate(); source = 'coingecko'; } catch { /* keep fallback */ }
  const value = { rate: Number((market * (1 + spreadPct / 100)).toFixed(2)), market, spreadPct, source };
  cached = { at: Date.now(), value };
  return value;
}

module.exports = { getRate };
