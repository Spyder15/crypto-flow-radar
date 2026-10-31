// Offline backtest of the bot's rules on Bybit history: node bot/backtest.mjs <tf> <coins> <bars>
// Same signal rules, confirmations and TP/SL management as the live bot. Not live-identical: open interest and funding history are not available,
// so the OI part of "Trend 5/5" is assumed to pass when the other four trend checks pass, and funding is treated as ok (optimistic on both).
import Lib from "../smc-screener/lib.js";
import { tickers } from "./data.js";
import { buildRow, findSignals, confirmations, TF_MS } from "./signals.js";
import { evaluate } from "./track.js";

const [tf = "1h", COINS = 20, BARS = 3000] = process.argv.slice(2), IV = { "15m": "15", "1h": "60", "4h": "240" }, WIN = 400, HORIZON = tf === "15m" ? 672 : 168;
const SKIP = /^(XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD)$/;
const FEE = 0.0013; // ~0.055% taker per side + slippage, as a fraction of price

async function history(sym) {
  let end = Date.now(), rows = [];
  while (rows.length < BARS) {
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${IV[tf]}&end=${end}&limit=1000`, { headers: { "user-agent": "Mozilla/5.0" } });
    const j = await r.json(); if (j.retCode !== 0 || !j.result.list.length) break;
    rows = rows.concat(j.result.list); end = +j.result.list[j.result.list.length - 1][0] - 1;
  }
  return rows.reverse().map((x) => [+x[0], x[1], x[2], x[3], x[4], x[5], 0, x[6]]);
}

const tk = (await tickers()).filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, ""))).sort((a, b) => b.vol - a.vol).slice(0, +COINS);
const trades = [];
for (const t of tk) {
  const k = await history(t.symbol); if (k.length < WIN + 50) continue;
  const all = Lib.parseKlines(k), per = Math.round(86400e3 / TF_MS[tf]);
  for (let i = WIN; i < all.length - 2; i++) {
    const kk = k.slice(i - WIN + 1, i + 1); kk.push(k[i]); // buildRow drops the last (forming) row, so add a dummy
    const r = buildRow(t.symbol, kk, null); if (!r) continue;
    const V = { fib_base: {}, fib_trend: { trend: true }, fib_gp: { gp: true }, fib_leg4: { minLeg: 4 }, fib_wick: { wick: true }, fib_all: { trend: true, gp: true, minLeg: 4, wick: true }, fib_t_leg: { trend: true, minLeg: 4 } };
    const sigs = process.env.FIBV ? Object.entries(V).flatMap(([n, o]) => findSignals(r, tf, { fib: o }).filter((x) => x.kind === "FIB RETRACE").map((x) => Object.assign(x, { kind: n }))) : findSignals(r, tf, { ema: true, fib: true });
    for (const s of sigs) {
      const an = Lib.analyze(r.d, null), ts = an ? (s.side === "LONG" ? an.bull : an.bear) : 0;
      const ck = confirmations(r, s.side, tf, ts >= 4 ? 5 : 0); ck.fund = true;
      const passed = Object.values(ck).filter(Boolean).length; if (passed < 5) continue;
      let tps = s.tps;
      if (s.fib && process.env.FIBTP) { const { from, to } = s.fib, g = to - from; tps = [to, to + 0.272 * g, to + 0.618 * g]; if (tps.some((x, j) => (s.side === "LONG" ? x <= s.entry : x >= s.entry))) continue; }
      const tr = { side: s.side, entry: s.entry, sl: s.sl, tps, stage: 0, cursor: 0 };
      evaluate(tr, all.slice(i + 1, i + 1 + HORIZON));
      const cost = FEE / (s.riskPct / 100);
      trades.push({ sym: t.symbol, side: s.side, kind: s.kind, passed, out: tr.closed ? tr.outcome : "OPEN", r: tr.closed ? tr.r : null, net: tr.closed ? tr.r - cost : null, t: all[i].t });
    }
  }
  console.error(t.symbol, k.length, "bars, trades so far", trades.length);
}

const stat = (arr) => {
  const c = arr.filter((x) => x.r !== null), w = c.filter((x) => x.r > 0.05).length, l = c.filter((x) => x.r < -0.05).length;
  const sum = (f) => c.reduce((a, x) => a + x[f], 0);
  return { signals: arr.length, closed: c.length, wins: w, losses: l, be: c.length - w - l, winPct: w + l ? +(100 * w / (w + l)).toFixed(0) : null, grossR: +sum("r").toFixed(1), netR: +sum("net").toFixed(1), avgNetR: c.length ? +(sum("net") / c.length).toFixed(2) : null };
};
console.log(JSON.stringify({ tf, coins: tk.length, bars: BARS }));
for (const m of [5, 6, 7, 8]) console.log(`>= ${m}/8`, JSON.stringify(stat(trades.filter((x) => x.passed >= m))));
for (const kind of process.env.FIBV ? Object.keys({ fib_base: 1, fib_trend: 1, fib_gp: 1, fib_leg4: 1, fib_wick: 1, fib_all: 1, fib_t_leg: 1 }) : ["EMA RETEST", "FIB RETRACE", "CHoCH", "BOS"]) console.log(`${kind} (>=7)`, JSON.stringify(stat(trades.filter((x) => x.passed >= 7 && x.kind === kind))));
for (const side of ["LONG", "SHORT"]) console.log(`${side} (>=7)`, JSON.stringify(stat(trades.filter((x) => x.passed >= 7 && x.side === side))));
console.log("outcomes (>=7)", JSON.stringify(trades.filter((x) => x.passed >= 7).reduce((a, x) => ((a[x.out] = (a[x.out] || 0) + 1), a), {})));
