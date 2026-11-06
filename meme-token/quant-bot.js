// Paper quant bot: fake money, Bybit public data only, no keys, no real orders.
// Strategies: momentum (Donchian breakout), mean reversion (RSI + Bollinger), funding fade.
// State lives in site/quant.json (committed, so every deploy serves it to the website).
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const FILE = new URL("./site/quant.json", import.meta.url);
const CFG = { start: 1000, riskPct: 0.5, maxOpen: 10, maxSide: 6, maxLev: 5, fee: 0.0011, slip: 0.0005, dayStopPct: 3, topN: 40, fundTh: 0.05 };
const HOSTS = ["https://bybit-proxy.spyder-radar.workers.dev", "https://api.bybit.com", "https://api.bytick.com", "https://api.bybitglobal.com"];
// Backtest (quant-backtest.mjs): gold/silver/oil/forex/index perps lose with these crypto-tuned strategies (PF 0.1-0.6), so they are off.
// Add symbols like "XAUUSDT" here to always scan them again.
const MACRO = [];
const HOLD_H = { mom: 48, mr: 24, fund: 24 };

async function get(path) {
  let last = "";
  for (const h of HOSTS) {
    try {
      const r = await fetch(h + path, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
      if (r.ok) { const j = await r.json(); if (j.retCode === 0) return j.result; last = "retCode " + j.retCode; } else last = String(r.status);
    } catch (e) { last = e.message; }
  }
  throw new Error(path + " -> " + last);
}
const candles = (sym, iv, extra = "") => get(`/v5/market/kline?category=linear&symbol=${sym}&interval=${iv}&limit=${iv === "60" ? 200 : 1000}${extra}`)
  .then((r) => r.list.slice().reverse().map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })));

const sma = (a, n) => a.slice(-n).reduce((s, v) => s + v, 0) / n;
const sd = (a, n) => { const m = sma(a, n); return Math.sqrt(a.slice(-n).reduce((s, v) => s + (v - m) ** 2, 0) / n); };
function rsi(c, n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atr(k, n = 14) {
  const tr = k.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - k[i].c), Math.abs(x.l - k[i].c)));
  return sma(tr, n);
}

// Returns {side, strat, sl, tp, why} for the last CLOSED candle, or null.
function signal(k, fund, off = new Set()) {
  const cl = k.map((x) => x.c), n = cl.length - 1, px = cl[n], a = atr(k);
  if (!a) return null;
  const hi = Math.max(...k.slice(n - 20, n).map((x) => x.h)), lo = Math.min(...k.slice(n - 20, n).map((x) => x.l));
  const s50 = sma(cl, 50), r = rsi(cl), m20 = sma(cl, 20), s20 = sd(cl, 20);
  const slope = s50 - sma(cl.slice(0, -10), 50);
  if (!off.has("mom") && px > hi && px > s50 && slope > 0) return { side: "long", strat: "mom", sl: px - 2 * a, tp: px + 4 * a, why: `breakout 20h high, RSI ${r.toFixed(0)}` };
  if (!off.has("mom") && px < lo && px < s50 && slope < 0) return { side: "short", strat: "mom", sl: px + 2 * a, tp: px - 4 * a, why: `breakdown 20h low, RSI ${r.toFixed(0)}` };
  const flat = Math.abs(slope) / px < 0.01; // mean reversion only in a ranging market
  if (!off.has("mr") && flat && r < 25 && px < m20 - 2 * s20) return { side: "long", strat: "mr", sl: px - 1.5 * a, tp: m20, why: `RSI ${r.toFixed(0)} below lower band` };
  if (!off.has("mr") && flat && r > 75 && px > m20 + 2 * s20) return { side: "short", strat: "mr", sl: px + 1.5 * a, tp: m20, why: `RSI ${r.toFixed(0)} above upper band` };
  if (!off.has("fund") && fund != null && fund >= CFG.fundTh && px < cl[n - 1]) return { side: "short", strat: "fund", sl: px + 2 * a, tp: px - 2 * a, why: `funding ${fund.toFixed(3)}% crowded longs, price rolling over` };
  if (!off.has("fund") && fund != null && fund <= -CFG.fundTh && px > cl[n - 1]) return { side: "long", strat: "fund", sl: px - 2 * a, tp: px + 2 * a, why: `funding ${fund.toFixed(3)}% crowded shorts, price turning up` };
  return null;
}

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* first run */ }
  return { cfg: CFG, equity: CFG.start, peak: CFG.start, open: [], closed: [], curve: [], days: {}, seen: {}, halted: "" };
}

// move the stop to breakeven after +1R, then trail 1R behind the best price; sl itself (shown on the site) never changes
function trail(t, c) {
  const dir = t.side === "long" ? 1 : -1, r0 = Math.abs(t.entry - t.sl);
  t.best = dir > 0 ? Math.max(t.best ?? t.entry, c.h) : Math.min(t.best ?? t.entry, c.l);
  const gain = dir * (t.best - t.entry);
  if (gain >= r0) { const ns = t.best - dir * r0; t.tsl = dir > 0 ? Math.max(t.tsl ?? t.sl, ns, t.entry) : Math.min(t.tsl ?? t.sl, ns, t.entry); }
}
// funding paid (+) or received (-) while the trade was open; rate is % per 8h
const fundCost = (t, now) => (t.side === "long" ? 1 : -1) * t.qty * t.entry * ((t.fr || 0) / 100) * ((now - t.t0) / 288e5);
const pnlOf = (t, px) => (t.side === "long" ? px - t.entry : t.entry - px) * t.qty;

