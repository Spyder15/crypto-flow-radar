import { track, weekly, eventText, loadOpen, isLive } from "./track.js";
import { radar } from "./radar.js";
import { whaleWatch } from "./whalewatch.js";
import { ideaTrack, ideaStats } from "./ideas.js";
import { TF_MS, CHECKS, buildRow, findSignals, confirmations, trendScore } from "./signals.js";
import { renderChart, fmt } from "./chart.js";
import { tickers, klines, openInterest } from "./data.js";

// Per-timeframe strategies, picked from the backtest (bot/README.md).
const STRAT = { "1h": {}, "4h": { fib: { minLeg: 4 } }, "1d": {} };
const SKIP = /^(XAU|XAG|XAUT|XPT|XPD|CL|BZ|COPPER|NATGAS|SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CRCL|ORCL|TSLA|NVDA|AAPL|MSTR|COIN|HOOD)$/;
const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function caption(s, env = {}) {
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
    ...(+env.RISK_USD > 0 ? [`💰 <i>Risk $${+env.RISK_USD}: size ≈ ${fmt(+env.RISK_USD / s.risk)} ${esc(base)} (≈ $${Math.round((+env.RISK_USD / s.risk) * s.entry)} notional)</i>`] : []),
    "━━━━━━━━━━━━━━",
    `📊 <b>Confirmations ${s.passed}/8</b>`,
    ...pairs,
    "━━━━━━━━━━━━━━",
    "🧠 <b>Why this trade</b>",
    ...s.reasons.map((x) => "▸ " + esc(x)),
    "",
    "<i>⚠️ Not financial advice. No proven edge; wins and losses both posted. Trade at your own risk.</i>",
    "<b>— SPYDER Flow Radar</b> · <a href=\"https://crypto-flow-radar.live-scanner.workers.dev/live.html\">📊 Live results</a>",
  ].join("\n");
}

async function tg(env, text, chart, replyTo) {
  const base = `https://api.telegram.org/bot${env.TG_TOKEN}`, rep = replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {};
  if (chart) {
    const fd = new FormData();
    fd.append("chat_id", env.TG_CHAT); fd.append("parse_mode", "HTML"); fd.append("caption", text);
    Object.entries(rep).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append("photo", new Blob([chart], { type: "image/png" }), "chart.png");
    const r = await fetch(base + "/sendPhoto", { method: "POST", body: fd });
    if (r.ok) return (await r.json()).result.message_id;
  }
  const r = await fetch(base + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT, parse_mode: "HTML", text, disable_web_page_preview: true, ...rep }) });
  if (!r.ok) throw new Error("telegram " + r.status + " " + (await r.text()));
  return (await r.json()).result.message_id;
}
const send = (env, s, chart) => tg(env, caption(s, env), chart);

