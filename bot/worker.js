import { TF_MS, buildRow, findSignals } from "./signals.js";
import { renderChart, fmt } from "./chart.js";
import { tickers, klines } from "./data.js";

const SKIP = /^(XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD)$/;
const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function caption(s) {
  const L = s.side === "LONG", base = s.sym.replace(/USDT$/, "");
  return [
    `${L ? "🟢" : "🔴"} <b>#${esc(base)}</b> ${s.side} · ${s.tf.toUpperCase()} · ${esc(s.kind)}${s.kind === "EMA RETEST" ? " " + s.lvl : ""}`,
    "",
    `Entry: <code>${fmt(s.entry)}</code>`,
    `🛑 SL: <code>${fmt(s.sl)}</code> (${s.riskPct.toFixed(1)}%)`,
    `🎯 TP1: <code>${fmt(s.tps[0])}</code> (1R) · TP2: <code>${fmt(s.tps[1])}</code> · TP3: <code>${fmt(s.tps[2])}</code>`,
    "",
    "<b>Why this trade</b>",
    ...s.reasons.map((x) => "• " + esc(x)),
    "",
    "<i>Not financial advice. No proven edge: wins and losses are both posted. Use your own risk.</i>",
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

export async function run(env, { force = false } = {}) {
  const tf = env.TF || "4h", ms = TF_MS[tf], top = +env.TOP || 35;
  const sinceClose = Date.now() % ms; // time since the last candle closed
  if (!force && sinceClose > 10 * 60e3) return { skipped: true };
  const wanted = (env.SYMBOLS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const tk = await tickers(), fund = {}; tk.forEach((t) => { fund[t.symbol] = t.fund; });
  const list = wanted.length ? wanted.map((symbol) => ({ symbol })) : tk.filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, "")) && t.vol > 0).sort((a, b) => b.vol - a.vol).slice(0, top);
  const sent = [], errors = [];
  for (const t of list) {
    let k; try { k = await klines(t.symbol, tf); } catch (e) { errors.push(e.message); continue; }
    const r = buildRow(t.symbol, k, fund[t.symbol] ?? null); if (!r) continue;
    for (const s of findSignals(r, tf)) {
      let chart = null; try { chart = await renderChart(r, s); } catch (e) { console.log("chart failed", e.message); }
      await send(env, s, chart); sent.push(`${s.sym} ${s.side} ${s.kind}`);
    }
  }
  console.log("sent", sent, "errors", errors);
  return { scanned: list.length, sent, errors: errors.slice(0, 5) };
}

export default {
  scheduled(_e, env, ctx) { ctx.waitUntil(run(env)); },
  // Manual check: /__run?key=<RUN_KEY> scans now (force) and posts any signal on the latest closed candle. Disabled unless RUN_KEY is set.
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/__run" && env.RUN_KEY && u.searchParams.get("key") === env.RUN_KEY) {
      try { return Response.json(await run(env, { force: true })); } catch (e) { return new Response(String(e.message), { status: 500 }); }
    }
    return new Response("Not found", { status: 404 });
  },
};