function close(st, t, px, reason, now) {
  const gross = pnlOf(t, px), fees = t.qty * (t.entry + px) * CFG.fee / 2, fund = fundCost(t, now);
  const pnl = gross - fees - fund;
  st.equity += pnl;
  const day = new Date(now).toISOString().slice(0, 10);
  st.days[day] = (st.days[day] || 0) + pnl;
  st.closed.unshift({ id: t.id, sym: t.sym, side: t.side, strat: t.strat, entry: t.entry, exit: px, sl: t.sl, tp: t.tp, fund: +fund.toFixed(2), pnl: +pnl.toFixed(2), r: +(pnl / t.risk).toFixed(2), reason, t0: t.t0, t1: now });
  st.closed = st.closed.slice(0, 300);
}

async function main() {
  const st = load(), now = Date.now();
  const all = (await get("/v5/market/tickers?category=linear")).list.filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => ({ sym: t.symbol, vol: +t.turnover24h, fund: t.fundingRate === "" ? null : +t.fundingRate * 100, px: +t.lastPrice }))
    .sort((a, b) => b.vol - a.vol);
  // gold, silver, oil, forex and index perps are always scanned next to the top crypto by volume
  const tk = [...new Map([...all.slice(0, CFG.topN), ...all.filter((t) => MACRO.includes(t.sym))].map((t) => [t.sym, t])).values()];
  const px = Object.fromEntries(tk.map((t) => [t.sym, t.px]));

  // 1) manage open trades using 15m candles since the last check (stop hit first if both touch in one candle)
  for (const t of st.open.slice()) {
    let hit = null, exit = 0;
    try {
      const k = await candles(t.sym, "15", `&start=${t.chk}`);
      for (const c of k) {
        if (c.t < t.chk) continue;
        const stop = t.tsl ?? t.sl, sl = t.side === "long" ? c.l <= stop : c.h >= stop, tp = t.side === "long" ? c.h >= t.tp : c.l <= t.tp;
        if (sl) { hit = t.tsl != null ? "TRAIL" : "SL"; exit = stop * (1 + (t.side === "long" ? -CFG.slip : CFG.slip)); break; }
        if (tp) { hit = "TP"; exit = t.tp; break; }
        trail(t, c);
      }
      const cur = tk.find((x) => x.sym === t.sym); if (cur && cur.fund != null) t.fr = cur.fund;
      if (k.length) t.chk = k[k.length - 1].t;
    } catch (e) { console.log("track", t.sym, e.message); }
    if (!hit && now - t.t0 > HOLD_H[t.strat] * 36e5) { hit = "TIME"; exit = px[t.sym] || t.entry; }
    if (hit) { close(st, t, exit, hit, now); st.open = st.open.filter((o) => o !== t); }
  }

  // 2) daily loss stop
  const today = new Date(now).toISOString().slice(0, 10);
  const dayPnl = st.days[today] || 0;
  st.halted = dayPnl <= -CFG.start * CFG.dayStopPct / 100 ? "daily loss limit hit, no new trades until tomorrow (UTC)" : "";

  // 3) new entries on the last closed 1h candle
  const heldSyms = new Set(st.open.map((t) => t.sym));
  // auto-disable a strategy that keeps losing: 20+ of the last 30 closed trades must show negative expectancy and PF < 0.8
  const off = new Set();
  for (const sname of Object.keys(HOLD_H)) {
    const r = st.closed.filter((t) => t.strat === sname).slice(0, 30);
    const gw = r.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0), gl = -r.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
    if (r.length >= 20 && gw < 0.8 * gl) off.add(sname);
  }
  st.off = [...off];
  const sideCount = (side) => st.open.filter((t) => t.side === side).length;
  if (!st.halted) for (const t of tk) {
    if (st.open.length >= CFG.maxOpen) break;
    if (heldSyms.has(t.sym)) continue;
    let k;
    try { k = await candles(t.sym, "60"); } catch (e) { console.log("klines", t.sym, e.message); continue; }
    k = k.filter((c) => c.t + 36e5 <= now); // drop the forming candle
    if (k.length < 60 || st.seen[t.sym] === k[k.length - 1].t) continue;
    st.seen[t.sym] = k[k.length - 1].t;
    const sg = signal(k, t.fund, off);
    if (!sg || sideCount(sg.side) >= CFG.maxSide) continue; // crypto moves together, cap same-direction trades
    const entry = k[k.length - 1].c * (1 + (sg.side === "long" ? CFG.slip : -CFG.slip));
    const dist = Math.abs(entry - sg.sl);
    if (!dist) continue;
    const risk = st.equity * CFG.riskPct / 100;
    let qty = risk / dist;
    qty = Math.min(qty, st.equity * CFG.maxLev / entry);
    st.open.push({ id: now + "-" + t.sym, sym: t.sym, side: sg.side, strat: sg.strat, entry, sl: sg.sl, tp: sg.tp, qty, risk, why: sg.why, t0: now, chk: now, fr: t.fund || 0 });
    heldSyms.add(t.sym);
  }

  // 4) mark to market and record
  const unreal = st.open.reduce((s, t) => s + pnlOf(t, px[t.sym] || t.entry) - fundCost(t, now), 0);
  const eq = st.equity + unreal;
  st.peak = Math.max(st.peak, eq);
  st.curve.push([now, +eq.toFixed(2)]);
  st.curve = st.curve.slice(-600);
  st.upd = now;
  st.cfg = CFG;
  for (const k of Object.keys(st.seen)) if (!px[k]) delete st.seen[k];
  for (const d of Object.keys(st.days)) if (d < new Date(now - 30 * 864e5).toISOString().slice(0, 10)) delete st.days[d];
  fs.writeFileSync(FILE, JSON.stringify(st));
  console.log(`equity ${eq.toFixed(2)} open ${st.open.length} closed ${st.closed.length} ${st.halted}`);
}

export { signal, trail, CFG, HOLD_H };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
