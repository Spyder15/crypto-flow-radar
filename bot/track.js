// Trade tracking: KV holds open trades; a 15m cron walks candles and posts TP/SL updates; weekly report from closed trades.
import { fmt } from "./chart.js";
import { klines15 } from "./data.js";

// 15m and sub-7/8 signals only came from manual format tests; keep them out of the stats
export const isLive = (t) => t.tf !== "15m" && t.passed >= 7;
const DAY = 864e5, MAX_AGE = { "1h": 7 * DAY, "4h": 14 * DAY, "1d": 30 * DAY };
export const tradeKey = (t) => `o:${t.sym}:${t.tf}:${t.t0}`;

// Stop level for each stage: 0 = original SL, 1 = breakeven after TP1, 2 = TP1 after TP2.
export const slAt = (t) => [t.sl, t.entry, t.tps[0]][t.stage];
const rOf = (t, price) => ((price - t.entry) * (t.side === "LONG" ? 1 : -1)) / Math.abs(t.entry - t.sl);

// Walks closed 15m candles in order. A candle touching both stop and target counts the stop first (conservative).
export function evaluate(t, candles) {
  const L = t.side === "LONG", events = []; t.hits = t.hits || [];
  for (const c of candles) {
    if (t.closed) break;
    t.cursor = c.t;
    const stop = slAt(t);
    if (L ? c.l <= stop : c.h >= stop) {
      const type = t.stage === 0 ? "SL" : t.stage === 1 ? "BE" : "TP1STOP";
      t.closed = true; t.outcome = type; t.r = rOf(t, stop); events.push({ type, t: c.t, price: stop }); t.hits.push(events[events.length - 1]); break;
    }
    while (t.stage < 3 && (L ? c.h >= t.tps[t.stage] : c.l <= t.tps[t.stage])) {
      const price = t.tps[t.stage]; t.stage++;
      events.push({ type: "TP" + t.stage, t: c.t, price }); t.hits.push(events[events.length - 1]);
      if (t.stage === 3) { t.closed = true; t.outcome = "TP3"; t.r = rOf(t, price); break; }
    }
  }
  return events;
}

const R = (x) => (Math.abs(x) < 0.05 ? "0.0" : (x > 0 ? "+" : "") + x.toFixed(1)) + "R";
export function eventText(t, ev) {
  const L = t.side === "LONG", base = t.sym.replace(/USDT$/, ""), head = `${L ? "🟢" : "🔴"} <b>#${base} ${t.side}</b> · ${t.tf.toUpperCase()}`;
  const line = "━━━━━━━━━━━━━━", lv = `📍 Entry <code>${fmt(t.entry)}</code>`;
  const foot = "<b>— SPYDER Flow Radar</b>";
  const body = {
    TP1: [`🎯 <b>TP1 HIT</b> ✅  (${R(rOf(t, t.tps[0]))})`, line, lv, `🔒 <b>Move SL to breakeven</b> → <code>${fmt(t.entry)}</code>`, `Next: TP2 <code>${fmt(t.tps[1])}</code>`],
    TP2: [`🎯 <b>TP2 HIT</b> ✅✅  (${R(rOf(t, t.tps[1]))})`, line, lv, `🔒 <b>Move SL to TP1</b> → <code>${fmt(t.tps[0])}</code>`, `Next: TP3 <code>${fmt(t.tps[2])}</code>`],
    TP3: [`🏆 <b>TP3 HIT: TRADE COMPLETE</b>  (${R(t.r)})`, line, lv, "All targets reached. Trade closed."],
    SL: [`🛑 <b>STOP LOSS HIT</b>  (${R(-1)})`, line, lv, `SL <code>${fmt(t.sl)}</code> was touched. Trade closed.`],
    BE: [`⚖️ <b>STOPPED AT BREAKEVEN</b>  (0.0R)`, line, lv, "TP1 had hit, price came back to entry. No loss. Trade closed."],
    TP1STOP: [`✅ <b>STOPPED AT TP1</b>  (${R(t.r)})`, line, lv, "TP2 had hit, price came back to TP1. Profit locked. Trade closed."],
  }[ev.type];
  return [head, ...body, "", foot].join("\n");
}

