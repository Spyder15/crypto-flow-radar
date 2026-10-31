import { TF_MS, CHECKS, buildRow, findSignals, confirmations, trendScore } from "./signals.js";
import { renderChart, fmt } from "./chart.js";
import { tickers, klines, openInterest } from "./data.js";

const SKIP = /^(XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD)$/;
const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function caption(s) {
  const L = s.side === "LONG", base = s.sym.replace(/USDT$/, "");
  const row = (k, t) => `${s.ck[k] ? "✅" : "▫️"} ${t}`;
  const ck = CHECKS.map(([k, t]) => row(k, t));
  const pairs = []; for (let i = 0; i < ck.length; i += 2) pairs.push(ck.slice(i, i + 2).join("   "));
  return [
    `${L ? "🟢" : "🔴"} <b>${L ? "LONG" : "SHORT"} · #${esc(base)}</b>  <i>${s.tf.toUpperCase()} · ${esc(s.kind)}${s.kind === "EMA RETEST" ? " " + s.lvl : ""}</i>`,
    "━━━━━━━━━━━━━━",
    `📍 <b>Entry</b>   <code>${fmt(s.entry)}</code>`,
    `🛑 <b>Stop</b>    <code>${fmt(s.sl)}</code>  (${s.riskPct.toFixed(1)}%)`,
    `🎯 <b>TP1</b>     <code>${fmt(s.tps[0])}</code>  (1R)`,
    `🎯 <b>TP2</b>     <code>${fmt(s.tps[1])}</code>`,
    `🎯 <b>TP3</b>     <code>${fmt(s.tps[2])}</code>`,
    "━━━━━━━━━━━━━━",
    `📊 <b>Confirmations ${s.passed}/8</b>`,
    ...pairs,
    "━━━━━━━━━━━━━━",
    "🧠 <b>Why this trade</b>",
    ...s.reasons.map((x) => "▸ " + esc(x)),
    "",
    "<i>⚠️ Not financial advice. No proven edge; wins and losses both posted. Trade at your own risk.</i>",
    "<b>— SPYDER Flow Radar</b>",
  ].join("\n");
}

async function send(env, s, chart) {
  const base = `https://api.telegram.org/bot${env.TG_TOKEN}`, text = caption(s);
  if (chart) {
    const fd = new FormData();
    fd.append("chat_id", env.TG_CHAT); fd.append("parse_mode", "HTML"); fd.append("caption", text);
    fd.append("photo", new Blob([chart], { type: "image/png" }), "chart.png");
    const r = await fetch(base + "/sendPhoto", { method: "POST", body: fd });
    if (r.ok) return;
  }
  const r = await fetch(base + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT, parse_mode: "HTML", text, disable_web_page_preview: true }) });
  if (!r.ok) throw new Error("telegram " + r.status + " " + (await r.text()));
}

export async function run(env, { force = false, batch = 0 } = {}) {
  const tf = env.TF || "4h", ms = TF_MS[tf], size = +env.BATCH || 25, min = +env.MIN_CONF || 7;
  const sinceClose = Date.now() % ms; // time since the last candle closed
  if (!force && sinceClose > 10 * 60e3) return { skipped: true };
  const wanted = (env.SYMBOLS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const tk = await tickers(), fund = {}; tk.forEach((t) => { fund[t.symbol] = t.fund; });
  const list = wanted.length ? wanted.map((symbol) => ({ symbol })) : tk.filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, "")) && t.vol > 0).sort((a, b) => b.vol - a.vol).slice(batch * size, (batch + 1) * size);
  const sent = [], errors = []; let calls = 1; // free plan: max 50 subrequests per run
  for (const t of list) {
    let k; calls++; try { k = await klines(t.symbol, tf); } catch (e) { errors.push(e.message); continue; }
    const r = buildRow(t.symbol, k, fund[t.symbol] ?? null); if (!r) continue;
    let oi;
    for (const s of findSignals(r, tf)) {
      let ck = confirmations(r, s.side, tf, 0), passed = Object.values(ck).filter(Boolean).length;
      if (passed + 1 < min) continue; // even with the OI check it cannot reach the minimum
      if (calls + 4 > 48) { errors.push("subrequest budget reached"); break; }
      if (oi === undefined) { calls++; try { oi = await openInterest(t.symbol, tf); } catch (e) { oi = null; } }
      ck = confirmations(r, s.side, tf, trendScore(r, s.side, oi)); passed = Object.values(ck).filter(Boolean).length;
      if (passed < min) continue;
      Object.assign(s, { ck, passed });
      calls += 2; let chart = null; try { chart = await renderChart(r, s); } catch (e) { console.log("chart failed", e.message); }
      await send(env, s, chart); sent.push(`${s.sym} ${s.side} ${s.kind} ${passed}/8`);
    }
  }
  console.log("sent", sent, "errors", errors);
  return { batch, scanned: list.length, sent, errors: errors.slice(0, 5) };
}

export default {
  scheduled(e, env, ctx) { ctx.waitUntil(run(env, { batch: Math.max(0, (+e.cron.split(" ")[0] || 1) - 1) })); }, // cron minute 1..5 = batch 0..4
  // Manual check: /__run?key=<RUN_KEY>&batch=0..4 scans now (force) and posts any signal on the latest closed candle. Disabled unless RUN_KEY is set.
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/__run" && env.RUN_KEY && u.searchParams.get("key") === env.RUN_KEY) {
      try { return Response.json(await run(env, { force: true, batch: +u.searchParams.get("batch") || 0 })); } catch (e) { return new Response(String(e.message), { status: 500 }); }
    }
    return new Response("Not found", { status: 404 });
  },
};
