// Backtest of the quant bot's real signal/trail logic on Bybit 1h candles (fees + slippage included).
// Usage: node quant-backtest.mjs [bars=4000] [symbols=30]   (funding fade needs live funding, so it is not tested here)
import { signal, trail, CFG, HOLD_H } from "./quant-bot.js";

const BARS = +process.argv[2] || 4000, NSYM = +process.argv[3] || 30;
const MACRO = ["XAUUSDT", "XAGUSDT", "CLUSDT", "EURUSDUSDT", "GBPUSDUSDT", "USDJPYUSDT", "QQQUSDT", "SPYUSDT", "SPXUSDT"];
const api = async (p) => { const r = await (await fetch("https://api.bybit.com" + p, { headers: { "user-agent": "Mozilla/5.0" } })).json(); if (r.retCode !== 0) throw new Error(p + " " + r.retMsg); return r.result; };

async function history(sym) {
  let out = [], end = Date.now();
  while (out.length < BARS) {
    const r = (await api(`/v5/market/kline?category=linear&symbol=${sym}&interval=60&limit=1000&end=${end}`)).list;
    if (!r.length) break;
    out = out.concat(r.map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })));
    end = +r[r.length - 1][0] - 1;
  }
  return out.reverse();
}

function run(sym, k) {
  const trades = [];
  for (let i = 60; i < k.length - 2; i++) {
    const sg = signal(k.slice(0, i + 1), null);
    if (!sg || sg.strat === "fund") continue;
    const dir = sg.side === "long" ? 1 : -1, px = k[i].c, entry = px * (1 + dir * CFG.slip);
    const t = { side: sg.side, entry, sl: sg.sl, tp: sg.tp, t0: k[i].t };
    const dist = Math.abs(entry - sg.sl); if (!dist) continue;
    let exit = null, reason = "TIME", j = i + 1;
    for (; j < k.length; j++) {
      const c = k[j], stop = t.tsl ?? t.sl;
      if (dir > 0 ? c.l <= stop : c.h >= stop) { exit = stop * (1 - dir * CFG.slip); reason = t.tsl != null ? "TRAIL" : "SL"; break; }
      if (dir > 0 ? c.h >= t.tp : c.l <= t.tp) { exit = t.tp; reason = "TP"; break; }
      trail(t, c);
      if ((c.t - t.t0) / 36e5 >= HOLD_H[sg.strat]) { exit = c.c; break; }
    }
    if (exit == null) break;
    const fees = (entry + exit) * CFG.fee / 2;
    trades.push({ sym, strat: sg.strat, reason, r: (dir * (exit - entry) - fees) / dist });
    i = j; // one trade per symbol at a time
  }
  return trades;
}

const stats = (a) => {
  const w = a.filter((x) => x.r > 0), l = a.filter((x) => x.r <= 0), gw = w.reduce((s, x) => s + x.r, 0), gl = -l.reduce((s, x) => s + x.r, 0);
  let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x.r; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: a.length, win: a.length ? +(w.length / a.length * 100).toFixed(0) : 0, pf: gl ? +(gw / gl).toFixed(2) : null, expR: a.length ? +(eq / a.length).toFixed(3) : 0, totalR: +eq.toFixed(1), maxDD_R: +dd.toFixed(1) };
};

const tk = (await api("/v5/market/tickers?category=linear")).list.filter((t) => t.symbol.endsWith("USDT")).sort((a, b) => b.turnover24h - a.turnover24h).map((t) => t.symbol);
const syms = [...new Set([...tk.slice(0, NSYM), ...MACRO.filter((s) => tk.includes(s))])];
let all = [];
for (const s of syms) {
  try { const k = await history(s); const t = run(s, k); all = all.concat(t); console.log(s.padEnd(14), k.length, "bars", JSON.stringify(stats(t))); } catch (e) { console.log(s, "skip", e.message); }
}
console.log("\nALL", JSON.stringify(stats(all)));
for (const s of ["mom", "mr"]) console.log(s, JSON.stringify(stats(all.filter((t) => t.strat === s))));
for (const r of ["SL", "TP", "TRAIL", "TIME"]) console.log("exit " + r, all.filter((t) => t.reason === r).length);
console.log(`(R = risk multiple; at ${CFG.riskPct}% risk per trade, totalR x ${CFG.riskPct}% ~ account return, no compounding)`);
