import { tickers, klines } from "./data.js";
import { addIdea } from "./ideas.js";

const WALLET_NET = 5e6, IDEA_MIN = 3, BURST_MIN = 3, FUND_MIN = 0.05, TOP = 15; // FUND_MIN is in percent (8h rate)
const SITE = "https://crypto-flow-radar.live-scanner.workers.dev/radar.html";
const fmtUsd = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 1e3) + "K");
const sym = (s) => s.replace(/USDT$/, "");

// Hourly scan: volume bursts vs each coin's own 24h hourly average, plus crowded funding. Dedupes per hour in KV.
export async function radar(env, send) {
  const ts = await tickers(), hr = Math.floor(Date.now() / 36e5), lines = [];
  const seen = async (k) => { if (await env.TRADES.get(k)) return true; await env.TRADES.put(k, "1", { expirationTtl: 7200 }); return false; };

  for (const f of ts.filter((t) => t.fund != null && t.vol > 5e6 && Math.abs(t.fund) >= FUND_MIN).sort((a, b) => Math.abs(b.fund) - Math.abs(a.fund)).slice(0, 3))
    if (!(await seen(`rf:${f.symbol}:${hr}`))) lines.push(`💸 <b>${sym(f.symbol)}</b> funding ${f.fund.toFixed(3)}% — ${f.fund > 0 ? "longs" : "shorts"} crowded`);

  const wallets = (await env.TRADES.get("whales", "json")) || {}, net = {}; // top-wallet net long(+)/short(-) USD per coin
  Object.values(wallets).forEach((w) => Object.entries(w).forEach(([c, p]) => { net[c] = (net[c] || 0) + (p.long ? p.usd : -p.usd); }));
  const fundOf = Object.fromEntries(ts.map((t) => [t.symbol, t.fund]));
  const ideas = [];
  const top = ts.sort((a, b) => b.vol - a.vol).slice(0, TOP);
  const res = await Promise.allSettled(top.map((t) => klines(t.symbol, "1h")));
  res.forEach((r, i) => {
    if (r.status !== "fulfilled" || r.value.length < 27) return;
    const k = r.value.slice(0, -1), last = k[k.length - 1], hist = k.slice(-25, -1);
    const avg = hist.reduce((a, c) => a + +c[7], 0) / hist.length;
    if (!avg) return;
    const x = +last[7] / avg, chg = (+last[4] / +last[1] - 1) * 100;
    const atr = k.slice(-14).reduce((a, c) => a + (+c[2] - +c[3]), 0) / 14, mark = +last[4], sy = top[i].symbol;
    let score = 0; const why = [];
    if (x >= BURST_MIN) { score += 2 * Math.sign(chg); why.push(`${x.toFixed(1)}× volume ${chg > 0 ? "up" : "down"}`); }
    const f = fundOf[sy];
    if (f != null && Math.abs(f) >= FUND_MIN) { score -= Math.sign(f); why.push(f > 0 ? "longs crowded" : "shorts crowded"); }
    const wn = net[sym(sy)] || 0;
    if (Math.abs(wn) >= WALLET_NET) { score += 2 * Math.sign(wn); why.push(`top wallets net ${wn > 0 ? "long" : "short"} ${fmtUsd(Math.abs(wn))}`); }
    if (Math.abs(score) >= IDEA_MIN && atr > 0) ideas.push({ sy, long: score > 0, score: Math.abs(score), why, mark, r: atr * 1.5 });
    if (x >= BURST_MIN) lines.push({ key: `rb:${top[i].symbol}:${last[0]}`, text: `⚡ <b>${sym(top[i].symbol)}</b> ${x.toFixed(1)}× normal hourly volume, price ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` });
  });

  for (const i of ideas.sort((a, b) => b.score - a.score).slice(0, 3)) {
    if (await seen(`ri:${i.sy}:${i.long}:${Math.floor(Date.now() / 144e5)}`)) continue;
    const d = i.long ? 1 : -1, p = (n) => n.toPrecision(5);
    await addIdea(env, { sy: i.sy, long: i.long, entry: i.mark, sl: i.mark - d * i.r, t1: i.mark + d * i.r * 1.5, t2: i.mark + d * i.r * 3, t0: Date.now() });
    lines.push(`🎯 <b>${i.long ? "LONG" : "SHORT"} ${sym(i.sy)}</b> (score ${i.score}) entry ${p(i.mark)} · SL ${p(i.mark - d * i.r)} · TP1 ${p(i.mark + d * i.r * 1.5)} · TP2 ${p(i.mark + d * i.r * 3)}\n   <i>${i.why.join(" · ")}</i>`);
  }
  const out = [];
  for (const l of lines) if (typeof l === "string" || !(await seen(l.key))) out.push(typeof l === "string" ? l : l.text);
  if (!out.length) return { sent: 0 };
  await send(["<b>📡 Signal Radar</b>", "", ...out, "", `<a href="${SITE}">Open live radar</a> · <i>flags, not trade advice</i>`].join("\n"));
  return { sent: out.length };
}
