import { tickers, klines } from "./data.js";

const BURST_MIN = 3, FUND_MIN = 0.05, TOP = 20; // FUND_MIN is in percent (8h rate)
const SITE = "https://crypto-flow-radar.live-scanner.workers.dev/radar.html";
const sym = (s) => s.replace(/USDT$/, "");

// Hourly scan: volume bursts vs each coin's own 24h hourly average, plus crowded funding. Dedupes per hour in KV.
export async function radar(env, send) {
  const ts = await tickers(), hr = Math.floor(Date.now() / 36e5), lines = [];
  const seen = async (k) => { if (await env.TRADES.get(k)) return true; await env.TRADES.put(k, "1", { expirationTtl: 7200 }); return false; };

  for (const f of ts.filter((t) => t.fund != null && t.vol > 5e6 && Math.abs(t.fund) >= FUND_MIN).sort((a, b) => Math.abs(b.fund) - Math.abs(a.fund)).slice(0, 3))
    if (!(await seen(`rf:${f.symbol}:${hr}`))) lines.push(`💸 <b>${sym(f.symbol)}</b> funding ${f.fund.toFixed(3)}% — ${f.fund > 0 ? "longs" : "shorts"} crowded`);

  const top = ts.sort((a, b) => b.vol - a.vol).slice(0, TOP);
  const res = await Promise.allSettled(top.map((t) => klines(t.symbol, "1h")));
  res.forEach((r, i) => {
    if (r.status !== "fulfilled" || r.value.length < 27) return;
    const k = r.value.slice(0, -1), last = k[k.length - 1], hist = k.slice(-25, -1);
    const avg = hist.reduce((a, c) => a + +c[7], 0) / hist.length;
    if (!avg) return;
    const x = +last[7] / avg, chg = (+last[4] / +last[1] - 1) * 100;
    if (x >= BURST_MIN) lines.push({ key: `rb:${top[i].symbol}:${last[0]}`, text: `⚡ <b>${sym(top[i].symbol)}</b> ${x.toFixed(1)}× normal hourly volume, price ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` });
  });

  const out = [];
  for (const l of lines) if (typeof l === "string" || !(await seen(l.key))) out.push(typeof l === "string" ? l : l.text);
  if (!out.length) return { sent: 0 };
  await send(["<b>📡 Signal Radar</b>", "", ...out, "", `<a href="${SITE}">Open live radar</a> · <i>flags, not trade advice</i>`].join("\n"));
  return { sent: out.length };
}