export async function run(env, { force = false, batch = 0, minConf, tf: tfArg, test = false } = {}) {
  const tf = tfArg || env.TF || "1h", ms = TF_MS[tf], size = +env.BATCH || 25, min = minConf || (test ? 4 : +env.MIN_CONF || 7);
  const sinceClose = Date.now() % ms; // time since the last candle closed
  if (!force && sinceClose > 10 * 60e3) return { skipped: true };
  const wanted = (env.SYMBOLS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const tk = await tickers(), fund = {}; tk.forEach((t) => { fund[t.symbol] = t.fund; });
  const list = wanted.length ? wanted.map((symbol) => ({ symbol })) : tk.filter((t) => !SKIP.test(t.symbol.replace(/USDT$/, "")) && t.vol > 0).sort((a, b) => b.vol - a.vol).slice(batch * size, (batch + 1) * size);
  if (batch === 4) (env.INCLUDE || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).forEach((symbol) => list.push({ symbol })); // extra symbols ride in the last batch
  const day = new Date().toISOString().slice(0, 10), maxDay = +env.MAX_DAY || 12;
  const sent = [], errors = []; let calls = 1; // free plan: max 50 subrequests per run
  for (const t of list) {
    let k; calls++; try { k = await klines(t.symbol, tf); } catch (e) { errors.push(e.message); continue; }
    const r = buildRow(t.symbol, k, fund[t.symbol] ?? null); if (!r) continue;
    let oi;
    for (const s of findSignals(r, tf, STRAT[tf] || {})) {
      let ck = confirmations(r, s.side, tf, 0), passed = Object.values(ck).filter(Boolean).length;
      if (passed + 1 < min) continue; // even with the OI check it cannot reach the minimum
      if (calls + 4 > 48) { errors.push("subrequest budget reached"); break; }
      if (oi === undefined) { calls++; try { oi = await openInterest(t.symbol, tf); } catch (e) { oi = null; } }
      ck = confirmations(r, s.side, tf, trendScore(r, s.side, oi)); passed = Object.values(ck).filter(Boolean).length;
      if (passed < min) continue;
      Object.assign(s, { ck, passed });
      const t0 = r.d[r.d.length - 1].t + ms, seen = `s:${s.sym}:${tf}:${t0}`;
      if (test && sent.length >= 2) break; // test mode: at most 2 samples
      if (env.TRADES && !test && (await env.TRADES.get(seen))) continue; // already posted for this candle
      if (env.TRADES && !test) {
        if ((await env.TRADES.list({ prefix: `o:${s.sym}:`, limit: 1 })).keys.length) { errors.push(s.sym + " skipped: trade already open"); continue; }
        if ((+(await env.TRADES.get("d:" + day)) || 0) >= maxDay) { errors.push("daily signal cap reached"); break; }
      }
      calls += 2; let chart = null; try { chart = await renderChart(r, s); } catch (e) { console.log("chart failed", e.message); }
      const msg = test ? await tg(env, "🧪 <b>TEST (not tracked)</b>\n" + caption(s, env), chart) : await send(env, s, chart);
      if (env.TRADES && !test) {
        const trade = { sym: s.sym, side: s.side, tf, kind: s.kind, lvl: s.lvl, entry: s.entry, sl: s.sl, tps: s.tps, riskPct: s.riskPct, passed, t0, stage: 0, cursor: 0, msg };
        await env.TRADES.put(seen, "1", { expirationTtl: 6 * 3600 });
        await env.TRADES.put("d:" + day, String((+(await env.TRADES.get("d:" + day)) || 0) + 1), { expirationTtl: 2 * 86400 });
        await env.TRADES.put(`o:${s.sym}:${tf}:${t0}`, JSON.stringify(trade), { expirationTtl: 33 * 86400 });
      }
      sent.push(`${s.sym} ${s.side} ${s.kind} ${passed}/8`);
    }
  }
  console.log("sent", sent, "errors", errors);
  return { batch, scanned: list.length, sent, errors: errors.slice(0, 5) };
}

async function notifyUpdate(env, t, ev, info) {
  let chart = null;
  try { const k = await klines(t.sym, t.tf); const r = buildRow(t.sym, k, null); if (r) chart = await renderChart(r, { ...t, track: info }); } catch (e) { console.log("chart failed", e.message); }
  return tg(env, eventText(t, ev), chart, t.msg);
}

// Constant-time compare via SHA-256 digests so key length/prefix does not leak through timing.
async function safeEq(a, b) {
  const h = async (x) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export default {
  scheduled(e, env, ctx) {
    if (e.cron === "*/5 * * * *") {
      const m = new Date(e.scheduledTime).getUTCMinutes();
      if (m % 15 === 0) ctx.waitUntil(track(env, (t, ev, info) => notifyUpdate(env, t, ev, info)));
      ctx.waitUntil(whaleWatch(env, (text) => tg(env, text)).catch(() => {}));
      if (m % 15 === 10) ctx.waitUntil(ideaTrack(env, (text) => tg(env, text)).catch(() => {}));
      if (m === 5) ctx.waitUntil(radar(env, (text) => tg(env, text)).catch(() => {}));
    }
    else if (e.cron === "30 18 * * *") { // 00:00 IST: daily summary, plus the weekly report when a new week starts in IST (Sunday 18:30 UTC)
      const sunday = new Date(e.scheduledTime).getUTCDay() === 0;
      ctx.waitUntil((async () => { await tg(env, await weekly(env, 1)); if (sunday) await tg(env, await weekly(env, 7)); })());
    }
    else ctx.waitUntil(run(env, { tf: e.cron === "1-5 * * * *" ? "1h" : e.cron === "1-5 */4 * * *" ? "4h" : "1d", batch: Math.max(0, (new Date(e.scheduledTime).getUTCMinutes() % 15) - 1) })); // minute 1..5 of each candle close = batch 0..4
  },
  // Manual checks (need ?key=RUN_KEY): /__run?tf=1h|4h|1d&batch=0..4&min=N scans now, /__track checks open trades, /__weekly posts the report, /__ping tests Telegram, /__run?...&test=1 posts up to 2 sample signals (min conf 4, not tracked, not counted).
  async fetch(req, env) {
    const u = new URL(req.url);
    const given = (req.headers.get("authorization") || "").replace(/^Bearer /i, "") || u.searchParams.get("key") || "";
    const ok = !!env.RUN_KEY && given.length > 0 && (await safeEq(given, env.RUN_KEY));
    if (ok && u.pathname === "/__radar") return Response.json(await radar(env, (text) => tg(env, text)));
    if (ok && u.pathname === "/__sample") {
      const site = "https://crypto-flow-radar.live-scanner.workers.dev/radar.html", w = (a) => `<a href="https://hypurrscan.io/address/${a}">0x5b5d…c060</a>`;
      await tg(env, ["<b>🧪 SAMPLE (format preview)</b>", "", "<b>🐋 Whale wallet moves</b>", "", `🟢 ${w("0x5b5d51203a0f9079f8aeb098a6523a13f298c060")} opened <b>SHORT BTC</b> $181.24M · entry 76366`, `➕ ${w("0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00")} added to <b>SHORT ETH</b> $8.55M → $21.39M`, `🔄 ${w("0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36")} flipped to <b>LONG SOL</b> $3.20M · entry 182.4`, `🔴 ${w("0x7fdafde5cfb5465924316eced2d3715494c517d1")} closed <b>LONG HYPE</b> ($5.10M)`, "", `<a href="${site}">Live radar</a> · <i>wallets can hedge elsewhere; not advice</i>`].join("\n"));
      await tg(env, ["<b>🧪 SAMPLE (format preview)</b>", "", "<b>📡 Signal Radar</b>", "", "💸 <b>POWR</b> funding -0.928% — shorts crowded", "⚡ <b>BEAM</b> 3.1× normal hourly volume, price +7.61%", "🎯 <b>LONG BNB</b> (score 4) entry 714.63 · SL 710.25 · TP1 721.20 · TP2 727.77\n   <i>4.3× volume up · top wallets net long $9.0M</i>", "", `<a href="${site}">Open live radar</a> · <i>flags, not trade advice</i>`].join("\n"));
      return Response.json({ sent: 2 });
    }
    if (ok && u.pathname === "/__whales") return Response.json(await whaleWatch(env, (text) => tg(env, text)));
    if (ok && u.pathname === "/__track") return Response.json(await track(env, (t, ev, info) => notifyUpdate(env, t, ev, info)));
    if (ok && u.pathname === "/__weekly") { await tg(env, await weekly(env, +u.searchParams.get("days") || 7)); return Response.json({ sent: true }); }
    if (u.pathname === "/api/ideas" && env.TRADES) return Response.json(await ideaStats(env), { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
    if (ok && u.pathname === "/__ideas") return Response.json(await ideaTrack(env, (text) => tg(env, text)));
    if (u.pathname === "/api/trades" && env.TRADES) {
      const cache = caches.default, ck = new Request(u.origin + "/api/trades");
      const hit = await cache.match(ck);
      if (hit) return hit;
      const pub = (t) => ({ sym: t.sym, side: t.side, tf: t.tf, kind: t.kind, entry: t.entry, sl: t.sl, tps: t.tps, stage: t.stage, t0: t.t0, passed: t.passed });
      const open = (await loadOpen(env)).filter(([, t]) => isLive(t)).map(([, t]) => pub(t)), closed = ((await env.TRADES.get("closed", "json")) || []).filter(isLive);
      const res = Response.json({ open, closed }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
      await cache.put(ck, res.clone());
      return res;
    }
    if (ok && u.pathname === "/__run") {
      try { return Response.json(await run(env, { force: true, tf: u.searchParams.get("tf") || undefined, batch: +u.searchParams.get("batch") || 0, minConf: +u.searchParams.get("min") || 0, test: u.searchParams.get("test") === "1" })); } catch (e) { return new Response(String(e.message), { status: 500 }); }
    }
    if (ok && u.pathname === "/__ping") {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.TG_CHAT, text: "✅ TEST: SPYDER Flow Radar connected. Real signals will appear here." }) });
      return new Response(await r.text(), { status: r.status });
    }
    return new Response("Not found", { status: 404 });
  },
};