const TITLES = { TP1: "TP1 HIT | SL TO BREAKEVEN", TP2: "TP2 HIT | SL TO TP1", TP3: "TP3 HIT | TRADE COMPLETE", SL: "STOP LOSS HIT", BE: "STOPPED AT BREAKEVEN", TP1STOP: "STOPPED AT TP1" };
// Extra info for chartConfig as of event `i` of this run: hit markers, stop level then, result title.
export function trackInfo(t, events, i) {
  const hits = t.hits.slice(0, t.hits.length - events.length + i + 1), ev = events[i];
  const tp = hits.filter((h) => h.type[0] === "T" && h.type.length === 3).length;
  const closed = !["TP1", "TP2"].includes(ev.type);
  return {
    title: TITLES[ev.type], tpHit: tp, slCur: closed ? null : [t.entry, t.tps[0]][tp - 1],
    marks: hits.map((e) => ({ t: e.t, y: e.price, text: /^TP\d$/.test(e.type) ? "✔ " + e.type : "✖ " + (e.type === "SL" ? "SL" : e.type === "BE" ? "BE" : "TP1 STOP") })),
  };
}

export async function loadOpen(env) {
  const out = []; let cursor;
  do {
    const l = await env.TRADES.list({ prefix: "o:", cursor });
    for (const k of l.keys) { const v = await env.TRADES.get(k.name, "json"); if (v) out.push([k.name, v]); }
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  return out;
}

export async function recordClosed(env, t) {
  const list = (await env.TRADES.get("closed", "json")) || [];
  list.push({ sym: t.sym, side: t.side, tf: t.tf, kind: t.kind, outcome: t.outcome, r: t.r ?? null, opened: t.t0, closed: Date.now(), passed: t.passed });
  await env.TRADES.put("closed", JSON.stringify(list.slice(-300)));
}

export async function weekly(env, days = 7, now = Date.now()) {
  const all = ((await env.TRADES.get("closed", "json")) || []).filter((x) => now - x.closed <= days * DAY && x.r !== null && isLive(x));
  const open = (await loadOpen(env)).filter(([, t]) => !t.closed && isLive(t)).length;
  const wins = all.filter((x) => x.r > 0.05), loss = all.filter((x) => x.r < -0.05), be = all.length - wins.length - loss.length;
  const tot = all.reduce((a, x) => a + x.r, 0), dec = wins.length + loss.length;
  const rows = all.slice(-12).map((x) => `${x.r > 0.05 ? "✅" : x.r < -0.05 ? "🛑" : "⚖️"} #${x.sym.replace(/USDT$/, "")} ${x.side} ${x.outcome}  ${R(x.r)}`);
  return [
    `📈 <b>${days === 1 ? "DAILY SUMMARY" : "WEEKLY REPORT"}</b>  <i>last ${days === 1 ? "24 hours" : days + " days"}</i>`, "━━━━━━━━━━━━━━",
    `Closed trades: <b>${all.length}</b>   Open: <b>${open}</b>`,
    `✅ Wins: ${wins.length}   🛑 Losses: ${loss.length}   ⚖️ Breakeven: ${be}`,
    dec ? `Win rate (excl. BE): <b>${((wins.length / dec) * 100).toFixed(0)}%</b>` : "Win rate: n/a",
    `Net result: <b>${R(tot)}</b>  <i>(each trade exits at its final stop/target)</i>`,
    ...(rows.length ? ["", ...rows] : ["", "No closed trades in this period."]),
    "", "<i>Small sample, no proven edge. Not financial advice.</i>", "<b>— SPYDER Flow Radar</b>",
  ].join("\n");
}

// Cron entry: checks every open trade against new 15m candles. `notify(t, ev, info)` posts each update.
export async function track(env, notify) {
  const now = Date.now(), done = [], errors = []; let calls = 0;
  for (const [key, t] of await loadOpen(env)) {
    if (t.closed) { await env.TRADES.delete(key); continue; }
    if (now - t.t0 > (MAX_AGE[t.tf] || 7 * DAY)) { t.closed = true; t.outcome = "EXPIRED"; t.r = null; await recordClosed(env, t); await env.TRADES.delete(key); done.push(key + " expired"); continue; }
    if (calls > 36) break; // free plan: 50 subrequests per run
    calls += 2; let cs; // candles + chart data
    try { cs = await klines15(t.sym, Math.max(t.t0, (t.cursor || 0) + 1)); } catch (e) { errors.push(e.message); continue; }
    cs = cs.filter((c) => c.t >= t.t0 && c.t > (t.cursor || 0) && c.t + 15 * 60e3 <= now);
    if (!cs.length) continue;
    const events = evaluate(t, cs);
    for (const [i, ev] of events.entries()) {
      try { calls += 2; t.msg = (await notify(t, ev, trackInfo(t, events, i))) || t.msg; } catch (e) { errors.push("notify " + e.message); }
    }
    if (t.closed) { await recordClosed(env, t); await env.TRADES.delete(key); } else await env.TRADES.put(key, JSON.stringify(t), { expirationTtl: 33 * 86400 });
    if (events.length) done.push(`${t.sym} ${events.map((e) => e.type).join(",")}`);
  }
  return { open: done, errors: errors.slice(0, 5) };
}
