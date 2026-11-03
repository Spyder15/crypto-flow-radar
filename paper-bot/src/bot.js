// Bybit PAPER trading bot: no real orders, no API keys. Fake $100 account, fixed % risk per trade, hard max-drawdown kill switch.
// One run = manage open trades, then look for new signals on freshly closed candles. Meant to be run every ~15 min (see .github/workflows/run.yml).
import fs from "node:fs";
import { TF_MS, buildRow, findSignals, confirmations, trendScore } from "./signals.js";
import { tickers, klines, openInterest, klines15 } from "./data.js";

const cfg = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url)));
const STATE = new URL("../state.json", import.meta.url);
const STABLE = /^(USDC|USDE|FDUSD|TUSD|DAI|XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD|EURUSD|GBPUSD|USDJPY)$/;
const floor = cfg.startBalance * (1 - cfg.maxDrawdownPct / 100);
const fresh = () => ({ equity: cfg.startBalance, peak: cfg.startBalance, halted: false, alerted: false, open: [], closed: [], seen: {}, days: {} });
const state = process.argv.includes("--reset") || !fs.existsSync(STATE) ? fresh() : JSON.parse(fs.readFileSync(STATE));
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const f = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toPrecision(4));
const worst = (t) => t.riskUsd + t.notional * cfg.feeRoundTrip; // full stop loss plus fees
const rOf = (t, p) => ((p - t.entry) * (t.side === "LONG" ? 1 : -1)) / Math.abs(t.entry - t.sl);
const slAt = (t) => [t.sl, t.entry, t.tps[0]][t.stage];

async function tg(text) {
  console.log(text.replace(/<[^>]+>/g, ""));
  if (!process.env.TG_TOKEN || !process.env.TG_CHAT) return;
  try { await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TG_CHAT, parse_mode: "HTML", text, disable_web_page_preview: true }) }); } catch (e) { console.log("telegram failed", e.message); }
}

function close(t, price, outcome) {
  const r = rOf(t, price), pnl = r * t.riskUsd - t.notional * cfg.feeRoundTrip;
  state.equity = +(state.equity + pnl).toFixed(4); state.peak = Math.max(state.peak, state.equity);
  state.open = state.open.filter((x) => x.id !== t.id);
  state.closed.push({ id: t.id, sym: t.sym, side: t.side, outcome, r: +r.toFixed(2), pnl: +pnl.toFixed(2), opened: t.t0, closed: Date.now() });
  state.closed = state.closed.slice(-200);
  if (state.equity <= floor) state.halted = true;
  return { r, pnl };
}

// Walk closed 15m candles. A candle touching both stop and target counts the stop first (conservative).
async function manage() {
  for (const t of [...state.open]) {
    let cs; try { cs = (await klines15(t.sym, Math.max(t.cursor, t.t0))).filter((c) => c.t + 9e5 <= Date.now() && c.t > t.cursor); } catch (e) { console.log(t.sym, "data failed", e.message); continue; }
    for (const c of cs) {
      t.cursor = c.t;
      const L = t.side === "LONG", stop = slAt(t);
      if (L ? c.l <= stop : c.h >= stop) {
        const { r, pnl } = close(t, stop, t.stage === 0 ? "SL" : t.stage === 1 ? "BE" : "TP1STOP");
        await tg(`${pnl >= 0 ? "✅" : "🛑"} <b>PAPER CLOSED ${t.sym} ${t.side}</b>  ${r >= 0 ? "+" : ""}${r.toFixed(2)}R  (${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})\nEquity: $${state.equity.toFixed(2)}`);
        break;
      }
      while (t.stage < 3 && (L ? c.h >= t.tps[t.stage] : c.l <= t.tps[t.stage])) {
        t.stage++;
        if (t.stage === 3) { const { r, pnl } = close(t, t.tps[2], "TP3"); await tg(`🏆 <b>PAPER TP3 ${t.sym} ${t.side}</b>  +${r.toFixed(2)}R  (+$${pnl.toFixed(2)})\nEquity: $${state.equity.toFixed(2)}`); break; }
        await tg(`🎯 <b>PAPER TP${t.stage} ${t.sym} ${t.side}</b>. Stop moved to ${t.stage === 1 ? "entry" : "TP1"}.`);
      }
      if (!state.open.includes(t)) break;
    }
    if (state.open.includes(t) && Date.now() - t.t0 > 7 * 864e5) { close(t, t.entry, "EXPIRED"); await tg(`⌛ Paper trade ${t.sym} expired at entry.`); }
  }
  if (state.equity <= floor) state.halted = true;
}

