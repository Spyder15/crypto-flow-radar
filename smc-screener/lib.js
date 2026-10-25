/* Core logic: indicators, SMC (BOS/CHoCH -> FVG retrace) engine, scanner checks. Works in browser and node. */
(function (root) {
  const Lib = {};

  // candles: [{t,o,h,l,c,v}]
  Lib.parseKlines = (k) => k.map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], qv: +x[7] }));

  const sma = (x, n) => x.map((_, i) => { if (i < n - 1) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) s += x[j]; return s / n; });
  Lib.ema = (x, n) => { // pandas ewm(span, adjust=False)
    const a = 2 / (n + 1), o = new Array(x.length).fill(NaN); let p = NaN;
    for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) continue; p = isNaN(p) ? x[i] : a * x[i] + (1 - a) * p; o[i] = p; }
    return o;
  };
  const emaAdj = (x, n) => { // pandas ewm(span, adjust=True)
    const a = 2 / (n + 1), o = []; let num = 0, den = 0;
    for (let i = 0; i < x.length; i++) { num = x[i] + (1 - a) * num; den = 1 + (1 - a) * den; o.push(num / den); }
    return o;
  };
  const wilder = (x, n) => { const a = 1 / n, o = new Array(x.length).fill(NaN); let p = NaN; for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) continue; p = isNaN(p) ? x[i] : a * x[i] + (1 - a) * p; o[i] = p; } return o; };

  Lib.trueRange = (d) => d.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - d[i - 1].c), Math.abs(x.l - d[i - 1].c)));
  Lib.atrSma = (d, n = 14) => sma(Lib.trueRange(d), n);

  // ---------------- SMC engine (port of gold_smc_fvg_backtest.bt) ----------------
  Lib.DEFAULTS = { n: 2, rr: 2.5, frac: 0.75, buf: 0.5, lookback: 20, maxwait: 40, minfvg: 0, trend: 0, only: null, fee: 0.06 };

  function core(d, P, onFill) {
    const N = d.length, h = d.map((x) => x.h), l = d.map((x) => x.l), c = d.map((x) => x.c), a = Lib.atrSma(d, 14), e = emaAdj(c, 100);
    const n = P.n; let sh = null, sl = null, bias = 0, brk = -999, kind = null, pend = [], busy = -1;
    const maxIn = (arr, from, to) => { let m = -Infinity; for (let i = from; i <= to; i++) if (arr[i] > m) m = arr[i]; return m; };
    const minIn = (arr, from, to) => { let m = Infinity; for (let i = from; i <= to; i++) if (arr[i] < m) m = arr[i]; return m; };
    const swings = [], breaks = [];
    for (let i = 2 * n + 2; i < N; i++) {
      const k = i - n;
      let isH = h[k] === maxIn(h, k - n, i), isL = l[k] === minIn(l, k - n, i);
      if (isH) for (let j = k - n; j < k; j++) if (!(h[j] < h[k])) { isH = false; break; }
      if (isL) for (let j = k - n; j < k; j++) if (!(l[j] > l[k])) { isL = false; break; }
      if (isH) { sh = h[k]; swings.push({ i: k, p: h[k], type: "H" }); }
      if (isL) { sl = l[k]; swings.push({ i: k, p: l[k], type: "L" }); }
      if (sl !== null && c[i] < sl && c[i - 1] >= sl) { kind = bias === -1 ? "BOS" : "CHoCH"; breaks.push({ i, p: sl, dir: -1, kind }); bias = -1; brk = i; sl = null; }
      if (sh !== null && c[i] > sh && c[i - 1] <= sh) { kind = bias === 1 ? "BOS" : "CHoCH"; breaks.push({ i, p: sh, dir: 1, kind }); bias = 1; brk = i; sh = null; }
      if (!isNaN(a[i])) {
        const okKind = P.only == null || kind === P.only;
        if (okKind && bias === -1 && h[i] < l[i - 2] && (l[i - 2] - h[i]) >= P.minfvg * a[i] && i - brk <= P.lookback && (!P.trend || c[i] < e[i])) pend.push({ s: -1, top: l[i - 2], bot: h[i], t0: i, kind });
        if (okKind && bias === 1 && l[i] > h[i - 2] && (l[i] - h[i - 2]) >= P.minfvg * a[i] && i - brk <= P.lookback && (!P.trend || c[i] > e[i])) pend.push({ s: 1, top: l[i], bot: h[i - 2], t0: i, kind });
      }
      const keep = [];
      for (const z of pend) {
        if (i <= z.t0 || i - z.t0 > P.maxwait || i <= busy) { if (i - z.t0 <= P.maxwait) keep.push(z); continue; }
        const { s, top, bot } = z; let ent, st, hit; const ai = P.strict === false ? a[i] : a[i - 1];
        const strict = P.strict !== false;
        if (s === -1) { if (!strict && c[i] > top) continue; ent = bot + (top - bot) * P.frac; hit = h[i] >= ent; st = top + P.buf * ai; }
        else { if (!strict && c[i] < bot) continue; ent = top - (top - bot) * P.frac; hit = l[i] <= ent; st = bot - P.buf * ai; }
        if (hit) { const r = onFill(i, z, ent, st, ai); if (r != null) busy = r; continue; }
        if (strict && (s === -1 ? c[i] > top : c[i] < bot)) continue; // invalidated by a close through the zone, effective after this bar
        keep.push(z);
      }
      pend = keep;
    }
    return { pend, swings, breaks, bias, brk, atr: a, ema: e };
  }

  function sim(h, l, i, s, ent, st, rr, risk, cost) {
    if (risk <= 0) return null;
    const tp = ent + s * rr * risk;
    for (let j = i; j < h.length; j++) {
      const hs = s === -1 ? h[j] >= st : l[j] <= st;
      if (j === i) { if (hs) return { r: -1 - cost / risk, j, win: false }; continue; }
      const ht = s === -1 ? l[j] <= tp : h[j] >= tp;
      if (hs) return { r: -1 - cost / risk, j, win: false };
      if (ht) return { r: rr - cost / risk, j, win: true };
    }
    return null;
  }

  // Historical trades of the strategy on one symbol. fee = % per side (cost = entry*2*fee/100).
  Lib.backtest = (d, P) => {
    P = Object.assign({}, Lib.DEFAULTS, P); const h = d.map((x) => x.h), l = d.map((x) => x.l), trades = [];
    core(d, P, (i, z, ent, st) => {
      const risk = Math.abs(ent - st), res = sim(h, l, i, z.s, ent, st, P.rr, risk, ent * 2 * P.fee / 100);
      if (!res) return null; trades.push({ i, j: res.j, s: z.s, r: res.r, win: res.win }); return res.j;
    });
    return trades;
  };

  Lib.stats = (tr) => {
    if (!tr.length) return { n: 0, win: NaN, exp: NaN, pf: NaN, maxDD: 0 };
    const r = tr.map((t) => t.r), g = r.filter((x) => x > 0).reduce((a, b) => a + b, 0), ls = -r.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
    let eq = 0, pk = 0, dd = 0; for (const x of r) { eq += x; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
    return { n: r.length, win: tr.filter((t) => t.r > 0).length / r.length, exp: r.reduce((a, b) => a + b, 0) / r.length, pf: ls > 0 ? g / ls : Infinity, maxDD: dd };
  };

  // Live view: waiting FVG orders and fresh fills on the last closed bars.
  Lib.liveSetups = (d, P) => {
    P = Object.assign({}, Lib.DEFAULTS, P); const N = d.length, fills = [];
    const res = core(d, P, (i, z, ent, st, atr) => { if (i >= N - 3) fills.push({ z, ent, st, i }); return null; });
    const last = d[N - 1].c, mk = (z, ent, st, status, i) => {
      const risk = Math.abs(ent - st), tp = ent + z.s * P.rr * risk;
      return { side: z.s === 1 ? "LONG" : "SHORT", kind: z.kind, status, top: z.top, bot: z.bot, entry: ent, sl: st, tp, rr: P.rr, riskPct: risk / ent * 100, distPct: (ent - last) / last * 100, age: N - 1 - z.t0, t0: z.t0, filledBarsAgo: i == null ? null : N - 1 - i };
    };
    const out = [];
    for (const z of res.pend) {
      const a = res.atr[N - 1];
      const ent = z.s === -1 ? z.bot + (z.top - z.bot) * P.frac : z.top - (z.top - z.bot) * P.frac;
      const st = z.s === -1 ? z.top + P.buf * a : z.bot - P.buf * a;
      out.push(mk(z, ent, st, "WAITING"));
    }
    for (const f of fills) { const o = mk(f.z, f.ent, f.st, "TRIGGERED", f.i); const invalid = f.z.s === 1 ? last <= f.st : last >= f.st; const done = f.z.s === 1 ? last >= o.tp : last <= o.tp; if (!invalid && !done) out.push(o); }
    return { setups: out, bias: res.bias, lastBreak: res.breaks[res.breaks.length - 1] || null, swings: res.swings, breaks: res.breaks, atr: res.atr, ema100: res.ema };
  };

  // Forward-test: advance one logged setup using only closed candles after it was first seen.
  // Same rules as the backtest: SL is checked first, and on the fill bar only SL is checked.
  Lib.resolveFwd = (e, d, P) => {
    if (e.state === "win" || e.state === "loss" || e.state === "expired") return e;
    P = Object.assign({}, Lib.DEFAULTS, P);
    const s = e.side === "LONG" ? 1 : -1, risk = Math.abs(e.entry - e.sl), cost = e.entry * 2 * P.fee / 100;
    for (const x of d) {
      if (x.t <= (e.lastT || e.seenT)) continue;
      e.lastT = x.t; e.bars = (e.bars || 0) + 1;
      const hs = s === 1 ? x.l <= e.sl : x.h >= e.sl;
      if (e.state === "pending") {
        const hit = s === 1 ? x.l <= e.entry : x.h >= e.entry;
        if (hit) { e.state = "open"; e.fillT = x.t; if (hs) { e.state = "loss"; e.r = -1 - cost / risk; return e; } continue; }
        if (s === 1 ? x.c < e.inval : x.c > e.inval) { e.state = "expired"; return e; }
        if (e.bars + (e.age0 || 0) > P.maxwait) { e.state = "expired"; return e; }
      } else {
        const ht = s === 1 ? x.h >= e.tp : x.l <= e.tp;
        if (hs) { e.state = "loss"; e.r = -1 - cost / risk; return e; }
        if (ht) { e.state = "win"; e.r = (Math.abs(e.tp - e.entry) / risk) - cost / risk; return e; }
      }
    }
    return e;
  };

  // ---------------- Trend confirmation / EMA screener (port of crypto_scanner.analyze) ----------------
  Lib.analyze = (d, oi) => {
    const h = d.map((x) => x.h), l = d.map((x) => x.l), c = d.map((x) => x.c), v = d.map((x) => x.v), N = d.length;
    if (N < 220) return null;
    const atr = wilder(Lib.trueRange(d), 14);
    const up = h.map((x, i) => i ? x - h[i - 1] : NaN), dn = l.map((x, i) => i ? l[i - 1] - x : NaN);
    const pdi = wilder(up.map((u, i) => i ? (u > dn[i] && u > 0 ? u : 0) : NaN), 14).map((x, i) => 100 * x / atr[i]);
    const mdi = wilder(dn.map((u, i) => i ? (u > up[i] && u > 0 ? u : 0) : NaN), 14).map((x, i) => 100 * x / atr[i]);
    const adx = wilder(pdi.map((p, i) => 100 * Math.abs(p - mdi[i]) / (p + mdi[i])), 14);
    const delta = c.map((x, i) => i ? x - c[i - 1] : NaN);
    const gain = wilder(delta.map((x) => isNaN(x) ? NaN : Math.max(x, 0)), 14), loss = wilder(delta.map((x) => isNaN(x) ? NaN : Math.max(-x, 0)), 14);
    const rsi = gain.map((g, i) => 100 - 100 / (1 + g / loss[i]));
    let o = 0; const obv = v.map((x, i) => (o += (i ? Math.sign(delta[i]) : 0) * x));
    const i = N - 1, rsiE = Lib.ema(rsi, 14), obvE = Lib.ema(obv, 50);
    const e9 = Lib.ema(c, 9), e21 = Lib.ema(c, 21), e50 = Lib.ema(c, 50), e200 = Lib.ema(c, 200);
    const dmiB = pdi[i] > mdi[i] && pdi[i] > adx[i], dmiS = mdi[i] > pdi[i] && mdi[i] > adx[i];
    const rsiAbove = rsi[i] > rsiE[rsiE.length - 1], r50 = rsi[i] > 50, obvAbove = obv[i] > obvE[i];
    const oiUp = !!oi && oi.length >= 3 && oi[oi.length - 1] > oi[oi.length - 2] && oi[oi.length - 2] > oi[oi.length - 3];
    const oiChg = oi && oi.length >= 3 ? (oi[oi.length - 1] / oi[oi.length - 3] - 1) * 100 : NaN;
    const bull = +dmiB + +rsiAbove + +r50 + +obvAbove + +oiUp, bear = +dmiS + +!rsiAbove + +!r50 + +!obvAbove + +oiUp;
    const fullBull = e9[i] > e21[i] && e21[i] > e50[i] && e50[i] > e200[i], fullBear = e9[i] < e21[i] && e21[i] < e50[i] && e50[i] < e200[i];
    const a = atr[i], lo3 = Math.min(l[i], l[i - 1], l[i - 2]), hi3 = Math.max(h[i], h[i - 1], h[i - 2]);
    let pullback = "";
    if (fullBull && lo3 <= e21[i] + 0.25 * a && c[i] > e21[i]) pullback = "LONG";
    if (fullBear && hi3 >= e21[i] - 0.25 * a && c[i] < e21[i]) pullback = "SHORT";
    return { price: c[i], adx: adx[i], rsi: rsi[i], dmi: dmiB ? "BULL" : dmiS ? "BEAR" : "-", checks: { dmi: dmiB, rsiEma: rsiAbove, rsi50: r50, obv: obvAbove, oi: oiUp }, bull, bear, oiChg, ema: fullBull ? "FULL BULL" : fullBear ? "FULL BEAR" : "-", pullback, atrPct: a / c[i] * 100, e9: e9[i], e21: e21[i], e50: e50[i], e200: e200[i] };
  };

  if (typeof module !== "undefined") module.exports = Lib; else root.Lib = Lib;
})(typeof self !== "undefined" ? self : this);
