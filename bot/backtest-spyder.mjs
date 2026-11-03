// Backtest of the "Spyder Strategy" (body alignment + body sweep): node bot/backtest-spyder.mjs <tf> <coins> <bars>
// Rules (made concrete from the description):
//  Bearish: candle i-1 closes bearish with a body >= BODY of its range, and its open sits at the same level (within TOL) as the close/open of
//  candle i-2's body top (bodies align). Candle i then sweeps above the body-high of the previous candles (high > max body top) and closes back
//  below it. Enter short at close of i. SL above the sweep high. Bullish is the mirror.
// Exits: fixed R targets; stop is counted first when a candle touches both. Fees ~0.13% round trip. Uses the same /tmp/bt-cache as backtest.mjs.
import fs from "fs";
import { tickers } from "./data.js";

const [tf = "1h", COINS = 40, BARS = 3000] = process.argv.slice(2);
const IV = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" }, MS = { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[tf], HORIZON = { "15m": 200, "1h": 100, "4h": 60, "1d": 30 }[tf];
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
const klines = async (sym) => {
  const f = `${DIR}/k-${sym}-${IV[tf]}-${BARS}.json`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f));
  let end = Date.now(), rows = [];
  while (rows.length < BARS) { const res = await api(`/v5/market/kline?category=linear&symbol=${sym}&interval=${IV[tf]}&end=${end}&limit=1000`); if (!res.list.length) break; rows = rows.concat(res.list); end = +res.list[res.list.length - 1][0] - 1; }
  const out = rows.reverse().map((x) => [+x[0], x[1], x[2], x[3], x[4], x[5], 0, x[6]]); fs.writeFileSync(f, JSON.stringify(out)); return out;
};

function signals(d, i, o) {
  const a = d[i - 2], b = d[i - 1], c = d[i], out = [], rng = b.h - b.l;
  if (!(rng > 0)) return out;
  const bodyB = Math.abs(b.c - b.o) / rng, top = (x) => Math.max(x.o, x.c), bot = (x) => Math.min(x.o, x.c);
  if (b.c < b.o && bodyB >= o.body && Math.abs(top(b) - top(a)) / b.o <= o.tol && c.h > Math.max(top(a), top(b)) && c.c < top(b) && c.c < c.o) out.push({ side: "SHORT", entry: c.c, sl: c.h * (1 + o.buf) });
  if (b.c > b.o && bodyB >= o.body && Math.abs(bot(b) - bot(a)) / b.o <= o.tol && c.l < Math.min(bot(a), bot(b)) && c.c > bot(b) && c.c > c.o) out.push({ side: "LONG", entry: c.c, sl: c.l * (1 - o.buf) });
  return out;
}
function sim(d, i, s, rr) {
  const L = s.side === "LONG", risk = Math.abs(s.entry - s.sl), tp = L ? s.entry + rr * risk : s.entry - rr * risk;
  for (let j = i + 1; j < Math.min(d.length, i + 1 + HORIZON); j++) {
    if (L ? d[j].l <= s.sl : d[j].h >= s.sl) return { r: -1, risk, t: d[j].t };
    if (L ? d[j].h >= tp : d[j].l <= tp) return { r: rr, risk, t: d[j].t };
  }
  return null; // still open at the end of the horizon: excluded
}

const tk = (await tickers()).filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, ""))).sort((a, b) => b.vol - a.vol).slice(0, +COINS);
const VARIANTS = [];
for (const body of [0.6, 0.8]) for (const tol of [0.001, 0.003]) VARIANTS.push({ body, tol, buf: 0.001 });
const res = VARIANTS.map(() => ({ 1: [], 2: [], 3: [] }));
for (const t of tk) {
  const k = await klines(t.symbol); if (k.length < 100) continue;
  const d = k.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
  VARIANTS.forEach((o, vi) => {
    for (let i = 3; i < d.length - 1; i++) for (const s of signals(d, i, o)) for (const rr of [1, 2, 3]) {
      const r = sim(d, i, s, rr); if (r) res[vi][rr].push({ sym: t.symbol, t: d[i].t, r: r.r, net: r.r - FEE / (r.risk / s.entry) });
    }
  });
  console.error(t.symbol, d.length);
}
const stat = (a) => {
  if (!a.length) return "n=0";
  const w = a.filter((x) => x.r > 0).length, avg = (f) => a.reduce((s, x) => s + x[f], 0) / a.length, srt = a.slice().sort((x, y) => x.t - y.t), h = srt.length >> 1;
  const half = (z) => (z.length ? (z.reduce((s, x) => s + x.net, 0) / z.length).toFixed(2) : "-");
  return `n=${a.length} win=${Math.round((100 * w) / a.length)}% avgR(gross)=${avg("r").toFixed(2)} avgR(net)=${avg("net").toFixed(2)} halves(net)=${half(srt.slice(0, h))}/${half(srt.slice(h))}`;
};
console.log(JSON.stringify({ tf, coins: tk.length, bars: BARS, horizon: HORIZON }));
VARIANTS.forEach((o, vi) => { for (const rr of [1, 2, 3]) console.log(`body>=${o.body} tol=${o.tol * 100}% TP=${rr}R`.padEnd(34), stat(res[vi][rr])); });
