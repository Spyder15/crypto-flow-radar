// Signal logic for the Telegram bot. Same rules as the dashboard (smc-screener/app.js), without any DOM.
import Lib from "../smc-screener/lib.js";

export const TF_MS = { "1h": 3600e3, "4h": 4 * 3600e3, "1d": 86400e3 };
const RR = 2.5;
const sigLv = (rr) => { const t2 = rr > 1 ? rr : 2; return [1, t2, 2 * t2]; };

export function buildRow(sym, k, fund) {
  const d = Lib.parseKlines(k.slice(0, -1)); // drop the forming candle
  if (d.length < 260) return null;
  const an = Lib.analyze(d, null); if (!an) return null;
  const c = d.map((x) => x.c);
  return { sym, d, an, fund, live: Lib.liveSetups(d, { rr: RR }), e50: Lib.ema(c, 50), e200: Lib.ema(c, 200) };
}

function emaRetest(r, side) {
  const d = r.d, N = d.length, L = side === "LONG", atr = r.live.atr[N - 1], last = d[N - 1], price = last.c;
  if (!(atr > 0)) return null;
  if (L ? !(r.e50[N - 1] > r.e200[N - 1]) : !(r.e50[N - 1] < r.e200[N - 1])) return null;
  if (L ? !(last.c > last.o) : !(last.c < last.o)) return null;
  for (const [name, e] of [["EMA50", r.e50], ["EMA200", r.e200]]) {
    if (L ? price <= e[N - 1] : price >= e[N - 1]) continue;
    let wick = null;
    for (let i = N - 3; i < N; i++) {
      const k = d[i], ev = e[i];
      if (L ? k.l <= ev + 0.25 * atr && k.c > ev - 0.25 * atr : k.h >= ev - 0.25 * atr && k.c < ev + 0.25 * atr) wick = L ? Math.min(wick == null ? k.l : wick, k.l) : Math.max(wick == null ? k.h : wick, k.h);
    }
    if (wick == null) continue;
    const sl = L ? wick - 0.3 * atr : wick + 0.3 * atr, risk = Math.abs(price - sl);
    if (!(risk > 0) || risk > 2 * atr) continue;
    return { side, kind: "EMA RETEST", lvl: name, entry: price, sl, risk, atr };
  }
  return null;
}

function withTargets(s) {
  const L = s.side === "LONG", risk = s.risk != null ? s.risk : Math.abs(s.entry - s.sl);
  s.risk = risk; s.riskPct = risk / s.entry * 100;
  s.tps = sigLv(RR).map((m) => (L ? s.entry + m * risk : s.entry - m * risk));
  return !(s.riskPct > 15) && s.tps.every((t) => t > 0);
}

// Reasons in plain words, only facts that the engine actually checked.
function reasons(r, s, tf) {
  const L = s.side === "LONG", an = r.an, N = r.d.length, out = [], T = tf.toUpperCase();
  if (s.kind === "EMA RETEST") {
    out.push(`${T} EMA50 ${L ? "above" : "below"} EMA200 = ${L ? "uptrend" : "downtrend"}`);
    out.push(`Price tested ${s.lvl} and closed back ${L ? "above" : "below"} it (${L ? "support" : "resistance"} held)`);
    out.push(`Last candle ${L ? "green" : "red"}, confirms the bounce`);
  } else {
    out.push(`${s.kind} then retrace into a ${L ? "bullish" : "bearish"} FVG, entry order filled`);
  }
  const sc = L ? an.bull : an.bear;
  out.push(`Momentum (DMI, RSI, OBV) agrees ${sc}/4${sc < 2 ? ": weak, caution" : ""}`);
  if (an.adx >= 20) out.push(`ADX ${an.adx.toFixed(0)}: trend has strength`);
  else out.push(`ADX ${an.adx.toFixed(0)}: weak trend, caution`);
  if (an.ema === (L ? "FULL BULL" : "FULL BEAR")) out.push("EMA 9/21/50/200 fully stacked in trade direction");
  if (r.fund != null) out.push(`Funding ${r.fund >= 0 ? "+" : ""}${r.fund.toFixed(3)}%${(L ? r.fund > 0.05 : r.fund < -0.05) ? " (crowded, risky)" : ""}`);
  out.push(`Stop ${s.riskPct.toFixed(1)}% away, ${(s.risk / (r.live.atr[N - 1] || 1)).toFixed(1)} ATR`);
  return out;
}

// Only signals created by the candle that just closed.
export function findSignals(r, tf) {
  const N = r.d.length, found = [];
  for (const side of ["LONG", "SHORT"]) {
    const er = emaRetest(r, side);
    if (er) found.push(er);
    const sc = side === "LONG" ? r.an.bull : r.an.bear;
    const fv = r.live.setups.filter((x) => x.side === side && x.status === "TRIGGERED" && x.filledBarsAgo === 0)[0];
    if (fv && sc >= 3) found.push({ side, kind: fv.kind, lvl: "FVG", entry: fv.entry, sl: fv.sl, risk: Math.abs(fv.entry - fv.sl) });
  }
  return found.filter(withTargets).map((s) => Object.assign(s, { sym: r.sym, tf, reasons: reasons(r, s, tf), closeT: r.d[N - 1].t }));
}
