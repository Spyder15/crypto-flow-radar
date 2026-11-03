// Spyder Strategy (body alignment + body sweep), same rules as bot/backtest-spyder.mjs.
// Bearish: candle i-1 closes bearish with body >= BODY of its range, its body top aligns with candle i-2's body top (within TOL),
// candle i sweeps above both body tops and closes back below i-1's top. Enter at the close of i, SL above the sweep high. Bullish is the mirror.
export function spyderSignal(d, { body = 0.8, tol = 0.003, buf = 0.001 } = {}) {
  const n = d.length; if (n < 3) return null;
  const a = d[n - 3], b = d[n - 2], c = d[n - 1], rng = b.h - b.l;
  if (!(rng > 0)) return null;
  const top = (x) => Math.max(x.o, x.c), bot = (x) => Math.min(x.o, x.c), bodyB = Math.abs(b.c - b.o) / rng;
  if (b.c < b.o && bodyB >= body && Math.abs(top(b) - top(a)) / b.o <= tol && c.h > Math.max(top(a), top(b)) && c.c < top(b) && c.c < c.o) return { side: "SHORT", entry: c.c, sl: c.h * (1 + buf), t: c.t };
  if (b.c > b.o && bodyB >= body && Math.abs(bot(b) - bot(a)) / b.o <= tol && c.l < Math.min(bot(a), bot(b)) && c.c > bot(b) && c.c > c.o) return { side: "LONG", entry: c.c, sl: c.l * (1 - buf), t: c.t };
  return null;
}

// Fixed target, no management. A candle touching both stop and target counts the stop first.
export function evaluate(t, candles) {
  const L = t.side === "LONG";
  for (const c of candles) {
    if (t.closed) break;
    t.cursor = c.t;
    if (L ? c.l <= t.sl : c.h >= t.sl) { t.closed = true; t.outcome = "SL"; t.r = -1; return { type: "SL", price: t.sl }; }
    if (L ? c.h >= t.tp : c.l <= t.tp) { t.closed = true; t.outcome = "TP"; t.r = t.rr; return { type: "TP", price: t.tp }; }
  }
  return null;
}
