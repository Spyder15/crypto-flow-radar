import { TF_MS, buildRow, findSignals } from "./signals.js";
import { renderChart, fmt } from "./chart.js";

const HOSTS = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com", "https://fapi3.binance.com"];
const SKIP = /^(SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CL)/;
const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const j = async (path) => {
  let last = 0;
  for (const h of HOSTS) { const r = await fetch(h + path, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } }); if (r.ok) return r.json(); last = r.status; }
  throw new Error(`${path} -> ${last}`);
};

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
  const fund = {};
  let tk = [];
  if (wanted.length) { for (const sy of wanted) { try { fund[sy] = +(await j(`/fapi/v1/premiumIndex?symbol=${sy}`)).lastFundingRate * 100; } catch (e) { /* funding is optional */ } } }
  else { let pi; [tk, pi] = await Promise.all([j("/fapi/v1/ticker/24hr"), j("/fapi/v1/premiumIndex")]); pi.forEach((x) => { fund[x.symbol] = +x.lastFundingRate * 100; }); }
  const list = wanted.length ? wanted.map((symbol) => ({ symbol })) : tk.filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_") && !SKIP.test(t.symbol.replace(/USDT$/, "")) && +t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, top);
  const sent = [], errors = [];
  for (const t of list) {
    let k; try { k = await j(`/fapi/v1/klines?symbol=${t.symbol}&interval=${tf}&limit=400`); } catch (e) { errors.push(e.message); continue; }
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