function tryOpen(s, passed, t0) {
  const day = new Date().toISOString().slice(0, 10), risk = cfg.startBalance * cfg.riskPct / 100, dist = Math.abs(s.entry - s.sl);
  if (state.halted || !(dist > 0)) return null;
  if (state.open.length >= cfg.maxOpenTrades || (state.days[day] || 0) >= cfg.maxTradesPerDay) return null;
  if (state.open.some((x) => x.sym === s.sym)) return null;
  const t = { id: `${s.sym}:${t0}`, sym: s.sym, side: s.side, kind: s.kind, entry: s.entry, sl: s.sl, tps: s.tps, passed, t0, cursor: t0 - 1, stage: 0, riskUsd: +risk.toFixed(2), notional: (risk / dist) * s.entry };
  // the drawdown limit can never be exceeded: all open worst cases plus this one must fit above the floor
  if (state.open.reduce((a, x) => a + worst(x), 0) + worst(t) > state.equity - floor) return null;
  state.open.push(t); state.days[day] = (state.days[day] || 0) + 1;
  return t;
}

async function scan() {
  const tf = cfg.timeframe, ms = TF_MS[tf];
  if (Date.now() % ms > 14 * 60e3 || state.halted) return; // only right after a candle close
  const tk = await tickers(), fund = {}; tk.forEach((t) => { fund[t.symbol] = t.fund; });
  const list = tk.filter((t) => !STABLE.test(t.symbol.replace(/USDT$/, "")) && t.vol > 0).sort((a, b) => b.vol - a.vol).slice(0, cfg.topSymbols);
  for (const { symbol } of list) {
    let k; try { k = await klines(symbol, tf); } catch (e) { console.log(symbol, "data failed", e.message); continue; }
    const r = buildRow(symbol, k, fund[symbol] ?? null); if (!r) continue;
    let oi;
    for (const s of findSignals(r, tf, {})) {
      const t0 = r.d[r.d.length - 1].t + ms, key = `${s.sym}:${s.side}:${t0}`;
      if (state.seen[key]) continue;
      if (oi === undefined) oi = await openInterest(symbol, tf).catch(() => null);
      const passed = Object.values(confirmations(r, s.side, tf, trendScore(r, s.side, oi))).filter(Boolean).length;
      if (passed < cfg.minConfirmations) continue;
      state.seen[key] = Date.now();
      const t = tryOpen(s, passed, t0);
      if (t) await tg(`📒 <b>PAPER ${t.side} ${t.sym}</b>  (${t.kind}, ${passed}/8)\nEntry <code>${f(t.entry)}</code>  SL <code>${f(t.sl)}</code>\nTP1 <code>${f(t.tps[0])}</code>  TP2 <code>${f(t.tps[1])}</code>  TP3 <code>${f(t.tps[2])}</code>\nRisk $${t.riskUsd}  |  Size ~$${t.notional.toFixed(0)}\n<i>Fake money, no real order.</i>`);
      else console.log("signal skipped by risk rules:", key);
    }
  }
  for (const k of Object.keys(state.seen)) if (Date.now() - state.seen[k] > 2 * 864e5) delete state.seen[k];
}

await manage().catch((e) => console.log("manage error", e.message));
await scan().catch((e) => console.log("scan error", e.message));
if (state.halted && !state.alerted) { state.alerted = true; await tg(`🛑 <b>PAPER ACCOUNT HALTED</b>. Max drawdown ${cfg.maxDrawdownPct}% hit.\nEquity $${state.equity.toFixed(2)}. No new trades until you run: npm run reset`); }
save();
const w = state.closed.filter((c) => c.pnl > 0).length;
console.log(`Equity $${state.equity.toFixed(2)} | closed ${state.closed.length} (wins ${w}) | open ${state.open.length} | drawdown ${(((state.peak - state.equity) / cfg.startBalance) * 100).toFixed(2)}% | ${state.halted ? "HALTED" : "active"}`);
