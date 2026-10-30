(function () {
  const F = "https://fapi.binance.com", $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const base = (s) => s.replace(/USDT$/, "");
  const fmtP = (x) => x == null || isNaN(x) ? "-" : x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : x.toPrecision(4);
  const f1 = (x, d = 2) => x == null || isNaN(x) || !isFinite(x) ? "-" : x.toFixed(d);
  const sgn = (x, d = 2) => x == null || isNaN(x) ? "-" : (x > 0 ? "+" : "") + x.toFixed(d);
  const cls = (x) => x > 0 ? "good" : x < 0 ? "bad" : "dim";

  const SECTORS = {
    "Layer 1": "BTC ETH SOL ADA AVAX DOT NEAR ATOM APT SUI TON TRX ICP ALGO SEI HBAR KAS FIL EGLD XTZ FLOW MINA BERA S SONIC MOVE INIT TIA ZRO",
    "Layer 2": "ARB OP POL MATIC STRK IMX MANTA ZK METIS BLAST TAIKO MNT",
    "DeFi": "UNI AAVE MKR CRV LDO SNX COMP DYDX JUP PENDLE ENA ETHFI RUNE CAKE SUSHI 1INCH GMX RAY HYPE JTO MORPHO EIGEN SSV",
    "AI": "FET RENDER TAO WLD AR GRT VIRTUAL AIXBT ARKM AI16Z GRASS IO OLAS NEAR AGIX OCEAN",
    "Meme": "DOGE SHIB PEPE WIF BONK FLOKI 1000PEPE 1000SHIB 1000BONK 1000FLOKI 1000SATS TRUMP FARTCOIN PNUT POPCAT MEME BRETT MEW NEIRO GOAT MOODENG ACT PENGU BOME 1000CAT TURBO DOGS 1000RATS",
    "Gaming": "AXS SAND MANA GALA ENJ APE PIXEL YGG ILV BIGTIME PORTAL BEAM RONIN",
    "Exchange": "BNB OKB BGB LEO CRO GT",
    "Payments/Legacy": "XRP XLM LTC BCH ETC DASH BSV DOGE VET IOTA XEC",
    "Oracle/Infra": "LINK PYTH API3 BAND THETA ANKR QNT STORJ",
    "Privacy": "XMR ZEC SCRT ROSE",
    "RWA": "ONDO POLYX CFG PLUME OM",
  };
  const SEC = {}; Object.entries(SECTORS).forEach(([s, l]) => l.split(" ").forEach((c) => { if (!SEC[c]) SEC[c] = s; }));
  const sectorOf = (sym) => SEC[base(sym)] || "Other";

  const DEF = { n: 2, rr: 2.5, frac: 0.75, buf: 0.5, lookback: 20, maxwait: 40, minfvg: 0, fee: 0.06, only: "", trend: 0 };
  let P = {};
  try { P = JSON.parse(localStorage.getItem("smcP") || "{}"); } catch (e) { P = {}; }
  P = Object.assign({}, DEF, P && typeof P === "object" ? P : {});
  let rows = [], busy = false, timer = null, seen = new Set(), sortState = {}, fund = {}, fng = null, failed = 0, firstScan = true;
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full */ } };
  let fav = new Set(ls("fav", [])), rules = ls("rules", null), alertLog = ls("alertLog", []), alertKeys = new Set(ls("alertKeys", [])), fwd = ls("fwd", []), sigLog = ls("sigLog", []);
  if (!rules) rules = [{ id: 1, side: "ANY", score: 5, ema: 1, pb: 0, setup: "", vol: 0, adx: 0 }];
  const tblState = {};
  const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n) || "").trim() || d;
  const symCell = (sym) => `<span class="star ${fav.has(sym) ? "on" : ""}" data-star="${sym}" title="Watchlist">★</span><b>${esc(base(sym))}</b>`;
  const favOk = (sym) => !$("favOnly").checked || fav.has(sym);
  const fundOf = (sym) => fund[sym];
  const fundFmt = (x) => x == null ? "-" : `<span class="${Math.abs(x) >= 0.03 ? "mid" : "dim"}">${sgn(x, 4)}</span>`;

  // ---------- network ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, params) {
    const q = new URLSearchParams(params || {}).toString();
    for (let k = 0; k < 3; k++) {
      try { const r = await fetch(F + path + (q ? "?" + q : "")); if (r.ok) return await r.json(); if (r.status === 429 || r.status === 418) await sleep(1500 * (k + 1)); }
      catch (e) { /* retry */ }
      await sleep(400 * (k + 1));
    }
    return null;
  }
  async function pool(items, n, fn, tick) {
    let i = 0, done = 0; const out = new Array(items.length);
    await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); tick && tick(++done); } }));
    return out;
  }
  const oiPeriod = { "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h" };

  async function scan() {
    if (busy) return; busy = true; $("refresh").disabled = true;
    const tf = $("tf").value, top = +$("top").value;
    if (!rows.length) skeleton();
    try {
      setStatus("Loading tickers…");
      const [tk, pi] = await Promise.all([api("/fapi/v1/ticker/24hr"), api("/fapi/v1/premiumIndex")]);
      if (!tk) throw new Error("Binance API unreachable (blocked region or rate-limited). Try a VPN or wait a minute.");
      if (pi) pi.forEach((x) => { fund[x.symbol] = +x.lastFundingRate * 100; });
      loadFng();
      const list = tk.filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_")).sort((a, b) => b.quoteVolume - a.quoteVolume);
      const picked = list.filter((t) => !/^(SOXL|SPY|MU|SKHYNIX|SNDK|KORU|SPCX|SOXS|CL)/.test(base(t.symbol)) && +t.quoteVolume > 0).slice(0, top);
      const t0 = Date.now(); failed = 0;
      const res = await pool(picked, 4, async (t) => {
        const [k, oi, dk] = await Promise.all([
          api("/fapi/v1/klines", { symbol: t.symbol, interval: tf, limit: 1000 }),
          api("/futures/data/openInterestHist", { symbol: t.symbol, period: oiPeriod[tf], limit: 5 }),
          api("/fapi/v1/klines", { symbol: t.symbol, interval: "1d", limit: 99 }),
        ]);
        if (!k) { failed++; return null; }
        if (k.length < 260) return null;
        const d = Lib.parseKlines(k.slice(0, -1)); // drop forming candle
        const an = Lib.analyze(d, oi ? oi.map((x) => +x.sumOpenInterest) : null);
        if (!an) return null;
        const vol7 = dk && dk.length >= 9 ? dk.slice(-8, -1).reduce((a, x) => a + +x[7], 0) / 7 : NaN;
        return { sym: t.symbol, tk: t, d, an, vol7, dc: dk ? dk.map((x) => +x[4]) : [] };
      }, (n) => setStatus(`Scanning ${n}/${picked.length}…`));
      rows = res.filter(Boolean);
      computeRs();
      computeSmc();
      setStatus(`${rows.length} coins · ${tf} · closed candles · updated ${new Date().toLocaleTimeString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)` + (failed ? ` · ⚠ ${failed} coins failed (rate-limit?) — press Scan now to retry` : ""), failed > 0);
      fwdUpdate(); sigUpdate(); renderAll(); notify(); evalAlerts(); firstScan = false;
    } catch (e) { setStatus("Error: " + e.message, true); }
    busy = false; $("refresh").disabled = false;
  }
  async function loadFng() {
    if (fng && Date.now() - fng.t < 3600e3) return;
    try { const r = await fetch("https://api.alternative.me/fng/?limit=1"); const j = await r.json(); fng = { t: Date.now(), v: +j.data[0].value, c: j.data[0].value_classification }; if (rows.length) renderMarket(); } catch (e) { fng = { t: Date.now(), v: null }; }
  }
  function skeleton() {
    const row = '<tr>' + '<td><div class="sk"></div></td>'.repeat(7) + '</tr>';
    ["trendTable", "smcTable", "emaTable", "sectorTable"].forEach((id) => { $(id).innerHTML = "<tbody>" + row.repeat(8) + "</tbody>"; });
  }
  function setStatus(t, err) { const s = $("status"); s.textContent = t; s.style.color = err ? "var(--r)" : ""; }

  function computeSmc() {
    rows.forEach((r) => {
      r.live = Lib.liveSetups(r.d, P);
      r.bt = Lib.backtest(r.d, P); r.st = Lib.stats(r.bt);
    });
  }

  // ---------- table helper ----------
  function table(el, cols, data, onRow, defSort) {
    const st = sortState[el.id] || (sortState[el.id] = { k: defSort.k, dir: defSort.dir });
    const col = cols.find((c) => c.k === st.k) || cols[0];
    const sorted = data.slice().sort((a, b) => { const x = col.v(a), y = col.v(b); const nx = x == null || (typeof x === "number" && isNaN(x)), ny = y == null || (typeof y === "number" && isNaN(y)); if (nx && ny) return 0; if (nx) return 1; if (ny) return -1; return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    el.classList.add("rt"); tblState[el.id] = { cols, sorted };
    el.innerHTML = "<thead><tr>" + cols.map((c) => `<th data-k="${c.k}">${c.t}${c.k === st.k ? (st.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr></thead><tbody>" +
      (sorted.length ? sorted.map((r, i) => `<tr data-i="${i}">` + cols.map((c) => `<td data-label="${esc(c.t.replace(/&gt;/g, ">"))}">${c.f ? c.f(r) : esc(c.v(r))}</td>`).join("") + "</tr>").join("") : `<tr><td colspan="${cols.length}" class="dim" style="text-align:center;padding:24px">Nothing matches right now.</td></tr>`) + "</tbody>";
    el.querySelectorAll(".star").forEach((s) => s.onclick = (e) => { e.stopPropagation(); const k = s.dataset.star; fav.has(k) ? fav.delete(k) : fav.add(k); save("fav", [...fav]); renderAll(); });
    el.querySelectorAll("th").forEach((th) => th.onclick = () => { const k = th.dataset.k; if (st.k === k) st.dir *= -1; else { st.k = k; st.dir = -1; } table(el, cols, data, onRow, defSort); });
    if (el.id === "scrTable") markSel();
    if (onRow) el.querySelectorAll("tbody tr[data-i]").forEach((tr) => tr.onclick = () => onRow(sorted[+tr.dataset.i]));
  }
  const pill = (s) => `<span class="pill ${s === "LONG" ? "long" : "short"}">${s}</span>`;
  const dots = (a, bear) => `<span class="dots ${bear ? "bear" : ""}">` + a.map((x) => `<span class="${x ? "on" : ""}"></span>`).join("") + "</span>";
  const card = (k, v, c) => `<div class="card"><div class="k">${k}</div><div class="v ${c || ""}">${v}</div></div>`;

  // ---------- SMC tab ----------
  function smcRows() {
    const out = [];
    rows.forEach((r) => r.live.setups.forEach((s) => {
      const score = s.side === "LONG" ? r.an.bull : r.an.bear;
      out.push(Object.assign({ sym: r.sym, r, score }, s));
    }));
    const side = $("f_side").value, status = $("f_status").value, q = $("f_search").value.trim().toUpperCase();
    return out.filter((x) => (!side || x.side === side) && (!status || x.status === status) && (!$("f_dist").value || x.status === "TRIGGERED" || Math.abs(x.distPct) <= +$("f_dist").value) && (!q || x.sym.includes(q)) && (!$("f_trend").checked || x.score >= 4) && favOk(x.sym));
  }
  function renderSmc() {
    const data = smcRows(), all = rows.reduce((a, r) => a + r.live.setups.length, 0);
    const trig = data.filter((x) => x.status === "TRIGGERED").length;
    const tot = Lib.stats(rows.flatMap((r) => r.bt));
    $("smcSummary").innerHTML = card("Coins scanned", rows.length) + card("Active setups", `${data.length}<span class="dim" style="font-size:12px"> / ${all}</span>`) + card("Triggered now", trig, trig ? "mid" : "") +
      card("Long / Short", `${data.filter((x) => x.side === "LONG").length} / ${data.filter((x) => x.side === "SHORT").length}`) +
      card("Backtest, last ~1000 bars", tot.n ? `${f1(tot.win * 100, 0)}% win · ${sgn(tot.exp)}R` : "-", tot.exp > 0 ? "good" : "bad");
    table($("smcTable"), [
      { k: "sym", t: "Symbol", v: (x) => x.sym, f: (x) => symCell(x.sym) },
      { k: "side", t: "Side", v: (x) => x.side, f: (x) => pill(x.side) },
      { k: "status", t: "Status", v: (x) => x.status, f: (x) => x.status === "TRIGGERED" ? `<span class="pill trig">TRIGGERED ${x.filledBarsAgo}b ago</span>` : `<span class="pill wait">WAITING</span>` },
      { k: "entry", t: "Entry", v: (x) => x.entry, f: (x) => fmtP(x.entry) },
      { k: "sl", t: "Stop loss", v: (x) => x.sl, f: (x) => fmtP(x.sl) },
      { k: "tp", t: "Take profit", v: (x) => x.tp, f: (x) => fmtP(x.tp) },
      { k: "dist", t: "Dist to entry", v: (x) => Math.abs(x.distPct), f: (x) => `<span class="${x.status === "TRIGGERED" ? "dim" : ""}">${sgn(x.distPct)}%</span>` },
      { k: "score", t: "Trend score", v: (x) => x.score, f: (x) => `${x.score}/5 ` + dots(Object.values(x.r.an.checks).map((c) => x.side === "LONG" ? c : (c === x.r.an.checks.oi ? c : !c)), x.side === "SHORT") },
    ], data, openDetail, { k: "dist", dir: 1 });
  }

  // ---------- Signals tab: every confirmation must agree ----------
  const SIG_CHECKS = [["trend", "Trend 5/5"], ["ema", "EMA stack"], ["adx", "ADX≥20"], ["vol", "Vol≥1×"], ["fund", "Funding ok"], ["fvg", "FVG entry"], ["vwap", "VWAP flip"], ["val", "Value area reclaim"]];
  const dayOf = (r) => (r._dl && r._dl.n === r.d.length ? r._dl : (r._dl = Object.assign({ n: r.d.length }, Lib.dayLevels(r.d))));
  // VWAP flip: price crossed back over the daily VWAP within the last 24 bars. Value area reclaim: price came back inside/over the previous day's VAL (long) or VAH (short).
  function levelChecks(r, side) {
    const L = side === "LONG", D = dayOf(r), N = r.d.length, c = r.d[N - 1].c, from = Math.max(0, N - 25), prev = D.va[D.day[N - 1] - 1];
    const recent = (f) => { for (let i = from; i < N - 1; i++) if (f(i)) return true; return false; };
    return {
      vwap: L ? c > D.vwap[N - 1] && recent((i) => r.d[i].c < D.vwap[i]) : c < D.vwap[N - 1] && recent((i) => r.d[i].c > D.vwap[i]),
      val: !!prev && (L ? c > prev.val && recent((i) => r.d[i].c < prev.val) : c < prev.vah && recent((i) => r.d[i].c > prev.vah)),
    };
  }
  // Every signal is logged (browser only) and followed on later closed candles: waiting -> entry triggered -> TP hit / SL hit.
  function signalAll() {
    const out = [];
    rows.forEach((r) => {
      const fu = fundOf(r.sym), vr = volRatio(r);
      ["LONG", "SHORT"].forEach((side) => {
        const L = side === "LONG", sc = L ? r.an.bull : r.an.bear;
        const sets = r.live.setups.filter((s) => s.side === side && (s.status === "TRIGGERED" || Math.abs(s.distPct) <= 3))
          .sort((a, b) => (a.status === "TRIGGERED" ? 0 : 1) - (b.status === "TRIGGERED" ? 0 : 1) || Math.abs(a.distPct) - Math.abs(b.distPct));
        const s = sets[0];
        const ck = { trend: sc === 5, ema: r.an.ema === (L ? "FULL BULL" : "FULL BEAR"), adx: r.an.adx >= 20, vol: vr >= 1, fund: fu == null || (L ? fu < 0.05 : fu > -0.05), fvg: !!s };
        Object.assign(ck, levelChecks(r, side));
        const passed = Object.values(ck).filter(Boolean).length;
        out.push(Object.assign({ sym: r.sym, r, score: sc, ck, passed }, s || (passed >= 4 ? trendEntry(r, side) : { skip: true })));
        const er = emaRetest(r, side);
        if (er) out.push(Object.assign({ sym: r.sym, r, score: sc, ck, passed }, er));
      });
    });
    return out.filter((x) => !x.skip);
  }
  // EMA 50/200 retest (works best on 4h-1D): in an EMA50>EMA200 uptrend, a candle tags EMA50 or EMA200 from above and closes back above it, then the last candle is green -> LONG.
  // Mirror for SHORT. Entry at the last close, SL beyond the retest wick (+0.3 ATR), TP = RR x risk.
  function emaRetest(r, side) {
    const d = r.d, N = d.length; if (N < 210) return null;
    if (!r._em || r._em.n !== N) { const c = d.map((k) => k.c); r._em = { n: N, e50: Lib.ema(c, 50), e200: Lib.ema(c, 200) }; }
    const L = side === "LONG", atr = r.live.atr[N - 1], last = d[N - 1], price = last.c; if (!(atr > 0)) return null;
    const E = r._em, lv = [["EMA50", E.e50], ["EMA200", E.e200]];
    if (L ? !(E.e50[N - 1] > E.e200[N - 1]) : !(E.e50[N - 1] < E.e200[N - 1])) return null;
    if (L ? !(last.c > last.o) : !(last.c < last.o)) return null;
    for (const [name, e] of lv) {
      if (L ? price <= e[N - 1] : price >= e[N - 1]) continue;
      let wick = null;
      for (let i = N - 3; i < N; i++) { const k = d[i], ev = e[i]; if (L ? k.l <= ev + 0.25 * atr && k.c > ev - 0.25 * atr : k.h >= ev - 0.25 * atr && k.c < ev + 0.25 * atr) wick = L ? Math.min(wick == null ? k.l : wick, k.l) : Math.max(wick == null ? k.h : wick, k.h); }
      if (wick == null) continue;
      const sl = L ? wick - 0.3 * atr : wick + 0.3 * atr, risk = Math.abs(price - sl);
      if (!(risk > 0) || risk > 2 * atr) continue;
      return { side, kind: "EMA RETEST", lvl: name, strat: true, status: "TRIGGERED", fb: true, top: price, bot: price, entry: price, sl, tp: L ? price + P.rr * risk : price - P.rr * risk, rr: P.rr, riskPct: risk / price * 100, distPct: 0, age: 0, t0: N - 1, filledBarsAgo: 0 };
    }
    return null;
  }
  // No FVG order available: enter at the last close, SL beyond the latest swing (1-3 ATR away), TP = RR x risk.
  function trendEntry(r, side) {
    const L = side === "LONG", N = r.d.length, price = r.d[N - 1].c, atr = r.live.atr[N - 1];
    if (!(atr > 0)) return { skip: true };
    const sw = r.live.swings.filter((w) => w.type === (L ? "L" : "H") && N - w.i <= 80 && (L ? w.p < price : w.p > price)).pop();
    let risk = sw ? Math.abs(price - sw.p) + 0.5 * atr : 1.5 * atr;
    risk = Math.min(3 * atr, Math.max(1 * atr, risk));
    const sl = L ? price - risk : price + risk, tp = L ? price + P.rr * risk : price - P.rr * risk;
    return { side, kind: "TREND", status: "TRIGGERED", fb: true, top: price, bot: price, entry: price, sl, tp, rr: P.rr, riskPct: risk / price * 100, distPct: 0, age: 0, t0: N - 1, filledBarsAgo: 0 };
  }
  function sigUpdate() {
    const tf = $("tf").value, bySym = {}; rows.forEach((r) => bySym[r.sym] = r);
    signalAll().filter((x) => x.passed >= 4 || x.strat).forEach((x) => {
      const d = x.r.d, N = d.length, setupT = d[x.t0].t, id = `${x.sym}|${tf}|${x.side}|${setupT}${x.strat ? "|E" : ""}`;
      let e = sigLog.find((q) => q.id === id);
      if (!e) {
        if (!(x.riskPct <= 15) || !(x.tp > 0) || !(x.sl > 0)) return; // skip degenerate plans (huge stop distance or non-positive target)
        if (x.fb && sigLog.some((q) => q.sym === x.sym && q.tf === tf && q.side === x.side && q.fb && q.kind === x.kind && q.setupT > d[Math.max(0, N - 13)].t)) return; // cooldown: one market signal per 12 bars
        const trig = x.status === "TRIGGERED", seenT = x.fb ? d[N - 1].t : trig ? d[N - 1 - x.filledBarsAgo - 1].t : d[N - 1].t; // triggered FVG: replay from the bar before the fill
        e = { id, sym: x.sym, tf, side: x.side, kind: x.kind, lvl: x.lvl, fb: !!x.fb, setupT, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, riskPct: x.riskPct, inval: x.side === "LONG" ? x.bot : x.top, seenT, be: $("s_be").checked, age0: trig ? 0 : x.age, state: x.fb ? "open" : "pending" };
        if (x.fb) e.fillT = d[N - 1].t;
        sigLog.push(e);
      }
      if (e.state === "pending" || e.state === "open") { e.ck = x.ck; e.passed = x.passed; }
    });
    sigLog.forEach((e) => { const r = bySym[e.sym]; if (r && e.tf === tf) resolveSig(e, r.d); });
    sigLog = sigLog.slice(-500); save("sigLog", sigLog);
  }
  // TP1 = 1R, TP2 = R:R setting (min 2R), TP3 = 2 x TP2. SL stays at its original price even after a TP is hit. SL is checked before TPs on the same candle.
  const sigLv = (rr) => { const t2 = rr > 1 ? rr : 2; return [1, t2, 2 * t2]; };
  function resolveSig(e, d) {
    if (e.state === "win") { e.state = "done"; e.h = [e.lastT, e.lastT, null]; } // entries logged before multi-TP tracking
    if (e.state === "loss") { e.state = "done"; e.slT = e.lastT; }
    if (!e.h) e.h = [null, null, null];
    if (e.state === "done" || e.state === "expired") return;
    const L = e.side === "LONG", risk = Math.abs(e.entry - e.sl), lv = sigLv(e.rr).map((m) => L ? e.entry + m * risk : e.entry - m * risk);
    for (const x of d) {
      if (x.t <= (e.lastT || e.seenT)) continue;
      e.lastT = x.t; e.bars = (e.bars || 0) + 1;
      const beOn = e.be && e.h[0] != null, stop = beOn ? e.entry : e.sl, hs = L ? x.l <= stop : x.h >= stop;
      if (e.state === "pending") {
        if (L ? x.l <= e.entry : x.h >= e.entry) { e.state = "open"; e.fillT = x.t; if (hs) { e.slT = x.t; e.state = "done"; return; } continue; }
        if (L ? x.c < e.inval : x.c > e.inval) { e.state = "expired"; return; }
        if (e.bars + (e.age0 || 0) > P.maxwait) { e.state = "expired"; return; }
      } else {
        if (hs) { e.slT = x.t; if (beOn) e.slBE = true; e.state = "done"; return; }
        lv.forEach((p, i) => { if (e.h[i] == null && (L ? x.h >= p : x.l <= p)) e.h[i] = x.t; });
        if (e.h[2] != null) { e.state = "done"; return; }
      }
    }
  }
  const sigHits = (e) => (e.h || []).filter((t) => t != null).length;
  // Booked R assumes 1/3 of the position closes at each TP; the rest is stopped at the original SL. Fee only once filled.
  function sigBooked(e) {
    if (e.state === "pending" || e.state === "expired") return null;
    const n = sigHits(e), lv = sigLv(e.rr), risk = Math.abs(e.entry - e.sl);
    let r = lv.reduce((a, m, i) => a + (e.h[i] != null ? m / 3 : 0), 0);
    if (e.slT && !e.slBE) r -= (3 - n) / 3;
    return r - e.entry * 2 * P.fee / 100 / risk;
  }
  function sigStatus(e) {
    const n = sigHits(e);
    if (e.state === "pending") return ["wait", "WAITING FOR ENTRY", 1];
    if (e.state === "expired") return ["wait", "CANCELLED", 4];
    if (e.state === "open") return n ? ["long", `TP${n} HIT ✔ · running`, 0] : ["trig", "ENTRY TRIGGERED", 0];
    if (!e.slT) return ["long", "ALL TPs HIT ✔✔✔", 2];
    if (e.slBE) return ["trig", `TP${n} HIT ✔ → stopped at entry (BE)`, 2.5];
    return n ? ["short", `TP${n} HIT ✔ → then SL HIT ✘`, 2.5] : ["short", "SL HIT ✘", 3];
  }
  const sigActive = (e) => e.state === "pending" || e.state === "open";
  function signalRows() {
    const tf = $("tf").value, min = +$("s_min").value, side = $("s_side").value, q = $("s_search").value.trim().toUpperCase(), bySym = {}; rows.forEach((r) => bySym[r.sym] = r);
    const all = sigLog.filter((e) => e.tf === tf && bySym[e.sym] && ((e.passed || 0) >= min || e.kind === "EMA RETEST") && (!side || e.side === side) && (!q || e.sym.includes(q)) && favOk(e.sym));
    const active = all.filter(sigActive), closed = all.filter((e) => !sigActive(e)).sort((a, b) => b.lastT - a.lastT).slice(0, 30);
    return active.concat(closed).map((e) => {
      const r = bySym[e.sym];
      return Object.assign({}, e, { r, ck: e.ck || {}, passed: e.passed || 0, st: sigStatus(e), booked: sigBooked(e), nHit: sigHits(e), distPct: e.state === "pending" ? (e.entry - r.an.price) / r.an.price * 100 : null });
    });
  }
  function renderSignals() {
    const data = signalRows(), n = (f) => data.filter(f).length;
    $("sigSummary").innerHTML = card("Waiting for entry", n((x) => x.state === "pending")) + card("Entry triggered", n((x) => x.state === "open" && !x.nHit), n((x) => x.state === "open" && !x.nHit) ? "mid" : "") +
      card("TP1+ hit, running", n((x) => x.state === "open" && x.nHit), "good") + card("All 3 TPs hit", n((x) => x.state === "done" && !x.slT), "good") +
      card("TP hit, then SL", n((x) => x.state === "done" && x.slT && !x.slBE && x.nHit), "mid") + card("TP1+ hit, stopped at entry (BE)", n((x) => x.slBE), "mid") + card("SL hit (no TP)", n((x) => x.state === "done" && x.slT && !x.nHit), "bad") + card("Cancelled", n((x) => x.state === "expired"));
    const chips = (x) => SIG_CHECKS.map(([k, t]) => `<span class="tag ${x.ck[k] ? "good" : "bad"}">${x.ck[k] ? "✔" : "✘"} ${t}</span>`).join("");
    const tpCell = (x, i) => { const m = sigLv(x.rr)[i], p = x.side === "LONG" ? x.entry + m * Math.abs(x.entry - x.sl) : x.entry - m * Math.abs(x.entry - x.sl); return x.h && x.h[i] != null ? `<span class="good">✔ ${fmtP(p)}</span>` : fmtP(p); };
    table($("sigTable"), [
      { k: "sym", t: "Symbol", v: (x) => x.sym, f: (x) => symCell(x.sym) },
      { k: "side", t: "Side", v: (x) => x.side, f: (x) => pill(x.side) },
      { k: "state", t: "Status", v: (x) => x.st[2], f: (x) => `<span class="pill ${x.st[0]}">${x.st[1]}</span>` },
      { k: "entry", t: "Entry", v: (x) => x.entry, f: (x) => fmtP(x.entry) + (x.kind === "EMA RETEST" ? ` <span class="dim" title="EMA 50/200 retest: entered at the close of the bounce/rejection candle">${x.lvl || "EMA"} retest</span>` : x.fb ? ' <span class="dim" title="No FVG order: entered at the close of the signal candle">mkt</span>' : ' <span class="dim" title="FVG limit order">lmt</span>') },
      { k: "sl", t: "Stop loss", v: (x) => x.sl, f: (x) => x.slBE ? `<span class="dim">BE ${fmtP(x.entry)}</span> <s class="dim">${fmtP(x.sl)}</s>` : x.slT ? `<span class="bad">✘ ${fmtP(x.sl)}</span>` : fmtP(x.sl) },
      { k: "tp1", t: "TP1", v: (x) => x.h && x.h[0] != null ? 1 : 0, f: (x) => tpCell(x, 0) },
      { k: "tp2", t: "TP2", v: (x) => x.h && x.h[1] != null ? 1 : 0, f: (x) => tpCell(x, 1) },
      { k: "tp3", t: "TP3", v: (x) => x.h && x.h[2] != null ? 1 : 0, f: (x) => tpCell(x, 2) },
      { k: "risk", t: "Risk %", v: (x) => x.riskPct, f: (x) => f1(x.riskPct) },
      { k: "dist", t: "Dist to entry", v: (x) => x.distPct == null ? null : Math.abs(x.distPct), f: (x) => x.distPct == null ? "-" : `${sgn(x.distPct)}%` },
      { k: "res", t: "Booked R", v: (x) => x.booked, f: (x) => x.booked == null ? "-" : `<span class="${cls(x.booked)}">${sgn(x.booked)}</span>${sigActive(x) ? ' <span class="dim">open</span>' : ""}` },
      { k: "passed", t: "Confirmations", v: (x) => x.passed, f: (x) => `<b>${x.passed}/${SIG_CHECKS.length}</b> ${chips(x)}` },
    ], data, (x) => {
      const s = x.r.live.setups.find((q) => q.side === x.side && x.r.d[q.t0].t === x.setupT), N = x.r.d.length, i = Math.max(2, x.r.d.findIndex((c) => c.t === x.setupT));
      const sel = s || { side: x.side, kind: x.kind, status: x.state === "open" ? "TRIGGERED" : "WAITING", top: x.entry, bot: x.entry, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, riskPct: x.riskPct, age: N - 1 - i, t0: i, filledBarsAgo: 0 };
      openDetail(Object.assign({ sym: x.sym, r: x.r, sig: x }, sel));
    }, { k: "state", dir: 1 });
  }

  // ---------- Screener tab: posture, RS rating, quick views, split layout ----------
  const POSTURES = [["Advancing", "adv"], ["Topping", "top"], ["Declining", "dec"], ["Basing", "bas"]];
  const posture = (a) => a.price > a.e50 && a.e50 > a.e200 ? "Advancing" : a.price <= a.e50 && a.price > a.e200 ? "Topping" : a.price >= a.e50 && a.price < a.e200 ? "Basing" : "Declining";
  const VIEWS = {
    leaders: ["Momentum leaders", (r) => r.rs >= 80 && r.post === "Advancing"],
    strength: ["Sustained strength", (r) => r.an.ema === "FULL BULL" && r.an.adx >= 20],
    weak: ["Weakening", (r) => r.post === "Topping" || (r.post === "Advancing" && r.an.price < r.an.e21)],
    down: ["Downtrends", (r) => r.post === "Declining"],
  };
  const SETUPS = {
    breakout: ["Breakout", (r) => { const N = r.d.length; return r.an.price >= Math.max(...r.d.slice(N - 21, N - 1).map((x) => x.h)) * 0.998; }],
    pullback: ["Pullback", (r) => !!r.an.pullback],
    high: ["Near highs", (r) => r.an.price >= Math.max(...r.d.slice(-200).map((x) => x.h)) * 0.97],
    ext: ["Extended", (r) => (r.an.price / r.an.e21 - 1) * 100 > 2.5 * r.an.atrPct],
    slip: ["Slipping", (r) => r.an.price < r.an.e21 && r.an.price > r.an.e50],
    hold: ["Holding", (r) => r.post === "Advancing" && r.an.price >= r.an.e21 && (r.an.price / r.an.e21 - 1) * 100 < r.an.atrPct],
  };
  let scrView = null, scrSetup = null, scrPost = null, selSym = null;
  // RS rating: percentile rank of the 7/30/90-day return relative to BTC (weights re-normalised when a coin has less history).
  function computeRs() {
    const ret = (c, n) => c.length > n ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null, W = [[7, 0.4], [30, 0.3], [90, 0.3]];
    const btc = rows.find((r) => r.sym === "BTCUSDT"), bR = W.map(([n]) => btc ? ret(btc.dc, n) || 0 : 0);
    rows.forEach((r) => {
      let s = 0, w = 0; W.forEach(([n, k], i) => { const x = ret(r.dc, n); if (x != null) { s += k * (x - bR[i]); w += k; } });
      r.rsRaw = w ? s / w : null; r.vsBtc = W.map(([n], i) => { const x = ret(r.dc, n); return x == null ? null : (x - bR[i]) * 100; }); r.post = posture(r.an);
    });
    const ok = rows.filter((r) => r.rsRaw != null).sort((a, b) => a.rsRaw - b.rsRaw);
    rows.forEach((r) => r.rs = null);
    ok.forEach((r, i) => { r.rs = ok.length > 1 ? Math.max(1, Math.min(99, Math.round(1 + i / (ok.length - 1) * 98))) : 50; });
  }
  const rsColor = (x) => x == null ? "var(--line)" : x >= 80 ? "var(--g)" : x >= 50 ? "var(--y)" : "var(--r)";
  const rsBadge = (x) => `<span class="rsbadge" style="background:${rsColor(x)}">${x == null ? "-" : x}</span>`;
  const tplOf = (r) => { const a = r.an; return [["Price > EMA200", a.price > a.e200], ["EMA50 > EMA200", a.e50 > a.e200], ["Price > EMA50", a.price > a.e50], ["Full EMA stack", a.ema === "FULL BULL"], ["ADX ≥ 20", a.adx >= 20], ["RSI > 50", a.rsi > 50], ["Volume ≥ 1× 7d", volRatio(r) >= 1], ["RS rating ≥ 70", r.rs != null && r.rs >= 70]]; };
  function renderScreener() {
    if (!rows.length) return;
    const q = $("scr_search").value.trim().toUpperCase(), pool = rows.filter((r) => favOk(r.sym) && (!q || r.sym.includes(q)));
    const cnt = {}; POSTURES.forEach(([p]) => cnt[p] = rows.filter((r) => r.post === p).length);
    $("posture").innerHTML = POSTURES.map(([p, c]) => `<div class="pcard ${c} ${scrPost === p ? "on" : ""}" data-p="${p}"><div class="k">${p}</div><div class="v">${cnt[p]} <span class="dim" style="font-size:12px;font-weight:400">${f1(cnt[p] / rows.length * 100, 0)}%</span></div></div>`).join("") +
      `<div class="pbar">${POSTURES.map(([p, c]) => `<i style="width:${cnt[p] / rows.length * 100}%;background:var(--${{ adv: "g", top: "y", dec: "r", bas: "b" }[c]})"></i>`).join("")}</div>`;
    $("posture").querySelectorAll(".pcard").forEach((el) => el.onclick = () => { scrPost = scrPost === el.dataset.p ? null : el.dataset.p; renderScreener(); });
    const chips = (id, map, key, set) => { $(id).innerHTML = Object.entries(map).map(([k, [t, f]]) => `<button class="chip ${key() === k ? "on" : ""}" data-k="${k}">${t} <span class="dim">${pool.filter(f).length}</span></button>`).join(""); $(id).querySelectorAll(".chip").forEach((b) => b.onclick = () => { set(key() === b.dataset.k ? null : b.dataset.k); renderScreener(); }); };
    chips("viewChips", VIEWS, () => scrView, (v) => scrView = v); chips("setupChips", SETUPS, () => scrSetup, (v) => scrSetup = v);
    const data = pool.filter((r) => (!scrView || VIEWS[scrView][1](r)) && (!scrSetup || SETUPS[scrSetup][1](r)) && (!scrPost || r.post === scrPost));
    $("scrCount").textContent = `${data.length} coins match`;
    table($("scrTable"), [
      { k: "sym", t: "Symbol", v: (r) => r.sym, f: (r) => symCell(r.sym) },
      { k: "last", t: "Last", v: (r) => +r.tk.lastPrice, f: (r) => fmtP(+r.tk.lastPrice) },
      { k: "chg", t: "Chg%", v: (r) => +r.tk.priceChangePercent, f: (r) => `<span class="${cls(+r.tk.priceChangePercent)}">${sgn(+r.tk.priceChangePercent, 1)}%</span>` },
      { k: "rs", t: "RS", v: (r) => r.rs, f: (r) => rsBadge(r.rs) },
      { k: "post", t: "Posture", v: (r) => r.post, f: (r) => `<span class="dim">${r.post}</span>` },
    ], data, (r) => selectCoin(r.sym), { k: "rs", dir: -1 });
    markSel();
    if (!selSym || !rows.some((r) => r.sym === selSym)) { const f = tblState.scrTable.sorted[0]; if (f) selectCoin(f.sym); } else ensureDock();
  }
  function markSel() { const s = tblState.scrTable; if (!s) return; $("scrTable").querySelectorAll("tbody tr[data-i]").forEach((tr) => { const on = s.sorted[+tr.dataset.i].sym === selSym; tr.classList.toggle("sel", on); if (on && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" }); }); }
  function selectCoin(sym) {
    const r = rows.find((x) => x.sym === sym); if (!r) return;
    selSym = sym; markSel(); openDock(r);
  }
  function openDock(r) {
    const box = document.querySelector(".modalbox"), dock = $("dock"); if (!box) return;
    $("dockEmpty").classList.add("hidden"); dock.appendChild(box); box.classList.add("docked");
    cur = { r, clicked: null, tf: $("tf").value, sig: null }; cs = { N: 130, off: 0, mx: null, my: null, drag: null };
    $("mDeriv").innerHTML = ""; $("mMtf").innerHTML = ""; $("mSig").innerHTML = ""; showDetail();
  }
  function ensureDock() { const box = document.querySelector(".modalbox"); if (!box.classList.contains("docked") || !cur) { const r = rows.find((x) => x.sym === selSym); if (r) openDock(r); } }
  document.addEventListener("keydown", (e) => {
    if (activeTab() !== "screener" || !["ArrowDown", "ArrowUp"].includes(e.key) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$("modal").classList.contains("hidden")) return;
    const s = tblState.scrTable; if (!s || !s.sorted.length) return; e.preventDefault();
    const i = s.sorted.findIndex((r) => r.sym === selSym), j = Math.max(0, Math.min(s.sorted.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    selectCoin(s.sorted[j].sym);
  });

  // ---------- Report tab: weekly / monthly results of the signal log ----------
  function renderReport() {
    const per = +$("r_per").value, side = $("r_side").value, since = per ? Date.now() - per * 864e5 : 0, tm = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const base0 = sigLog.filter((e) => !side || e.side === side);
    const closed = base0.filter((e) => e.state === "done" && (e.lastT || 0) >= since).map((e) => Object.assign({}, e, { booked: sigBooked(e), nHit: sigHits(e), st: sigStatus(e) }));
    const n = (f) => closed.filter(f).length, sum = closed.reduce((a, e) => a + (e.booked || 0), 0), wins = n((e) => e.booked > 0);
    const open = base0.filter((e) => e.state === "open").length, wait = base0.filter((e) => e.state === "pending").length;
    $("repSummary").innerHTML = card("Closed signals", closed.length) + card("Net result", `${sgn(sum)} R`, cls(sum)) + card("Win rate (net R > 0)", closed.length ? f1(wins / closed.length * 100, 0) + "%" : "-") +
      card("TP1 hit", n((e) => e.h[0] != null), "good") + card("TP2 hit", n((e) => e.h[1] != null), "good") + card("TP3 hit", n((e) => e.h[2] != null), "good") +
      card("SL hit (no TP)", n((e) => e.slT && !e.nHit), "bad") + card("TP hit, then SL", n((e) => e.slT && !e.slBE && e.nHit), "mid") + card("TP1+ then stopped at entry (BE)", n((e) => e.slBE), "mid") +
      card("Still open", open) + card("Waiting for entry", wait) + card("Cancelled", base0.filter((e) => e.state === "expired" && (e.lastT || 0) >= since).length);
    const wk = {};
    closed.forEach((e) => { const d = new Date(e.lastT), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)), k = m.getTime(); (wk[k] = wk[k] || { t: k, n: 0, tp1: 0, tp2: 0, tp3: 0, sl: 0, be: 0, r: 0 }); const o = wk[k]; o.n++; if (e.h[0]) o.tp1++; if (e.h[1]) o.tp2++; if (e.h[2]) o.tp3++; if (e.slT && !e.slBE) o.sl++; if (e.slBE) o.be++; o.r += e.booked || 0; });
    table($("repWeek"), [
      { k: "t", t: "Week starting", v: (o) => o.t, f: (o) => new Date(o.t).toLocaleDateString([], { month: "short", day: "numeric" }) },
      { k: "n", t: "Signals", v: (o) => o.n }, { k: "tp1", t: "TP1", v: (o) => o.tp1 }, { k: "tp2", t: "TP2", v: (o) => o.tp2 }, { k: "tp3", t: "TP3", v: (o) => o.tp3 },
      { k: "sl", t: "SL hit", v: (o) => o.sl }, { k: "be", t: "BE stop", v: (o) => o.be },
      { k: "r", t: "Net R", v: (o) => o.r, f: (o) => `<span class="${cls(o.r)}">${sgn(o.r)}</span>` },
    ], Object.values(wk), null, { k: "t", dir: -1 });
    table($("repTable"), [
      { k: "sym", t: "Symbol", v: (e) => e.sym, f: (e) => `<b>${esc(base(e.sym))}</b>` },
      { k: "side", t: "Side", v: (e) => e.side, f: (e) => pill(e.side) }, { k: "tf", t: "TF", v: (e) => e.tf },
      { k: "st", t: "Result", v: (e) => e.st[2], f: (e) => `<span class="pill ${e.st[0]}">${e.st[1]}</span>` },
      { k: "entry", t: "Entry", v: (e) => e.entry, f: (e) => fmtP(e.entry) }, { k: "sl", t: "SL", v: (e) => e.sl, f: (e) => fmtP(e.sl) },
      { k: "tp", t: "TPs hit", v: (e) => e.nHit, f: (e) => `${e.nHit}/3` },
      { k: "r", t: "Net R", v: (e) => e.booked, f: (e) => `<span class="${cls(e.booked)}">${sgn(e.booked)}</span>` },
      { k: "ct", t: "Closed", v: (e) => e.lastT, f: (e) => tm(e.lastT) },
    ], closed, null, { k: "ct", dir: -1 });
  }

  // ---------- Trend tab ----------
  function renderTrend() {
    const min = +$("t_min").value, side = $("t_side").value, q = $("t_search").value.trim().toUpperCase();
    const data = rows.map((r) => ({ r, sym: r.sym, side: r.an.bull >= r.an.bear ? "LONG" : "SHORT", score: Math.max(r.an.bull, r.an.bear) }))
      .filter((x) => x.score >= min && (!side || x.side === side) && (!q || x.sym.includes(q)) && favOk(x.sym));
    const c = (x) => x.r.an.checks, ok = (x, k) => x.side === "LONG" ? c(x)[k] : (k === "oi" ? c(x)[k] : !c(x)[k]);
    const mark = (x, k) => ok(x, k) ? '<span class="good">✔</span>' : '<span class="bad">✘</span>';
    table($("trendTable"), [
      { k: "sym", t: "Symbol", v: (x) => x.sym, f: (x) => symCell(x.sym) },
      { k: "side", t: "Side", v: (x) => x.side, f: (x) => pill(x.side) },
      { k: "score", t: "Score", v: (x) => x.score, f: (x) => `<b>${x.score}/5</b>` },
      { k: "dmi", t: "DMI", v: (x) => ok(x, "dmi") ? 1 : 0, f: (x) => mark(x, "dmi") },
      { k: "rsiE", t: "RSI&gt;EMA", v: (x) => ok(x, "rsiEma") ? 1 : 0, f: (x) => mark(x, "rsiEma") },
      { k: "r50", t: "RSI 50", v: (x) => ok(x, "rsi50") ? 1 : 0, f: (x) => mark(x, "rsi50") },
      { k: "obv", t: "OBV&gt;EMA50", v: (x) => ok(x, "obv") ? 1 : 0, f: (x) => mark(x, "obv") },
      { k: "oi", t: "OI rising", v: (x) => c(x).oi ? 1 : 0, f: (x) => mark(x, "oi") },
      { k: "adx", t: "ADX", v: (x) => x.r.an.adx, f: (x) => f1(x.r.an.adx, 1) },
      { k: "rsi", t: "RSI", v: (x) => x.r.an.rsi, f: (x) => f1(x.r.an.rsi, 1) },
      { k: "oic", t: "OI chg %", v: (x) => x.r.an.oiChg, f: (x) => `<span class="${cls(x.r.an.oiChg)}">${sgn(x.r.an.oiChg)}</span>` },
      { k: "fund", t: "Funding %", v: (x) => fundOf(x.sym), f: (x) => fundFmt(fundOf(x.sym)) },
      { k: "vol", t: "Vol vs 7d", v: (x) => volRatio(x.r), f: (x) => f1(volRatio(x.r)) + "×" },
      { k: "chg", t: "24h %", v: (x) => +x.r.tk.priceChangePercent, f: (x) => `<span class="${cls(+x.r.tk.priceChangePercent)}">${sgn(+x.r.tk.priceChangePercent)}</span>` },
    ], data, (x) => openDetail({ r: x.r, sym: x.sym }), { k: "score", dir: -1 });
  }
  const volRatio = (r) => r.vol7 > 0 ? +r.tk.quoteVolume / r.vol7 : NaN;

  // ---------- EMA tab ----------
  // Trade plan for the EMA table: EMA 50/200 retest first, else EMA21 pullback, else full EMA stack (market entry, swing/ATR stop, TP from R:R).
  function emaPlan(r) {
    const key = r.d.length + "|" + P.rr;
    if (r._pl && r._pl.key === key) return r._pl.v;
    let v = null;
    for (const side of ["LONG", "SHORT"]) { const q = emaRetest(r, side); if (q) { v = Object.assign(q, { src: q.lvl + " retest" }); break; } }
    if (!v) {
      const side = r.an.pullback || (r.an.ema === "FULL BULL" ? "LONG" : r.an.ema === "FULL BEAR" ? "SHORT" : null);
      if (side) { const q = trendEntry(r, side); if (!q.skip) v = Object.assign(q, { src: r.an.pullback ? "EMA21 pullback" : "EMA stack" }); }
    }
    if (v && (!(v.riskPct <= 15) || sigLv(v.rr).some((m) => (v.side === "LONG" ? v.entry + m * Math.abs(v.entry - v.sl) : v.entry - m * Math.abs(v.entry - v.sl)) <= 0))) v = null; // drop plans with a huge stop or a non-positive target
    if (v) { const risk = Math.abs(v.entry - v.sl), L = v.side === "LONG"; v.tps = sigLv(v.rr).map((m) => L ? v.entry + m * risk : v.entry - m * risk); }
    r._pl = { key, v };
    return v;
  }
  function renderEma() {
    const m = $("e_mode").value, adx = +$("e_adx").value || 0, q = $("e_search").value.trim().toUpperCase();
    const data = rows.filter((r) => ({ fullbull: r.an.ema === "FULL BULL", fullbear: r.an.ema === "FULL BEAR", pbl: r.an.pullback === "LONG", pbs: r.an.pullback === "SHORT", rtl: !!emaRetest(r, "LONG"), rts: !!emaRetest(r, "SHORT"), all: true }[m]) && r.an.adx >= adx && (!q || r.sym.includes(q)) && favOk(r.sym));
    table($("emaTable"), [
      { k: "sym", t: "Symbol", v: (r) => r.sym, f: (r) => symCell(r.sym) },
      { k: "stack", t: "EMA stack", v: (r) => r.an.ema, f: (r) => `<span class="${r.an.ema === "FULL BULL" ? "good" : r.an.ema === "FULL BEAR" ? "bad" : "dim"}">${r.an.ema}</span>` },
      { k: "rt", t: "EMA 50/200 retest", v: (r) => (emaRetest(r, "LONG") || emaRetest(r, "SHORT") || {}).side || "", f: (r) => { const q = emaRetest(r, "LONG") || emaRetest(r, "SHORT"); return q ? `${pill(q.side)} <span class="dim">${q.lvl}</span>` : "-"; } },
      { k: "side", t: "Side", v: (r) => (emaPlan(r) || {}).side || "", f: (r) => { const p = emaPlan(r); return p ? `${pill(p.side)} <span class="dim">${p.src}</span>` : "-"; } },
      { k: "en", t: "Entry", v: (r) => (emaPlan(r) || {}).entry, f: (r) => { const p = emaPlan(r); return p ? fmtP(p.entry) : "-"; } },
      { k: "sl", t: "Stop loss", v: (r) => (emaPlan(r) || {}).sl, f: (r) => { const p = emaPlan(r); return p ? `<span class="bad">${fmtP(p.sl)}</span>` : "-"; } },
      { k: "tp1", t: "TP1", v: (r) => (emaPlan(r) || { tps: [] }).tps[0], f: (r) => { const p = emaPlan(r); return p ? fmtP(p.tps[0]) : "-"; } },
      { k: "tp2", t: "TP2", v: (r) => (emaPlan(r) || { tps: [] }).tps[1], f: (r) => { const p = emaPlan(r); return p ? fmtP(p.tps[1]) : "-"; } },
      { k: "tp3", t: "TP3", v: (r) => (emaPlan(r) || { tps: [] }).tps[2], f: (r) => { const p = emaPlan(r); return p ? fmtP(p.tps[2]) : "-"; } },
      { k: "rk", t: "Risk %", v: (r) => (emaPlan(r) || {}).riskPct, f: (r) => { const p = emaPlan(r); return p ? f1(p.riskPct) : "-"; } },
      { k: "pb", t: "Pullback", v: (r) => r.an.pullback, f: (r) => r.an.pullback ? pill(r.an.pullback) : "-" },
      { k: "price", t: "Price", v: (r) => r.an.price, f: (r) => fmtP(r.an.price) },
      { k: "d21", t: "Dist EMA21 %", v: (r) => (r.an.price / r.an.e21 - 1) * 100, f: (r) => sgn((r.an.price / r.an.e21 - 1) * 100) },
      { k: "d50", t: "Dist EMA50 %", v: (r) => (r.an.price / r.an.e50 - 1) * 100, f: (r) => sgn((r.an.price / r.an.e50 - 1) * 100) },
      { k: "adx", t: "ADX", v: (r) => r.an.adx, f: (r) => f1(r.an.adx, 1) },
      { k: "atr", t: "ATR %", v: (r) => r.an.atrPct, f: (r) => f1(r.an.atrPct) },
      { k: "fund", t: "Funding %", v: (r) => fundOf(r.sym), f: (r) => fundFmt(fundOf(r.sym)) },
      { k: "score", t: "Trend score", v: (r) => Math.max(r.an.bull, r.an.bear), f: (r) => `${Math.max(r.an.bull, r.an.bear)}/5 ${r.an.bull >= r.an.bear ? "L" : "S"}` },
      { k: "vol", t: "Vol vs 7d", v: (r) => volRatio(r), f: (r) => f1(volRatio(r)) + "×" },
      { k: "chg", t: "24h %", v: (r) => +r.tk.priceChangePercent, f: (r) => `<span class="${cls(+r.tk.priceChangePercent)}">${sgn(+r.tk.priceChangePercent)}</span>` },
    ], data, (r) => openDetail({ r, sym: r.sym }), { k: "vol", dir: -1 });
  }

  // ---------- Sector tab ----------
  function renderSector() {
    const tot24 = rows.reduce((a, r) => a + +r.tk.quoteVolume, 0), tot7 = rows.reduce((a, r) => a + (r.vol7 || 0), 0), map = {};
    rows.forEach((r) => { const s = sectorOf(r.sym), o = map[s] || (map[s] = { sector: s, v24: 0, v7: 0, up: 0, n: 0, chg: 0, coins: [] }); o.v24 += +r.tk.quoteVolume; o.v7 += r.vol7 || 0; o.n++; o.chg += +r.tk.priceChangePercent; if (+r.tk.priceChangePercent > 0) o.up++; o.coins.push(r); });
    const data = Object.values(map).map((o) => Object.assign(o, { share: o.v24 / tot24 * 100, share7: o.v7 / tot7 * 100, ratio: o.v7 ? o.v24 / o.v7 : NaN, avgChg: o.chg / o.n, part: o.up / o.n * 100 }));
    data.forEach((o) => { o.dShare = o.share - o.share7; o.flow = o.ratio > 1.15 && o.dShare > 0.3 && o.avgChg > 0 ? "INFLOW" : o.ratio < 0.85 && o.dShare < -0.3 ? "OUTFLOW" : "NEUTRAL"; });
    const best = data.slice().sort((a, b) => b.dShare - a.dShare)[0];
    $("sectorCards").innerHTML = best ? card("Total 24h volume", "$" + (tot24 / 1e9).toFixed(2) + "B") + card("Volume vs 7d avg", f1(tot24 / tot7) + "×") + card("Biggest share gain", `${esc(best.sector)} ${sgn(best.dShare)}pp`, "good") : "";
    table($("sectorTable"), [
      { k: "sector", t: "Sector", v: (o) => o.sector, f: (o) => `<b>${esc(o.sector)}</b>` },
      { k: "flow", t: "Flow", v: (o) => o.flow, f: (o) => `<span class="${o.flow === "INFLOW" ? "good" : o.flow === "OUTFLOW" ? "bad" : "dim"}">${o.flow}</span>` },
      { k: "v24", t: "24h vol", v: (o) => o.v24, f: (o) => "$" + (o.v24 / 1e6).toFixed(0) + "M" },
      { k: "ratio", t: "Vol vs 7d", v: (o) => o.ratio, f: (o) => f1(o.ratio) + "×" },
      { k: "share", t: "Share %", v: (o) => o.share, f: (o) => f1(o.share, 1) },
      { k: "dShare", t: "Δ share (pp)", v: (o) => o.dShare, f: (o) => `<span class="${cls(o.dShare)}">${sgn(o.dShare)}</span>` },
      { k: "avgChg", t: "Avg 24h %", v: (o) => o.avgChg, f: (o) => `<span class="${cls(o.avgChg)}">${sgn(o.avgChg)}</span>` },
      { k: "part", t: "Participation", v: (o) => o.part, f: (o) => f1(o.part, 0) + "% (" + o.up + "/" + o.n + ")" },
      { k: "top", t: "Top movers", v: (o) => o.sector, f: (o) => o.coins.slice().sort((a, b) => +b.tk.priceChangePercent - +a.tk.priceChangePercent).slice(0, 4).map((r) => `${esc(base(r.sym))} <span class="${cls(+r.tk.priceChangePercent)}">${sgn(+r.tk.priceChangePercent, 1)}%</span>`).join(" · ") },
    ], data, null, { k: "dShare", dir: -1 });
  }

  // ---------- Proof tab: live backtest ----------
  function renderBt() {
    const done = rows.filter((r) => r.st.n);
    const a = Lib.stats(rows.flatMap((r) => r.bt));
    $("btCards").innerHTML = card("Trades", a.n) + card("Win rate", f1(a.win * 100, 1) + "%") + card("Expectancy", sgn(a.exp) + " R", cls(a.exp)) + card("Profit factor", f1(a.pf)) + card("Coins positive", `${done.filter((r) => r.st.exp > 0).length}/${done.length}`);
    table($("btTable"), [
      { k: "sym", t: "Symbol", v: (r) => r.sym, f: (r) => `<b>${esc(base(r.sym))}</b>` },
      { k: "n", t: "Trades", v: (r) => r.st.n }, { k: "win", t: "Win %", v: (r) => r.st.win, f: (r) => f1(r.st.win * 100, 0) },
      { k: "exp", t: "Expectancy R", v: (r) => r.st.exp, f: (r) => `<span class="${cls(r.st.exp)}">${sgn(r.st.exp)}</span>` },
      { k: "pf", t: "PF", v: (r) => r.st.pf, f: (r) => f1(r.st.pf) }, { k: "dd", t: "Max DD (R)", v: (r) => r.st.maxDD, f: (r) => f1(r.st.maxDD, 1) },
    ], done, (r) => openDetail({ r, sym: r.sym }), { k: "exp", dir: -1 });
    $("btStatus").textContent = `Based on ${rows.length} coins, settings above, fee ${P.fee}% per side.`;
  }

  // ---------- detail modal + chart ----------
  const DTF = ["1m", "5m", "15m", "30m", "1h", "2h", "4h"], MTF = ["5m", "15m", "1h", "4h"], OIP = ["5m", "15m", "30m", "1h", "2h", "4h"], klCache = {}, dvCache = {};
  let cur = null, cs = { N: 130, off: 0, mx: null, my: null, drag: null }, ctx = null;
  async function getKl(sym, tf) {
    const key = sym + tf, c = klCache[key];
    if (c && Date.now() - c.t < 60000) return c.d;
    const k = await api("/fapi/v1/klines", { symbol: sym, interval: tf, limit: 1000 });
    if (!k || k.length < 100) return null;
    return (klCache[key] = { t: Date.now(), d: Lib.parseKlines(k.slice(0, -1)) }).d;
  }
  function sigDetail(x) {
    const r = x.r, an = r.an, L = x.side === "LONG", risk = Math.abs(x.entry - x.sl), bal = +$("s_bal").value || 0, rp = +$("s_risk").value || 0, fu = fundOf(r.sym), vr = volRatio(r);
    const riskUsd = bal * rp / 100, notional = riskUsd / (x.riskPct / 100), qty = notional / x.entry, lev = Math.max(1, Math.min(50, Math.floor(50 / x.riskPct))), fee = notional * P.fee * 2 / 100;
    const px = (m) => L ? x.entry + m * risk : x.entry - m * risk, usd = (v) => bal ? "$" + f1(v, 2) : "-";
    const lvl = sigLv(x.rr), tps = [["TP1", lvl[0], ""], ["TP2", lvl[1], x.rr > 1 ? " · = R:R setting" : ""], ["TP3", lvl[2], ""]], tm = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const sc = L ? an.bull : an.bear, c = an.checks, ok = (k) => L ? c[k] : (k === "oi" ? c[k] : !c[k]);
    const dayD = dayOf(r), dl = { vwap: dayD.vwap, n: r.d.length }, prevVA = dayD.va[dayD.day[r.d.length - 1] - 1];
    const why = [
      [x.ck.trend, `Trend score ${sc}/5 — DMI ${ok("dmi") ? "✔" : "✘"}, RSI>EMA ${ok("rsiEma") ? "✔" : "✘"}, RSI50 ${ok("rsi50") ? "✔" : "✘"}, OBV ${ok("obv") ? "✔" : "✘"}, OI rising ${c.oi ? "✔" : "✘"} (OI chg ${sgn(an.oiChg)}%)`],
      [x.ck.ema, `EMA stack: ${an.ema} (needs ${L ? "FULL BULL" : "FULL BEAR"}) · EMA21 ${fmtP(an.e21)} · EMA50 ${fmtP(an.e50)} · EMA200 ${fmtP(an.e200)}`],
      [x.ck.adx, `ADX ${f1(an.adx, 1)} (needs ≥ 20 = trending) · RSI ${f1(an.rsi, 0)}`],
      [x.ck.vol, `Volume ${f1(vr)}× the 7-day average (needs ≥ 1×)`],
      [x.ck.fund, `Funding ${fu == null ? "n/a" : sgn(fu, 4) + "%"} (${L ? "longs not crowded: < 0.05%" : "shorts not crowded: > −0.05%"})`],
      [x.ck.fvg, x.fb ? "No FVG order on this side — entry is market at the signal-candle close, SL beyond the latest swing ±0.5 ATR (clamped 1–3 ATR)" : `${x.kind} structure break → FVG limit order at ${f1(P.frac * 100, 0)}% depth of the gap, SL beyond the zone + ${P.buf} ATR`],
      [x.ck.vwap, `Daily VWAP ${fmtP(dl.vwap[dl.n - 1])} — ${L ? "price flipped back above it (reclaim)" : "price flipped back below it (rejection)"} within the last 24 bars`],
      [x.ck.val, prevVA ? `Previous-day value area: VAL ${fmtP(prevVA.val)} · POC ${fmtP(prevVA.poc)} · VAH ${fmtP(prevVA.vah)} — ${L ? "VAL reclaimed" : "VAH rejected"} within the last 24 bars` : "No previous-day value area in the loaded candles"],
    ];
    const st = x.st, ev = [[x.fillT || (x.fb ? x.setupT : null), "Entry triggered", ""]].concat(tps.map(([n], i) => [x.h && x.h[i], `${n} hit`, "good"]), [[x.slT, x.slBE ? `Stopped at entry — break-even (after TP${x.nHit})` : x.nHit ? `SL hit (after TP${x.nHit})` : "SL hit", x.slBE ? "" : "bad"]]).filter((e) => e[0]).sort((a, b) => a[0] - b[0]);
    return `<h4>Signal plan — ${base(x.sym)} ${x.side} · ${$("tf").value}</h4><div id="sigBias" class="note"><b>Bias:</b> loading higher-timeframe view…</div><div class="cards">` +
      card("Status", st[1], st[0] === "short" ? "bad" : st[0] === "long" ? "good" : "mid") + card("Signal candle", tm(x.setupT)) +
      card(x.fb ? "Entry (market)" : "Entry (limit)", fmtP(x.entry)) + card("Stop loss", `${x.slT ? "✘ " : ""}${fmtP(x.sl)} <span class="bad" style="font-size:12px">−${f1(x.riskPct)}% · −${usd(riskUsd)}</span>`) +
      tps.map(([n, m, note], i) => card(`${x.h && x.h[i] != null ? "✔ " : ""}${n} · ${f1(m, 1)}R${note}`, `${fmtP(px(m))} <span class="good" style="font-size:12px">+${f1(m * x.riskPct)}% · +${usd(riskUsd * m)}</span>`, x.h && x.h[i] != null ? "good" : "")).join("") +
      card("Position size", bal ? `${usd(notional)} notional · ${qty >= 1 ? f1(qty, 2) : qty.toPrecision(3)} ${base(x.sym)}` : "set account size") + card(`Margin @ ${lev}× (suggested max)`, bal ? usd(notional / lev) : "-") +
      card("Est. fees (round trip)", bal ? usd(fee) : "-") + card(sigActive(x) ? "Booked so far" : "Final result", x.booked == null ? "not filled" : `${sgn(x.booked)} R` + (bal ? ` · ${x.booked >= 0 ? "+" : "−"}${usd(Math.abs(x.booked) * riskUsd)}` : ""), x.booked == null ? "" : cls(x.booked)) +
      `</div><div class="note"><b>Timeline</b><ul>${ev.length ? ev.map(([t, n, c]) => `<li><span class="${c}">${n}</span> — ${tm(t)}</li>`).join("") : "<li>Waiting for entry…</li>"}</ul>` +
      `<b>Why this signal</b><ul>${why.map(([g, t]) => `<li><span class="${g ? "good" : "bad"}">${g ? "✔" : "✘"}</span> ${t}</li>`).join("")}</ul>` +
      `<b>Plan:</b> ${L ? "buy" : "sell"} at entry, close ⅓ at each TP, stop at SL. ${x.be ? "Break-even mode: after TP1 the stop moves to the entry price, so a pullback shows “TP1 HIT → stopped at entry (BE)” and the rest costs nothing." : "Break-even is off for this signal: the original SL stays even after TP1, so “TP1 hit → then SL hit” shows when price returns to the SL."} Booked R = ⅓ × each TP's R, minus ⅓ per unfilled part stopped, minus fees. Suggested leverage keeps liquidation about 2× further than the stop; position size = account × risk% ÷ SL distance. Not financial advice — backtests found no proven edge.</div>`;
  }
  // "Are you long or short?": higher-timeframe bias (structure + EMA stack + trend score) next to a one-line plan.
  async function loadBias(x, my) {
    const htf = { "1m": "15m", "5m": "1h", "15m": "1h", "30m": "4h", "1h": "4h", "2h": "4h", "4h": "4h" }[x.tf] || "4h", el = $("sigBias"), L = x.side === "LONG";
    const d = await getKl(x.sym, htf);
    if (cur !== my || !el) return;
    if (!d) { el.innerHTML = "<b>Bias:</b> higher-timeframe data unavailable"; return; }
    const an = Lib.analyze(d, null), st = Lib.liveSetups(d, P).bias, v = st + (an.ema === "FULL BULL" ? 1 : an.ema === "FULL BEAR" ? -1 : 0) + (an.bull > an.bear ? 1 : an.bear > an.bull ? -1 : 0);
    const b = v >= 2 ? "LONG" : v <= -2 ? "SHORT" : "NEUTRAL", al = b === x.side ? ["good", "aligned with this signal"] : b === "NEUTRAL" ? ["mid", "no clear HTF bias — lower conviction"] : ["bad", "AGAINST this signal — counter-trend"];
    const state = x.state === "pending" ? `entry pending at ${fmtP(x.entry)}` : x.state === "open" ? `running from ${fmtP(x.entry)}` : x.state === "expired" ? "cancelled" : "closed";
    el.innerHTML = `<b>Bias (${htf}):</b> <span class="${b === "LONG" ? "good" : b === "SHORT" ? "bad" : "dim"}">${b}</span> · <span class="${al[0]}">${al[1]}</span> — structure ${st === 1 ? "bullish" : st === -1 ? "bearish" : "mixed"}, EMA ${an.ema}<br><b>Plan:</b> ${x.side} ${state}, stop ${fmtP(x.sl)}, targets ${sigLv(x.rr).map((m) => fmtP(L ? x.entry + m * Math.abs(x.entry - x.sl) : x.entry - m * Math.abs(x.entry - x.sl))).join(" → ")}${x.be ? ", stop to entry after TP1" : ""}.`;
  }
  function openDetail(x) {
    const box = document.querySelector(".modalbox"); if (box.classList.contains("docked")) { $("modal").appendChild(box); box.classList.remove("docked"); }
    cur = { r: x.r, clicked: x.entry != null ? x : null, tf: $("tf").value, sig: x.sig || null };
    cs = { N: 130, off: 0, mx: null, my: null, drag: null };
    $("mDeriv").innerHTML = ""; $("mMtf").innerHTML = ""; $("mSig").innerHTML = cur.sig ? sigDetail(cur.sig) : "";
    $("modal").classList.remove("hidden"); showDetail();
    if (cur.sig) loadBias(cur.sig, cur);
  }
  async function showDetail() {
    const my = cur, { r, clicked, tf } = my, scanTf = $("tf").value, stale = () => cur !== my || my.tf !== tf;
    $("tfBar").innerHTML = DTF.map((t) => `<button class="${t === tf ? "on" : ""}" data-tf="${t}">${t}</button>`).join("");
    $("tfBar").querySelectorAll("button").forEach((b) => b.onclick = () => { my.tf = b.dataset.tf; cs.N = 130; cs.off = 0; showDetail(); });
    let view, sel = null, an = r.an;
    if (tf === scanTf) { view = { d: r.d, live: r.live }; sel = clicked; }
    else {
      $("mTitle").textContent = `${base(r.sym)}/USDT · ${tf} · loading…`;
      const d = await getKl(r.sym, tf);
      if (stale()) return;
      if (!d) { $("mTitle").textContent = `${base(r.sym)}/USDT · ${tf} · data unavailable`; return; }
      view = { d, live: Lib.liveSetups(d, P) };
      sel = view.live.setups.slice().sort((p, q) => p.age - q.age)[0] || null;
      let oi = null;
      if (OIP.includes(tf)) { const o = await api("/futures/data/openInterestHist", { symbol: r.sym, period: tf, limit: 5 }); if (stale()) return; oi = o ? o.map((x) => +x.sumOpenInterest) : null; }
      an = Lib.analyze(d, oi);
    }
    const bias = view.live.bias;
    $("mTitle").textContent = `${base(r.sym)}/USDT · ${tf} · ${bias === 1 ? "bullish" : bias === -1 ? "bearish" : "no"} structure bias` + (tf !== scanTf ? " · latest setup on this timeframe" : "");
    drawChart(view, sel);
    const fu = fundOf(r.sym);
    $("mInfo").innerHTML = (sel ? card("Setup", `${sel.side} ${sel.status}`, sel.side === "LONG" ? "good" : "bad") + card("Entry / SL / TP", `${fmtP(sel.entry)} / ${fmtP(sel.sl)} / ${fmtP(sel.tp)}`) + card("RR · Risk · Break", `1:${sel.rr} · ${f1(sel.riskPct)}% · ${sel.kind}`) + card("Order age", sel.age + " bars") : card("Setups", view.live.setups.length || "none on this timeframe")) +
      (an ? card(`Trend score (${tf})`, `${an.bull} bull / ${an.bear} bear`) + card("EMA stack", an.ema) + card("ADX · RSI", `${f1(an.adx, 0)} · ${f1(an.rsi, 0)}`) : "") +
      card("RS rating", rsBadge(r.rs) + ` <span class="dim" style="font-size:12px">${r.post}</span>`) + card("vs BTC 7d / 30d / 90d", (r.vsBtc || []).map((x) => x == null ? "-" : `<span class="${cls(x)}" style="font-size:13px">${sgn(x, 0)}%</span>`).join(" · ")) + card("24h", sgn(+r.tk.priceChangePercent) + "%", cls(+r.tk.priceChangePercent)) + card("Funding (8h)", fu == null ? "-" : sgn(fu, 4) + "%");
    const tp = tplOf(r), tn = tp.filter((x) => x[1]).length;
    $("mInfo").innerHTML += `<div class="note tpl" style="grid-column:1/-1"><b>Trend template (${tn}/8)</b><br>${tp.map(([t, g]) => `<span class="${g ? "good" : "bad"}">${g ? "✓" : "✗"} ${t}</span>`).join("")}</div>`;
    loadDeriv(r.sym, my); loadMtf(r, my);
  }
  async function loadDeriv(sym, my) {
    let c = dvCache[sym];
    if (!c || Date.now() - c.t > 60000) {
      const [ls, oi, tp] = await Promise.all([
        api("/futures/data/globalLongShortAccountRatio", { symbol: sym, period: "1h", limit: 25 }),
        api("/futures/data/openInterestHist", { symbol: sym, period: "1h", limit: 25 }),
        api("/futures/data/topLongShortPositionRatio", { symbol: sym, period: "1h", limit: 1 }),
      ]);
      c = dvCache[sym] = { t: Date.now(), ls, oi, tp };
    }
    if (cur !== my) return;
    const { ls, oi, tp } = c, last = ls && ls[ls.length - 1], oiChg = oi && oi.length > 1 ? (+oi[oi.length - 1].sumOpenInterestValue / +oi[0].sumOpenInterestValue - 1) * 100 : NaN;
    $("mDeriv").innerHTML = card("Long/short accounts", last ? `${f1(+last.longShortRatio)} · ${f1(+last.longAccount * 100, 0)}% long` : "-") +
      card("Top traders L/S (positions)", tp && tp[0] ? f1(+tp[0].longShortRatio) : "-") + card("Open interest 24h", `<span class="${cls(oiChg)}">${sgn(oiChg, 1)}%</span>`) +
      card("OI value", oi && oi.length ? "$" + (+oi[oi.length - 1].sumOpenInterestValue / 1e6).toFixed(0) + "M" : "-");
  }
  async function loadMtf(r, my) {
    $("mMtf").innerHTML = '<div class="note">Loading multi-timeframe view…</div>';
    const ds = await Promise.all(MTF.map((t) => getKl(r.sym, t)));
    if (cur !== my) return;
    const line = (t, d) => {
      const an = d && Lib.analyze(d, null); if (!an) return `<tr><td>${t}</td><td colspan="5" class="dim">n/a</td></tr>`;
      const bias = Lib.liveSetups(d, P);
      return `<tr data-tf="${t}" style="cursor:pointer"><td><b>${t}</b></td><td class="${an.ema === "FULL BULL" ? "good" : an.ema === "FULL BEAR" ? "bad" : "dim"}">${an.ema}</td><td>${f1(an.adx, 0)}</td><td>${f1(an.rsi, 0)}</td><td>${an.bull} / ${an.bear}</td><td>${bias.setups.length}</td></tr>`;
    };
    $("mMtf").innerHTML = `<div class="tablewrap"><table class="plain"><tr><th>TF</th><th>EMA stack</th><th>ADX</th><th>RSI</th><th>Score L / S (ex-OI, max 4)</th><th>FVG setups</th></tr>${MTF.map((t, i) => line(t, ds[i])).join("")}</table></div>`;
    $("mMtf").querySelectorAll("tr[data-tf]").forEach((tr) => tr.onclick = () => { my.tf = tr.dataset.tf; cs.N = 130; cs.off = 0; showDetail(); });
  }
  function drawChart(r, sel) {
    const c = r.d.map((x) => x.c);
    ctx = { r, sel, e21: Lib.ema(c, 21), e50: Lib.ema(c, 50), e200: Lib.ema(c, 200), dl: Lib.dayLevels(r.d) };
    paint();
  }
  function paint() {
    if (!ctx) return;
    const { r, sel } = ctx, cv = $("chart"), g = cv.getContext("2d"), W = cv.width, H = cv.height, d = r.d;
    const N = Math.max(20, Math.min(cs.N, d.length)); cs.N = N; cs.off = Math.max(0, Math.min(cs.off, d.length - N));
    const e1 = d.length - cs.off, s0 = e1 - N, v = d.slice(s0, e1), e21 = ctx.e21.slice(s0, e1), e50 = ctx.e50.slice(s0, e1), e200 = ctx.e200.slice(s0, e1);
    const bg = css("--bg", "#0d1117"), grid = css("--line", "#2a313c"), dim = css("--dim", "#8b95a3");
    const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.floor((arr.length - 1) * p)];
    let hi = q(v.map((x) => x.h), 0.99), lo = q(v.map((x) => x.l), 0.01); // ignore extreme spikes when scaling
    if (sel) { hi = Math.max(hi, sel.tp, sel.sl, sel.entry); lo = Math.min(lo, sel.tp, sel.sl, sel.entry); }
    const pad = (hi - lo) * 0.05; hi += pad; lo -= pad;
    const L = 8, R = 78, T = 8, B = 18, cw = (W - L - R) / N, X = (i) => L + (i - s0 + 0.5) * cw, Y = (p) => Math.min(H - B, Math.max(T, T + (hi - p) / (hi - lo) * (H - T - B)));
    ctx.cw = cw;
    g.clearRect(0, 0, W, H); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = grid; g.fillStyle = dim; g.font = "11px sans-serif"; g.textAlign = "left";
    for (let k = 0; k <= 5; k++) { const p = lo + (hi - lo) * k / 5, y = Y(p); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(fmtP(p), W - R + 6, y + 4); }
    const zone = (z, col) => { const x0 = Math.max(L, X(z.t0 - 2)); if (z.t0 - 2 >= e1) return; g.fillStyle = col; const y1 = Y(z.top), y2 = Y(z.bot); g.fillRect(x0, Math.min(y1, y2), W - R - x0, Math.max(Math.abs(y2 - y1), 2)); };
    if (sel) zone(sel, sel.side === "LONG" ? "rgba(46,204,113,.18)" : "rgba(255,90,95,.18)");
    else r.live.setups.forEach((z) => zone(z, z.side === "LONG" ? "rgba(46,204,113,.15)" : "rgba(255,90,95,.15)"));
    const line = (arr, col, lw) => { g.strokeStyle = col; g.lineWidth = lw || 1.2; g.beginPath(); let st = false; arr.forEach((p, i) => { if (isNaN(p)) { st = false; return; } const x = X(s0 + i), y = Y(p); st ? g.lineTo(x, y) : g.moveTo(x, y); st = true; }); g.stroke(); g.lineWidth = 1; };
    line(e21, "#4da3ff"); line(e50, "#f5b942"); line(e200, "#b07cff");
    const pva = ctx.dl.va[ctx.dl.day[e1 - 1] - 1];
    if (pva) [["VAH", pva.vah], ["POC", pva.poc], ["VAL", pva.val]].forEach(([n, p]) => { if (p < lo || p > hi) return; g.strokeStyle = g.fillStyle = "#e08cff"; g.setLineDash(n === "POC" ? [2, 3] : [8, 3]); g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(W - R, Y(p)); g.stroke(); g.setLineDash([]); g.textAlign = "left"; g.fillText(`${n} ${fmtP(p)}`, W - R + 6, Y(p) - 3); });
    v.forEach((k, j) => { const x = X(s0 + j), up = k.c >= k.o; g.strokeStyle = g.fillStyle = up ? "#2ecc71" : "#ff5a5f"; g.beginPath(); g.moveTo(x, Y(k.h)); g.lineTo(x, Y(k.l)); g.stroke(); const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); g.fillRect(x - cw * 0.35, y1, Math.max(cw * 0.7, 1), Math.max(y2 - y1, 1)); });
    line(ctx.dl.vwap.slice(s0, e1).map((p, i) => ctx.dl.day[s0 + i] === ctx.dl.day[s0 + i - 1] || i === 0 ? p : NaN), "#19c3d6", 2.2);
    g.font = "10px sans-serif"; g.textAlign = "center";
    if (N <= 200) r.live.swings.filter((w) => w.i >= s0 && w.i < e1).forEach((w) => { g.fillStyle = dim; g.fillText(w.type === "H" ? "▼" : "▲", X(w.i), w.type === "H" ? Y(w.p) - 4 : Y(w.p) + 12); });
    r.live.breaks.filter((b) => b.i >= s0 && b.i < e1).forEach((b) => { const x0 = X(Math.max(s0, b.i - 12)), x1 = X(b.i), y = Y(b.p); g.strokeStyle = b.dir === 1 ? "#2ecc71" : "#ff5a5f"; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); g.fillStyle = g.strokeStyle; g.fillText(b.kind, (x0 + x1) / 2, y + (b.dir === 1 ? -4 : 11)); });
    if (sel) [["TP", sel.tp, "#2ecc71"], ["Entry", sel.entry, "#4da3ff"], ["SL", sel.sl, "#ff5a5f"]].forEach(([n, p, col]) => { g.strokeStyle = col; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(W - R, Y(p)); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.textAlign = "left"; g.fillText(`${n} ${fmtP(p)}`, W - R + 6, Y(p) - 3); });
    g.fillStyle = dim; g.textAlign = "left"; g.fillText("EMA21 blue · EMA50 yellow · EMA200 purple · cyan = daily VWAP · pink = prev-day VAH/POC/VAL · shaded = FVG zone · ▲▼ swings", L + 4, H - 5);
    if (cs.mx != null && cs.mx >= L && cs.mx <= W - R && cs.my >= T && cs.my <= H - B) {
      const j = Math.min(N - 1, Math.max(0, Math.floor((cs.mx - L) / cw))), k = v[j], x = X(s0 + j), price = hi - (cs.my - T) / (H - T - B) * (hi - lo);
      g.strokeStyle = dim; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, H - B); g.moveTo(L, cs.my); g.lineTo(W - R, cs.my); g.stroke(); g.setLineDash([]);
      g.fillStyle = dim; g.fillRect(W - R, cs.my - 8, R, 16); g.fillStyle = bg; g.textAlign = "left"; g.font = "11px sans-serif"; g.fillText(fmtP(price), W - R + 6, cs.my + 4);
      const tt = `${new Date(k.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}   O ${fmtP(k.o)}  H ${fmtP(k.h)}  L ${fmtP(k.l)}  C ${fmtP(k.c)}  ${sgn((k.c / k.o - 1) * 100)}%`;
      g.fillStyle = grid; g.fillRect(L + 2, T + 2, g.measureText(tt).width + 12, 18); g.fillStyle = css("--txt", "#d7dde5"); g.fillText(tt, L + 8, T + 15);
    }
  }
  (function chartEvents() {
    const cv = $("chart"), pos = (e) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height]; };
    cv.addEventListener("wheel", (e) => { e.preventDefault(); cs.N = Math.round(cs.N * (e.deltaY > 0 ? 1.15 : 1 / 1.15)); paint(); }, { passive: false });
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); cs.drag = { x: pos(e)[0], off: cs.off }; });
    cv.addEventListener("pointermove", (e) => {
      [cs.mx, cs.my] = pos(e);
      if (cs.drag && ctx && ctx.cw) cs.off = cs.drag.off + Math.round((cs.mx - cs.drag.x) / ctx.cw);
      paint();
    });
    cv.addEventListener("pointerup", () => { cs.drag = null; });
    cv.addEventListener("pointerleave", () => { cs.mx = null; cs.drag = null; paint(); });
    cv.addEventListener("dblclick", () => { cs.N = 130; cs.off = 0; paint(); });
  })();

  // ---------- market summary ----------
  function renderMarket() {
    if (!rows.length) { $("mkt").innerHTML = ""; return; }
    const btc = rows.find((r) => r.sym === "BTCUSDT"), up = rows.filter((r) => +r.tk.priceChangePercent > 0).length;
    const tot24 = rows.reduce((a, r) => a + +r.tk.quoteVolume, 0), tot7 = rows.reduce((a, r) => a + (r.vol7 || 0), 0);
    const fb = rows.filter((r) => r.an.ema === "FULL BULL").length, fr = rows.filter((r) => r.an.ema === "FULL BEAR").length;
    const fs = rows.map((r) => fundOf(r.sym)).filter((x) => x != null), af = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null;
    $("mkt").innerHTML = (btc ? card("BTC", `${fmtP(+btc.tk.lastPrice)} <span class="${cls(+btc.tk.priceChangePercent)}" style="font-size:12px">${sgn(+btc.tk.priceChangePercent, 1)}%</span>`) : "") +
      card("Coins up (24h)", `${f1(up / rows.length * 100, 0)}%`, up / rows.length > 0.5 ? "good" : "bad") + card("Volume vs 7d", f1(tot24 / tot7) + "×") +
      card("Full bull / bear stack", `<span class="good">${fb}</span> / <span class="bad">${fr}</span>`) + card("Avg funding (8h)", af == null ? "-" : sgn(af, 4) + "%") +
      card("Fear & Greed", fng && fng.v != null ? `${fng.v} <span class="dim" style="font-size:12px">${esc(fng.c)}</span>` : "-");
  }

  // ---------- alerts ----------
  const ruleText = (u) => `${u.side} · score ≥${u.score}${u.ema ? " · EMA stack" : ""}${u.pb ? " · pullback" : ""}${u.setup ? " · FVG " + u.setup : ""}${u.vol ? " · vol ≥" + u.vol + "×" : ""}${u.adx ? " · ADX ≥" + u.adx : ""}`;
  function matchRule(u, r) {
    const out = [];
    for (const side of ["LONG", "SHORT"]) {
      if (u.side !== "ANY" && u.side !== side) continue;
      const sc = side === "LONG" ? r.an.bull : r.an.bear;
      if (sc < u.score) continue;
      if (u.ema && r.an.ema !== (side === "LONG" ? "FULL BULL" : "FULL BEAR")) continue;
      if (u.pb && r.an.pullback !== side) continue;
      if (u.setup && !r.live.setups.some((s) => s.side === side && (u.setup === "ANY" || s.status === u.setup))) continue;
      if (u.vol && !(volRatio(r) >= u.vol)) continue;
      if (u.adx && !(r.an.adx >= u.adx)) continue;
      out.push(side);
    }
    return out;
  }
  function evalAlerts() {
    const tf = $("tf").value, perm = $("notif").checked && "Notification" in window && Notification.permission === "granted";
    rows.forEach((r) => rules.forEach((u) => matchRule(u, r).forEach((side) => {
      const key = `${u.id}|${r.sym}|${side}|${tf}|${r.d[r.d.length - 1].t}`;
      if (alertKeys.has(key)) return; alertKeys.add(key);
      alertLog.unshift({ ts: Date.now(), sym: r.sym, side, tf, rule: ruleText(u), price: r.an.price });
      if (perm && !firstScan) new Notification(`${base(r.sym)} ${side} · ${tf}`, { body: `Rule: ${ruleText(u)} · price ${fmtP(r.an.price)}` });
    })));
    alertLog = alertLog.slice(0, 100); save("alertLog", alertLog); save("alertKeys", [...alertKeys].slice(-3000));
  }
  function renderAlerts() {
    $("ruleList").innerHTML = rules.length ? rules.map((u) => `<span class="tag">${esc(ruleText(u))}<button data-del="${u.id}" title="Delete">✕</button></span>`).join("") : '<span class="dim">No rules yet.</span>';
    $("ruleList").querySelectorAll("button").forEach((b) => b.onclick = () => { rules = rules.filter((u) => u.id !== +b.dataset.del); save("rules", rules); renderAlerts(); });
    const now = [];
    rows.forEach((r) => rules.forEach((u) => matchRule(u, r).forEach((side) => now.push({ sym: r.sym, r, side, rule: ruleText(u), score: side === "LONG" ? r.an.bull : r.an.bear }))));
    table($("alertTable"), [
      { k: "sym", t: "Symbol", v: (x) => x.sym, f: (x) => symCell(x.sym) }, { k: "side", t: "Side", v: (x) => x.side, f: (x) => pill(x.side) },
      { k: "score", t: "Score", v: (x) => x.score, f: (x) => x.score + "/5" }, { k: "price", t: "Price", v: (x) => x.r.an.price, f: (x) => fmtP(x.r.an.price) },
      { k: "rule", t: "Rule", v: (x) => x.rule, f: (x) => `<span class="dim">${esc(x.rule)}</span>` },
    ], now, (x) => openDetail({ r: x.r }), { k: "score", dir: -1 });
    table($("alertLog"), [
      { k: "ts", t: "Time", v: (x) => x.ts, f: (x) => new Date(x.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
      { k: "sym", t: "Symbol", v: (x) => x.sym, f: (x) => `<b>${esc(base(x.sym))}</b>` }, { k: "side", t: "Side", v: (x) => x.side, f: (x) => pill(x.side) },
      { k: "tf", t: "TF", v: (x) => x.tf }, { k: "price", t: "Price at alert", v: (x) => x.price, f: (x) => fmtP(x.price) },
      { k: "rule", t: "Rule", v: (x) => x.rule, f: (x) => `<span class="dim">${esc(x.rule)}</span>` },
    ], alertLog, (x) => { const r = rows.find((q) => q.sym === x.sym); if (r) openDetail({ r }); }, { k: "ts", dir: -1 });
  }

  // ---------- forward test ----------
  function fwdUpdate() {
    const tf = $("tf").value, bySym = {}; rows.forEach((r) => bySym[r.sym] = r);
    rows.forEach((r) => r.live.setups.filter((s) => s.status === "WAITING").forEach((s) => {
      const id = `${r.sym}|${tf}|${s.side}|${r.d[s.t0].t}`;
      if (fwd.some((e) => e.id === id)) return;
      fwd.push({ id, sym: r.sym, tf, side: s.side, kind: s.kind, entry: s.entry, sl: s.sl, tp: s.tp, inval: s.side === "LONG" ? s.bot : s.top, seenT: r.d[r.d.length - 1].t, age0: s.age, state: "pending" });
    }));
    fwd.forEach((e) => { const r = bySym[e.sym]; if (r && e.tf === tf) Lib.resolveFwd(e, r.d, P); });
    fwd = fwd.slice(-1500); save("fwd", fwd);
  }
  function renderFwd() {
    const done = fwd.filter((e) => e.state === "win" || e.state === "loss"), st = Lib.stats(done.map((e) => ({ r: e.r }))), open = fwd.filter((e) => e.state === "pending" || e.state === "open").length;
    $("fwdCards").innerHTML = card("Logged", fwd.length) + card("Open / waiting", open) + card("Closed", done.length) + card("Expired / cancelled", fwd.filter((e) => e.state === "expired").length) +
      card("Win rate", done.length ? f1(st.win * 100, 0) + "%" : "-") + card("Expectancy (after fee)", done.length ? sgn(st.exp) + " R" : "-", done.length ? cls(st.exp) : "") + (done.length && done.length < 30 ? card("Sample", "too small (<30)", "mid") : "");
    table($("fwdTable"), [
      { k: "t", t: "Seen", v: (e) => e.seenT, f: (e) => new Date(e.seenT).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
      { k: "sym", t: "Symbol", v: (e) => e.sym, f: (e) => `<b>${esc(base(e.sym))}</b>` }, { k: "tf", t: "TF", v: (e) => e.tf }, { k: "side", t: "Side", v: (e) => e.side, f: (e) => pill(e.side) },
      { k: "entry", t: "Entry", v: (e) => e.entry, f: (e) => fmtP(e.entry) }, { k: "state", t: "State", v: (e) => e.state, f: (e) => `<span class="${e.state === "win" ? "good" : e.state === "loss" ? "bad" : "dim"}">${e.state.toUpperCase()}</span>` },
      { k: "r", t: "Result R", v: (e) => e.r, f: (e) => e.r == null ? "-" : `<span class="${cls(e.r)}">${sgn(e.r)}</span>` },
    ], fwd.slice(-60), null, { k: "t", dir: -1 });
  }

  // ---------- export / share / theme ----------
  const TAB_TABLE = { screener: "scrTable", report: "repTable", signals: "sigTable", smc: "smcTable", trend: "trendTable", ema: "emaTable", sector: "sectorTable", alerts: "alertTable", proof: "btTable" };
  const activeTab = () => document.querySelector("#tabs button.on").dataset.tab;
  function exportCsv() {
    const id = TAB_TABLE[activeTab()], s = tblState[id]; if (!s || !s.sorted.length) return;
    const cols = s.cols.filter((c) => c.k !== "fav"), strip = (t) => { const e = document.createElement("div"); e.innerHTML = t; return e.textContent; };
    const cell = (x) => { x = x == null || (typeof x === "number" && isNaN(x)) ? "" : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const csv = [cols.map((c) => cell(strip(c.t))).join(",")].concat(s.sorted.map((r) => cols.map((c) => cell(c.v(r))).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `crypto-flow-radar-${activeTab()}-${$("tf").value}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function syncHash() { try { history.replaceState(null, "", `#tab=${activeTab()}&tf=${$("tf").value}&top=${$("top").value}`); } catch (e) { /* ignore */ } }
  function applyHash() {
    const h = new URLSearchParams(location.hash.slice(1)), tf = h.get("tf"), top = h.get("top"), tab = h.get("tab");
    if (tf && [...$("tf").options].some((o) => o.value === tf)) $("tf").value = tf;
    if (top && [...$("top").options].some((o) => o.value === top)) $("top").value = top;
    if (tab) { const b = document.querySelector(`#tabs button[data-tab="${tab}"]`); if (b) showTab(b); }
  }
  function showTab(b) { document.querySelectorAll("#tabs > button").forEach((x) => x.classList.toggle("on", x === b)); document.querySelectorAll("main > section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab)); syncHash(); if (b.dataset.tab === "screener" && rows.length) ensureDock(); }
  function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("theme", t); if (ctx) paint(); }

  // ---------- notifications ----------
  function notify() {
    if (!$("notif").checked || !("Notification" in window) || Notification.permission !== "granted") { rows.forEach((r) => r.live.setups.forEach((s) => seen.add(r.sym + s.side + s.t0))); return; }
    rows.forEach((r) => r.live.setups.forEach((s) => {
      const key = r.sym + s.side + s.t0 + (s.status === "TRIGGERED" ? "T" : ""); if (seen.has(key)) return; seen.add(key);
      const sc = s.side === "LONG" ? r.an.bull : r.an.bear;
      new Notification(`${base(r.sym)} ${s.side} ${s.status}`, { body: `${s.kind} FVG · entry ${fmtP(s.entry)} · SL ${fmtP(s.sl)} · TP ${fmtP(s.tp)} · trend ${sc}/5` });
    }));
  }

  // ---------- wiring ----------
  function renderAll() { renderMarket(); renderScreener(); renderSignals(); renderReport(); renderSmc(); renderTrend(); renderEma(); renderSector(); renderBt(); renderAlerts(); renderFwd(); }
  function loadSettings() { Object.keys(DEF).forEach((k) => { const el = $("p_" + k); if (el) el.value = P[k]; }); }
  function readSettings() { Object.keys(DEF).forEach((k) => { const el = $("p_" + k); if (el) P[k] = el.tagName === "SELECT" && k === "only" ? el.value : +el.value; }); P.only = $("p_only").value || null; P.trend = +$("p_trend").value; localStorage.setItem("smcP", JSON.stringify(P)); }
  P.only = P.only || null; loadSettings(); $("p_only").value = P.only || "";

  $("refresh").onclick = scan;
  $("applySmc").onclick = () => { readSettings(); if (rows.length) { computeSmc(); renderAll(); } };
  $("resetSmc").onclick = () => { P = Object.assign({}, DEF); P.only = null; localStorage.removeItem("smcP"); loadSettings(); $("p_only").value = ""; if (rows.length) { computeSmc(); renderAll(); } };
  $("runBT").onclick = () => { if (!rows.length) return scan(); computeSmc(); renderBt(); };
  ["f_side", "f_status", "f_dist", "f_trend"].forEach((id) => $(id).onchange = () => rows.length && renderSmc());
  $("f_search").oninput = () => rows.length && renderSmc();
  const acct = ls("acct", { bal: 1000, risk: 1 }); $("s_bal").value = acct.bal; $("s_risk").value = acct.risk;
  ["s_bal", "s_risk"].forEach((id) => $(id).oninput = () => save("acct", { bal: +$("s_bal").value, risk: +$("s_risk").value }));
  $("s_be").checked = localStorage.getItem("be") !== "0"; $("s_be").onchange = () => localStorage.setItem("be", $("s_be").checked ? "1" : "0");
  ["s_min", "s_side"].forEach((id) => $(id).onchange = () => rows.length && renderSignals()); $("s_search").oninput = () => rows.length && renderSignals();
  $("scr_search").oninput = () => rows.length && renderScreener();
  ["r_per", "r_side"].forEach((id) => $(id).onchange = renderReport);
  ["t_min", "t_side"].forEach((id) => $(id).onchange = () => rows.length && renderTrend()); $("t_search").oninput = () => rows.length && renderTrend();
  ["e_mode"].forEach((id) => $(id).onchange = () => rows.length && renderEma()); $("e_adx").oninput = () => rows.length && renderEma(); $("e_search").oninput = () => rows.length && renderEma();
  $("tf").onchange = () => { syncHash(); scan(); }; $("top").onchange = () => { syncHash(); scan(); };
  $("auto").checked = localStorage.getItem("auto") === "1"; if ($("auto").checked) timer = setInterval(scan, 120000);
  $("auto").onchange = () => { clearInterval(timer); localStorage.setItem("auto", $("auto").checked ? "1" : "0"); if ($("auto").checked) timer = setInterval(scan, 120000); };
  $("favOnly").checked = localStorage.getItem("favOnly") === "1";
  $("favOnly").onchange = () => { localStorage.setItem("favOnly", $("favOnly").checked ? "1" : "0"); if (rows.length) renderAll(); };
  $("theme").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  document.documentElement.dataset.theme = localStorage.getItem("theme") === "dark" ? "dark" : "light";
  $("csv").onclick = exportCsv;
  $("share").onclick = async () => { syncHash(); try { await navigator.clipboard.writeText(location.href); $("share").textContent = "✔ Copied"; } catch (e) { $("share").textContent = "Copy from URL bar"; } setTimeout(() => $("share").textContent = "🔗 Link", 1800); };
  $("a_add").onclick = () => { rules.push({ id: Date.now(), side: $("a_side").value, score: +$("a_score").value, ema: +$("a_ema").value, pb: +$("a_pb").value, setup: $("a_setup").value, vol: +$("a_vol").value || 0, adx: +$("a_adx").value || 0 }); save("rules", rules); alertKeys.clear(); renderAlerts(); if (rows.length) { evalAlerts(); renderAlerts(); } };
  $("sigReset").onclick = () => { if (confirm("Clear the signal log?")) { sigLog = []; save("sigLog", sigLog); renderSignals(); } };
  $("fwdReset").onclick = () => { if (confirm("Clear the forward-test log?")) { fwd = []; save("fwd", fwd); renderFwd(); } };
  $("notif").onchange = async () => { if ($("notif").checked) { if (!("Notification" in window)) { alert("Notifications not supported in this browser."); $("notif").checked = false; return; } const p = await Notification.requestPermission(); if (p !== "granted") { alert("Notification permission denied."); $("notif").checked = false; } } };
  $("tabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b); };
  $("closeModal").onclick = () => { $("modal").classList.add("hidden"); cur = null; };
  $("modal").onclick = (e) => { if (e.target === $("modal")) { $("modal").classList.add("hidden"); cur = null; } };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".modalbox").classList.contains("docked")) { $("modal").classList.add("hidden"); cur = null; } });
  applyHash();
  scan();
})();
