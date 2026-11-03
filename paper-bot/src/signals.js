// Signal logic for the Telegram bot. Same rules as the dashboard (smc-screener/app.js), without any DOM.
import Lib from "./lib.cjs";

export const TF_MS = { "15m": 900e3, "1h": 3600e3, "4h": 4 * 3600e3, "1d": 86400e3 };
const RR = 2.5;
const sigLv = (rr) => { const t2 = rr > 1 ? rr : 2; return [1, t2, 2 * t2]; };

export function buildRow(sym, k, fund) {
  const d = Lib.parseKlines(k.slice(0, -1)); // drop the forming candle
  if (d.length < 260) return null;
  const an = Lib.analyze(d, null); if (!an) return null;
  const c = d.map((x) => x.c);
  return { sym, d, an, fund, live: Lib.liveSetups(d, { rr: RR }), e50: Lib.ema(c, 50), e200: Lib.ema(c, 200) };
}

// Pullback into the 0.5-0.786 zone of the latest swing leg, closing back in the trade direction.
// o: trend = EMA50/200 must agree, minLeg = leg size in ATR, gp = narrow 0.618-0.65 zone, wick = rejection wick on the last candle.
function fibRetrace(r, side, o = {}) {
  const d = r.d, N = d.length, L = side === "LONG", atr = r.live.atr[N - 1], last = d[N - 1], sw = r.live.swings;
  if (!(atr > 0) || (L ? !(last.c > last.o) : !(last.c < last.o))) return null;
  if (o.trend && (L ? !(r.e50[N - 1] > r.e200[N - 1]) : !(r.e50[N - 1] < r.e200[N - 1]))) return null;
  if (o.wick) { const rng = last.h - last.l, tail = L ? Math.min(last.o, last.c) - last.l : last.h - Math.max(last.o, last.c); if (!(rng > 0) || tail / rng < 0.4) return null; }
  let to = null, from = null;
  for (let k = sw.length - 1; k >= 0; k--) {
    if (!to) { if (sw[k].type === (L ? "H" : "L")) to = sw[k]; } else if (sw[k].type === (L ? "L" : "H")) { from = sw[k]; break; }
  }
  if (!to || !from) return null;
  const range = Math.abs(to.p - from.p), age = N - 1 - to.i;
  if (range < (o.minLeg || 2) * atr || age < 2 || age > 40) return null;
  const lv = (x) => (L ? to.p - x * range : to.p + x * range);
  const zt = o.gp ? 0.618 : 0.5, zh = o.gp ? 0.65 : 0.786;
  const touched = L ? last.l <= lv(zt) : last.h >= lv(zt), held = L ? last.c > lv(zh) && last.c < lv(0.382) : last.c < lv(zh) && last.c > lv(0.382);
  if (!touched || !held) return null;
  const sl = L ? Math.min(last.l, lv(0.786)) - 0.3 * atr : Math.max(last.h, lv(0.786)) + 0.3 * atr, risk = Math.abs(last.c - sl);
  if (!(risk > 0) || risk > 2.5 * atr) return null;
  return { side, kind: "FIB RETRACE", lvl: "0.5-0.786", entry: last.c, sl, risk, atr, fib: { from: from.p, to: to.p } };
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

export const CHECKS = [["trend", "Trend 5/5"], ["ema", "EMA stack"], ["adx", "ADX≥20"], ["vol", "Vol≥1×"], ["fund", "Funding ok"], ["fvg", "FVG entry"], ["vwap", "VWAP flip"], ["val", "Value area reclaim"]];

export function trendScore(r, side, oi) {
  const an = Lib.analyze(r.d, oi); return an ? (side === "LONG" ? an.bull : an.bear) : 0;
}

// 24h volume vs the average of the 7 days before it, from the candles themselves.
function volRatio(r, tf) {
  const per = Math.round(86400e3 / TF_MS[tf]), q = r.d.map((x) => x.qv || 0), N = q.length;
  if (N < per * 8) return NaN;
  const sum = (a, b) => q.slice(a, b).reduce((x, y) => x + y, 0), day = sum(N - per, N), avg = sum(N - 8 * per, N - per) / 7;
  return avg > 0 ? day / avg : NaN;
}

// Same 8 confirmations as the Signals tab on the website. oiScore: trend score incl. open interest (null = OI not fetched, trend check fails).
export function confirmations(r, side, tf, trendScore) {
  const L = side === "LONG", an = r.an, N = r.d.length, c = r.d[N - 1].c, from = Math.max(0, N - 25);
  if (!r._dl) r._dl = Lib.dayLevels(r.d);
  const D = r._dl, prev = D.va[D.day[N - 1] - 1], recent = (f) => { for (let i = from; i < N - 1; i++) if (f(i)) return true; return false; };
  const fu = r.fund, vr = volRatio(r, tf), last = r.d[N - 1].c;
  const fvg = r.live.setups.some((x) => x.side === side && (x.status === "TRIGGERED" || Math.abs((x.entry - last) / last * 100) <= 3));
  return {
    trend: trendScore === 5, ema: an.ema === (L ? "FULL BULL" : "FULL BEAR"), adx: an.adx >= 20, vol: vr >= 1, fund: fu == null || (L ? fu < 0.05 : fu > -0.05), fvg,
    vwap: L ? c > D.vwap[N - 1] && recent((i) => r.d[i].c < D.vwap[i]) : c < D.vwap[N - 1] && recent((i) => r.d[i].c > D.vwap[i]),
    val: !!prev && (L ? c > prev.val && recent((i) => r.d[i].c < prev.val) : c < prev.vah && recent((i) => r.d[i].c > prev.vah)),
  };
}

// Reasons in plain words, only facts that the engine actually checked.
function reasons(r, s, tf) {
  const L = s.side === "LONG", an = r.an, N = r.d.length, out = [], T = tf.toUpperCase();
  if (s.kind === "EMA RETEST") {
    out.push(`${T} EMA50 ${L ? "above" : "below"} EMA200 = ${L ? "uptrend" : "downtrend"}`);
    out.push(`Price tested ${s.lvl} and closed back ${L ? "above" : "below"} it (${L ? "support" : "resistance"} held)`);
    out.push(`Last candle ${L ? "green" : "red"}, confirms the bounce`);
  } else if (s.kind === "FIB RETRACE") {
    out.push(`Pulled back into the 0.5-0.786 Fibonacci zone of the last ${L ? "up" : "down"} swing`);
    out.push(`Last candle ${L ? "green" : "red"}, price closed back in the trade direction inside the zone`);
  } else {
    out.push(`${s.kind} then retrace into a ${L ? "bullish" : "bearish"} FVG, entry order filled`);
  }
  if (an.adx >= 20) out.push(`ADX ${an.adx.toFixed(0)}: trend has strength`);
  else out.push(`ADX ${an.adx.toFixed(0)}: weak trend, caution`);
  if (an.ema === (L ? "FULL BULL" : "FULL BEAR")) out.push("EMA 9/21/50/200 fully stacked in trade direction");
  if (r.fund != null) out.push(`Funding ${r.fund >= 0 ? "+" : ""}${r.fund.toFixed(3)}%${(L ? r.fund > 0.05 : r.fund < -0.05) ? " (crowded, risky)" : ""}`);
  out.push(`Stop ${s.riskPct.toFixed(1)}% away, ${(s.risk / (r.live.atr[N - 1] || 1)).toFixed(1)} ATR`);
  return out;
}

// Candidates created by the candle that just closed (fresh FVG fill; EMA retest and Fibonacci pullback are opt-in). Confirmations are applied by the caller.
export function findSignals(r, tf, { ema = false, fib = false, fvg = true } = {}) {
  const N = r.d.length, found = [];
  for (const side of ["LONG", "SHORT"]) {
    const er = ema && emaRetest(r, side);
    if (er) found.push(er);
    const fb = fib && fibRetrace(r, side, fib === true ? {} : fib);
    if (fb) found.push(fb);
    const fv = fvg && r.live.setups.filter((x) => x.side === side && x.status === "TRIGGERED" && x.filledBarsAgo === 0)[0];
    if (fv) found.push({ side, kind: fv.kind, lvl: "FVG", entry: fv.entry, sl: fv.sl, risk: Math.abs(fv.entry - fv.sl) });
  }
  return found.filter(withTargets).map((s) => Object.assign(s, { sym: r.sym, tf, reasons: reasons(r, s, tf), closeT: r.d[N - 1].t }));
}
