// Offline backtest of the live rules on Bybit history: node bot/backtest.mjs <tf> <coins> <bars> [SYM,SYM...]
// Uses the bot's own signal rules, confirmations and TP/SL management, with real open-interest and funding history,
// fees (~0.13% round trip) and a few filters/exit variants. History is cached in /tmp/bt-cache.
import fs from "fs";
import Lib from "../smc-screener/lib.js";
import { tickers } from "./data.js";
import { buildRow, findSignals, confirmations, TF_MS } from "./signals.js";
import { evaluate } from "./track.js";

const [tf = "1h", COINS = 20, BARS = 3000, FIXED = ""] = process.argv.slice(2);
const IV = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" }, OI_IV = { "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d" };
const HTF = { "15m": "1h", "1h": "4h", "4h": "1d" }, WIN = 400, HORIZON = { "15m": 672, "1h": 168, "4h": 90, "1d": 60 }[tf];
const STRAT = { "1h": {}, "4h": { fib: { minLeg: 4 } }, "1d": {}, "15m": {} }[tf];
const SKIP = /^(XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD)$/;
const FEE = 0.0013, DIR = "/tmp/bt-cache";
fs.mkdirSync(DIR, { recursive: true });

async function api(path) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch("https://api.bybit.com" + path, { headers: { "user-agent": "Mozilla/5.0" } }); const j = await r.json(); if (j.retCode === 0) return j.result; } catch (e) { /* retry */ }
    await new Promise((x) => setTimeout(x, 400));
  }
  return { list: [] };
}
const cached = async (name, fn) => { const f = `${DIR}/${name}.json`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)); const v = await fn(); fs.writeFileSync(f, JSON.stringify(v)); return v; };

const klines = (sym, itv, bars) => cached(`k-${sym}-${itv}-${bars}`, async () => {
  let end = Date.now(), rows = [];
  while (rows.length < bars) { const res = await api(`/v5/market/kline?category=linear&symbol=${sym}&interval=${IV[itv]}&end=${end}&limit=1000`); if (!res.list.length) break; rows = rows.concat(res.list); end = +res.list[res.list.length - 1][0] - 1; }
  return rows.reverse().map((x) => [+x[0], x[1], x[2], x[3], x[4], x[5], 0, x[6]]);
});
const oiHist = (sym, from) => cached(`oi-${sym}-${tf}-${from}`, async () => {
  let end = Date.now(), out = new Map();
  for (let g = 0; g < 80; g++) {
    const res = await api(`/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=${OI_IV[tf]}&endTime=${end}&limit=200`); if (!res.list.length) break;
    res.list.forEach((x) => out.set(+x.timestamp, +x.openInterest));
    const oldest = +res.list[res.list.length - 1].timestamp; if (oldest <= from) break; end = oldest - 1;
  }
  return [...out.entries()];
});
const fundHist = (sym, from) => cached(`fu-${sym}-${from}`, async () => {
  let end = Date.now(), out = [];
  for (let g = 0; g < 30; g++) {
    const res = await api(`/v5/market/funding/history?category=linear&symbol=${sym}&endTime=${end}&limit=200`); if (!res.list.length) break;
    res.list.forEach((x) => out.push([+x.fundingRateTimestamp, +x.fundingRate * 100]));
    const oldest = +res.list[res.list.length - 1].fundingRateTimestamp; if (oldest <= from) break; end = oldest - 1;
  }
  return out.sort((a, b) => a[0] - b[0]);
});

// Trend of an EMA50/EMA200 pair as of time `t` (candle must be closed): +1 up, -1 down, 0 unknown.
function trendSeries(k, itv) {
  const d = Lib.parseKlines(k), c = d.map((x) => x.c), e50 = Lib.ema(c, 50), e200 = Lib.ema(c, 200), ms = TF_MS[itv];
  return (t) => { let lo = 0, hi = d.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m].t + ms <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans < 200 ? 0 : e50[ans] > e200[ans] ? 1 : -1; };
}

