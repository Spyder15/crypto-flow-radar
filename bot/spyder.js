// Spyder Strategy, experimental and paper-tracked, running inside the main worker (free plan allows only 5 crons per account).
// Signals are checked on the 1H candles the main scan already fetched (no extra data calls). State lives in the TRADES KV under the "sp:" prefix.
import { klines, klines15 } from "./data.js";
import { renderChart } from "./chart.js";
import { spyderSignal, evaluate } from "./spyder-strategy.js";

const HOUR = 36e5, RR = 1, MAX_DAY = 8, MAX_OPEN = 12;
const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : x.toPrecision(4));
const R = (x) => (x > 0 ? "+" : "") + x.toFixed(1) + "R";
const FOOT = "<i>🧪 Experimental Spyder strategy. Paper-tracked, backtest was negative after fees. Not financial advice.</i>";
const base = (s) => s.replace(/USDT$/, "");

const entryText = (t) => [
  `${t.side === "LONG" ? "🟢" : "🔴"} <b>SPYDER ${t.side} · #${base(t.sym)}</b>  <i>1H · body sweep</i>`, "━━━━━━━━━━━━━━",
  `📍 <b>Entry</b>  <code>${fmt(t.entry)}</code>`, `🛑 <b>Stop</b>   <code>${fmt(t.sl)}</code>  (${t.riskPct.toFixed(1)}%)`, `🎯 <b>Target</b> <code>${fmt(t.tp)}</code>  (${t.rr}R)`, "", FOOT,
].join("\n");
const eventText = (t, ev) => [
  ev.type === "TP" ? `🏆 <b>SPYDER #${base(t.sym)} ${t.side}: TARGET HIT</b>  (${R(t.r)})` : `🛑 <b>SPYDER #${base(t.sym)} ${t.side}: STOP LOSS</b>  (${R(-1)})`,
  `Level <code>${fmt(ev.price)}</code>. Trade closed.`, "", FOOT,
].join("\n");

const chartSig = (t, track) => ({ sym: t.sym, side: t.side, tf: "1h", kind: "BODY SWEEP", entry: t.entry, sl: t.sl, tps: [t.tp, t.tp, t.tp], single: true, rr: t.rr, passed: 0, track });
async function chartFor(d, t, track) { try { return await renderChart({ d }, chartSig(t, track)); } catch (e) { console.log("spyder chart failed", e.message); return null; } }

// d = closed 1H candles of one coin (oldest first). Returns the number of subrequests used (KV + Telegram).
export async function spyderCheck(env, sym, d, send) {
  const s = spyderSignal(d); if (!s) return 0;
  const seen = `sp:s:${sym}:${s.t}`, day = new Date().toISOString().slice(0, 10); let calls = 1;
  if (await env.TRADES.get(seen)) return calls;
  calls++; if ((await env.TRADES.list({ prefix: `sp:o:${sym}:`, limit: 1 })).keys.length) return calls;
  calls++; if ((+(await env.TRADES.get("sp:d:" + day)) || 0) >= MAX_DAY) return calls;
  calls++; if ((await env.TRADES.list({ prefix: "sp:o:", limit: MAX_OPEN })).keys.length >= MAX_OPEN) return calls;
  const risk = Math.abs(s.entry - s.sl), t = { sym, side: s.side, entry: s.entry, sl: s.sl, rr: RR, tp: s.side === "LONG" ? s.entry + RR * risk : s.entry - RR * risk, riskPct: (risk / s.entry) * 100, t0: s.t + HOUR, cursor: 0 };
  calls += 2; const chart = await chartFor(d, t, null);
  calls++; t.msg = await send(entryText(t), null, chart); // a failed send throws: nothing is saved, so no phantom trade
  await env.TRADES.put(seen, "1", { expirationTtl: 6 * 3600 });
  await env.TRADES.put("sp:d:" + day, String((+(await env.TRADES.get("sp:d:" + day)) || 0) + 1), { expirationTtl: 2 * 86400 });
  await env.TRADES.put(`sp:o:${sym}:${t.t0}`, JSON.stringify(t), { expirationTtl: 20 * 86400 });
  return calls + 3;
}

