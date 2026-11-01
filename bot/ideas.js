import { klines15 } from "./data.js";

const MAX_OPEN = 8, MAX_CLOSED = 200, EXPIRE_MS = 48 * 36e5;
const sym = (s) => s.replace(/USDT$/, "");
const p5 = (n) => n.toPrecision(5);

export async function addIdea(env, idea) {
  const open = (await env.TRADES.get("ideas_open", "json")) || [];
  if (open.length >= MAX_OPEN || open.some((o) => o.sy === idea.sy)) return;
  open.push(idea);
  await env.TRADES.put("ideas_open", JSON.stringify(open));
}

// Result per idea: first touch of SL = -1R, TP1 = +1.5R. Same-candle touch of both counts as SL. Expires unscored after 48h.
export async function ideaTrack(env, send) {
  const open = (await env.TRADES.get("ideas_open", "json")) || [];
  if (!open.length) return { open: 0, closed: 0 };
  const keep = [], done = [];
  const res = await Promise.allSettled(open.map((o) => klines15(o.sy, o.t0)));
  open.forEach((o, i) => {
    const cs = res[i].status === "fulfilled" ? res[i].value.filter((c) => c.t >= o.t0) : [];
    let out = null;
    for (const c of cs) {
      const sl = o.long ? c.l <= o.sl : c.h >= o.sl, tp = o.long ? c.h >= o.t1 : c.l <= o.t1;
      if (sl) { out = { res: "SL", r: -1 }; break; }
      if (tp) { out = { res: "TP1", r: 1.5 }; break; }
    }
    if (!out && Date.now() - o.t0 > EXPIRE_MS) out = { res: "EXPIRED", r: 0 };
    if (out) done.push({ ...o, ...out, t1c: Date.now() }); else keep.push(o);
  });
  if (!done.length) return { open: keep.length, closed: 0 };
  const closed = ((await env.TRADES.get("ideas_closed", "json")) || []).concat(done).slice(-MAX_CLOSED);
  await env.TRADES.put("ideas_closed", JSON.stringify(closed));
  await env.TRADES.put("ideas_open", JSON.stringify(keep));
  const wl = closed.filter((c) => c.res !== "EXPIRED"), wins = wl.filter((c) => c.r > 0).length;
  const lines = done.map((d) => `${d.res === "TP1" ? "✅" : d.res === "SL" ? "❌" : "⏱"} <b>${d.long ? "LONG" : "SHORT"} ${sym(d.sy)}</b> ${d.res === "EXPIRED" ? "expired (no TP/SL in 48h)" : d.res === "TP1" ? "hit TP1 " + p5(d.t1) + " (+1.5R)" : "stopped " + p5(d.sl) + " (-1R)"}`);
  await send(["<b>🎯 Radar idea result</b>", "", ...lines, "", `<i>Idea record: ${wins}W / ${wl.length - wins}L over ${wl.length} closed (net ${wl.reduce((a, c) => a + c.r, 0).toFixed(1)}R)</i>`].join("\n"));
  return { open: keep.length, closed: done.length };
}

export async function ideaStats(env) {
  const open = (await env.TRADES.get("ideas_open", "json")) || [], closed = (await env.TRADES.get("ideas_closed", "json")) || [];
  return { open, closed: closed.slice(-50).reverse() };
}