const ms = TF_MS[tf], htf = HTF[tf], hBars = htf ? Math.ceil(BARS * ms / TF_MS[htf]) + 300 : 0;
const tk = FIXED ? FIXED.split(",").map((symbol) => ({ symbol })) : (await tickers()).filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, ""))).sort((a, b) => b.vol - a.vol).slice(0, +COINS);
const from = Date.now() - BARS * ms;
const btcTrend = htf ? trendSeries(await klines("BTCUSDT", htf, hBars), htf) : () => 0;
const trades = [];
for (const t of tk) {
  const k = await klines(t.symbol, tf, BARS); if (k.length < WIN + 50) continue;
  const oi = new Map(await oiHist(t.symbol, from)), fu = await fundHist(t.symbol, from);
  const coinTrend = htf ? trendSeries(await klines(t.symbol, htf, hBars), htf) : () => 0;
  const all = Lib.parseKlines(k);
  for (let i = WIN; i < all.length - 2; i++) {
    const kk = k.slice(i - WIN + 1, i + 1); kk.push(k[i]); // buildRow drops the last (forming) row, so add a dummy
    const close = all[i].t + ms; let f = null; for (let j = fu.length - 1; j >= 0; j--) if (fu[j][0] <= close) { f = fu[j][1]; break; }
    const r = buildRow(t.symbol, kk, f); if (!r) continue;
    const sigs = findSignals(r, tf, STRAT); if (!sigs.length) continue;
    const oiArr = []; for (let j = i - 4; j <= i; j++) if (oi.has(all[j].t)) oiArr.push(oi.get(all[j].t));
    for (const s of sigs) {
      const an = Lib.analyze(r.d, oiArr.length >= 3 ? oiArr : null), ts = an ? (s.side === "LONG" ? an.bull : an.bear) : 0;
      const ck = confirmations(r, s.side, tf, ts), passed = Object.values(ck).filter(Boolean).length; if (passed < 6) continue;
      const tr = { side: s.side, entry: s.entry, sl: s.sl, tps: s.tps, stage: 0, cursor: 0 };
      const ev = evaluate(tr, all.slice(i + 1, i + 1 + HORIZON)), dir = s.side === "LONG" ? 1 : -1, cost = FEE / (s.riskPct / 100);
      const rr = tr.closed ? tr.r : null, part = !tr.closed ? null : { SL: -1, BE: 0.5, TP1STOP: 1, TP3: 0.5 + 0.5 * tr.r }[tr.outcome];
      trades.push({ sym: t.symbol, side: s.side, kind: s.kind, passed, out: tr.closed ? tr.outcome : "OPEN", r: rr, net: rr === null ? null : rr - cost, pnet: part == null ? null : part - cost, t: all[i].t, end: tr.closed ? ev[ev.length - 1].t : Infinity, htf: coinTrend(close) === dir, btc: btcTrend(close) === dir });
    }
  }
  console.error(t.symbol, k.length, "bars, trades", trades.length);
}

const stat = (arr, f = "net") => {
  const c = arr.filter((x) => x[f] !== null), w = c.filter((x) => x.r > 0.05).length, l = c.filter((x) => x.r < -0.05).length;
  const sum = c.reduce((a, x) => a + x[f], 0);
  return JSON.stringify({ n: c.length, win: w + l ? Math.round(100 * w / (w + l)) + "%" : "-", netR: +sum.toFixed(1), avgR: c.length ? +(sum / c.length).toFixed(2) : null });
};
// One open trade per coin: skip a signal while the previous accepted trade on that coin is still running.
const oneOpen = (arr) => { const last = {}, out = []; for (const x of arr.slice().sort((a, b) => a.t - b.t)) { if (last[x.sym] !== undefined && x.t < last[x.sym]) continue; last[x.sym] = x.end; out.push(x); } return out; };
const q = trades.filter((x) => x.passed >= 7), mid = q.length ? q.slice().sort((a, b) => a.t - b.t)[Math.floor(q.length / 2)].t : 0;
console.log(JSON.stringify({ tf, coins: tk.length, bars: BARS, signals6: trades.length }));
for (const m of [6, 7, 8]) console.log(`>=${m}/8 all`, stat(trades.filter((x) => x.passed >= m)));
console.log("base >=7, full exits   ", stat(q));
console.log("base >=7, 50% at TP1    ", stat(q, "pnet"));
console.log("+ coin HTF trend        ", stat(q.filter((x) => x.htf)));
console.log("+ BTC HTF trend         ", stat(q.filter((x) => x.btc)));
console.log("+ both                  ", stat(q.filter((x) => x.htf && x.btc)));
console.log("one open per coin       ", stat(oneOpen(q)));
console.log("one open + htf          ", stat(oneOpen(q.filter((x) => x.htf))));
console.log("first half / second half", stat(q.filter((x) => x.t < mid)), stat(q.filter((x) => x.t >= mid)));
for (const kind of [...new Set(q.map((x) => x.kind))]) console.log("kind", kind.padEnd(12), stat(q.filter((x) => x.kind === kind)));
for (const side of ["LONG", "SHORT"]) console.log(side.padEnd(18), stat(q.filter((x) => x.side === side)));