// Checks open Spyder trades against closed 15m candles. A trade is saved only after its Telegram message went out, so a failed one is retried next run.
export async function spyderTrack(env, send, maxCalls = 20) {
  const now = Date.now(), done = [], errors = []; let calls = 1;
  for (const { name } of (await env.TRADES.list({ prefix: "sp:o:" })).keys) {
    if (calls + 3 > maxCalls) break;
    const t = await env.TRADES.get(name, "json"); calls++; if (!t) continue;
    if (now - t.t0 > 7 * 864e5) { await record(env, { ...t, outcome: "EXPIRED", r: null }); await env.TRADES.delete(name); calls += 3; continue; }
    let cs; try { calls++; cs = await klines15(t.sym, Math.max(t.t0, (t.cursor || 0) + 1)); } catch (e) { errors.push(e.message); continue; }
    cs = cs.filter((c) => c.t >= t.t0 && c.t > (t.cursor || 0) && c.t + 15 * 60e3 <= now);
    if (!cs.length) continue;
    const ev = evaluate(t, cs);
    if (ev) {
      try {
        let chart = null;
        try { calls += 2; const k = await klines(t.sym, "1h"), d = k.slice(0, -1).map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })); chart = await chartFor(d, t, { title: ev.type === "TP" ? "TARGET HIT" : "STOP LOSS HIT", tpHit: 0, slCur: null, marks: [{ t: t.cursor, y: ev.price, text: ev.type === "TP" ? "✔ TARGET" : "✖ SL" }] }); } catch (e) { /* text only */ }
        calls++; await send(eventText(t, ev), t.msg, chart);
      } catch (e) { errors.push("notify " + e.message); continue; } }
    calls++; if (t.closed) { await record(env, t); await env.TRADES.delete(name); calls += 2; done.push(`${t.sym} ${t.outcome}`); } else await env.TRADES.put(name, JSON.stringify(t), { expirationTtl: 20 * 86400 });
  }
  console.log("spyder track", JSON.stringify({ done, errors }));
  return { done, errors: errors.slice(0, 5) };
}

async function record(env, t) {
  const list = (await env.TRADES.get("sp:closed", "json")) || [];
  list.push({ sym: t.sym, side: t.side, outcome: t.outcome, r: t.r, opened: t.t0, closed: Date.now(), msg: t.msg });
  await env.TRADES.put("sp:closed", JSON.stringify(list.slice(-300)));
}

export async function spyderStats(env) {
  const all = ((await env.TRADES.get("sp:closed", "json")) || []).filter((x) => x.r !== null), w = all.filter((x) => x.r > 0).length, net = all.reduce((a, x) => a + x.r, 0);
  return { closed: all.length, wins: w, losses: all.length - w, winRate: all.length ? Math.round((100 * w) / all.length) + "%" : "-", netR: +net.toFixed(1) };
}

// Format preview only: three fake-level messages (entry with chart, target hit, stop loss), nothing is saved or tracked.
export async function spyderSample(send) {
  const k = await klines("XAUUSDT", "1h"), d = k.slice(0, -1).map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
  const e = d[d.length - 1].c, sl = e * 1.0025, tp = e - RR * (sl - e), t = { sym: "XAUUSDT", side: "SHORT", entry: e, sl, rr: RR, tp, riskPct: 0.25 };
  const tag = "<b>🧪 SAMPLE (format preview)</b>\n\n", id = await send(tag + entryText(t), null, await chartFor(d, t, null));
  const hit = { title: "TARGET HIT", tpHit: 0, slCur: null, marks: [{ t: d[d.length - 1].t, y: tp, text: "✔ TARGET" }] };
  await send(tag + eventText({ ...t, r: RR }, { type: "TP", price: tp }), id, await chartFor(d, t, hit));
  await send(tag + eventText(t, { type: "SL", price: sl }), id, await chartFor(d, t, { ...hit, title: "STOP LOSS HIT", marks: [{ t: d[d.length - 1].t, y: sl, text: "✖ SL" }] }));
  return { sent: 3 };
}
