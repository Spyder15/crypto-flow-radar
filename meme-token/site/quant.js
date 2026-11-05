// Quant tab (results of the paper quant bot) and Learn tab (lessons, calculators, interview-style questions).
(() => {
  const SP = window.SP, X = SP && SP.x; if (!X || !SP.xr) return;
  const { LS, kc, panel, fnum, lazy, jget } = X;
  const R = SP.xr, L = SP.xl;
  const usd = (v) => (v == null || !isFinite(v) ? "-" : (v < 0 ? "-$" : "$") + fnum(Math.abs(v)));
  const sg = (v, d = 2) => (v == null || !isFinite(v) ? "-" : `<span class="${v >= 0 ? "up" : "dn"}">${v >= 0 ? "+" : "-"}${fnum(Math.abs(v), d)}</span>`);
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 6e4)); return m < 60 ? m + "m" : m < 2880 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
  const NAME = { mom: "Momentum", mr: "Mean reversion", fund: "Funding fade" };

  const line = (v, h = 140, c = "var(--acc)") => {
    if (v.length < 2) return '<div class="st" style="padding:10px">curve fills as the bot keeps running</div>';
    const mn = Math.min(...v), r = Math.max(...v) - mn || 1, w = 600;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block"><polyline fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 4 - (y - mn) / r * (h - 8)).toFixed(1)}`).join(" ")}"/></svg>`;
  };


  // ---------------- live candles + trade charts ----------------
  const KC = {}, GREEN = "#2fd27a", RED = "#ff4d4d";
  async function fetchK(sym, iv, st, en) {
    const bb = (r) => r.result.list.slice().reverse().map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
    try {
      const r = await jget(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${iv}&start=${st}${en ? "&end=" + en : ""}&limit=1000`);
      if (r.retCode !== 0) throw 0; return bb(r);
    } catch {
      const r = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv === 60 ? "1h" : iv + "m"}&startTime=${st}${en ? "&endTime=" + en : ""}&limit=1000`);
      return r.map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
    }
  }
  async function loadKs() {
    if (!Q) return;
    const jobs = [];
    for (const t of Q.open) jobs.push(fetchK(t.sym, 15, t.t0 - 6 * 36e5).then((k) => { KC["o" + t.id] = k; }).catch(() => {}));
    for (const t of Q.closed.slice(0, 6)) {
      if (KC["c" + t.id]) continue;
      const iv = t.t1 - t.t0 > 40 * 36e5 ? 60 : 15;
      jobs.push(fetchK(t.sym, iv, t.t0 - 4 * 36e5, t.t1 + 4 * 36e5).then((k) => { KC["c" + t.id] = k; }).catch(() => {}));
    }
    await Promise.all(jobs); R.quant(); if (MO) await loadModalK(); renderModal();
  }
  const chart = (k, t, ex, H = 180) => {
    if (!k || k.length < 2) return '<div class="st" style="padding:10px">chart loading…</div>';
    const W = 600, lv = [t.entry, t.sl, t.tp].filter(isFinite);
    const hi = Math.max(...k.map((c) => c.h), ...lv), lo = Math.min(...k.map((c) => c.l), ...lv), pd = (hi - lo) * 0.06;
    const y = (v) => H - 8 - (v - lo + pd) / (hi - lo + 2 * pd) * (H - 16), bw = W / k.length;
    const xi = (ts) => { const i = k.findIndex((c) => c.t + (k[1].t - k[0].t) > ts); return (Math.max(i, 0) + 0.5) * bw; };
    const ln = (v, col, lab) => isFinite(v) ? `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="5 4" stroke-width="1"/><text x="${W - 4}" y="${y(v) - 3}" text-anchor="end" fill="${col}" font-size="6">${lab} ${fnum(v)}</text>` : "";
    const zone = (a, b, col) => isFinite(b) ? `<rect x="0" width="${W}" y="${Math.min(y(a), y(b))}" height="${Math.abs(y(a) - y(b))}" fill="${col}" opacity=".08"/>` : "";
    const cs = k.map((c, i) => { const x = (i + 0.5) * bw, col = c.c >= c.o ? GREEN : RED; return `<line x1="${x}" x2="${x}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}"/><rect x="${x - Math.max(bw * 0.3, 0.8)}" width="${Math.max(bw * 0.6, 1.6)}" y="${Math.min(y(c.o), y(c.c))}" height="${Math.max(Math.abs(y(c.o) - y(c.c)), 1)}" fill="${col}"/>`; }).join("");
    const ex_ = ex ? `<circle cx="${xi(ex.t)}" cy="${y(ex.px)}" r="5" fill="${ex.col}" stroke="#fff" stroke-width="1.5"/><text x="${Math.min(xi(ex.t), W - 60)}" y="${Math.max(y(ex.px) - 9, 11)}" fill="${ex.col}" font-size="11" font-weight="700">${ex.lab}</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${zone(t.entry, t.tp, GREEN)}${zone(t.entry, t.sl, RED)}${cs}${ln(t.tp, GREEN, "TP")}${ln(t.sl, RED, "SL")}${ln(t.entry, "#9aa4b2", "ENTRY")}<line x1="${xi(t.t0)}" x2="${xi(t.t0)}" y1="0" y2="${H}" stroke="#9aa4b2" stroke-dasharray="2 3"/>${ex_}</svg>`;
  };
  const touched = (k, t) => {
    for (const c of k || []) {
      if (c.t + 9e5 <= t.t0) continue;
      if (t.side === "long" ? c.l <= t.sl : c.h >= t.sl) return "SL";
      if (t.side === "long" ? c.h >= t.tp : c.l <= t.tp) return "TP";
    }
    return "";
  };
  const lvls = (t) => `<div class="st" style="margin-top:4px">Entry ${fnum(t.entry)} · SL ${fnum(t.sl)} · TP ${fnum(t.tp)} · RR 1:${(Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl)).toFixed(1)}</div>`;
  const openCard = (t) => {
    const k = KC["o" + t.id], live = k && k.length ? k[k.length - 1].c : null, dir = t.side === "long" ? 1 : -1;
    const hit = touched(k, t);
    let head = '<span class="st">waiting for live price…</span>', bar = "";
    if (live != null) {
      const pnl = dir * (live - t.entry) * t.qty - t.qty * (t.entry + live) * (Q.cfg.fee || 0.0011) / 2, r = pnl / t.risk;
      const pos = Math.max(0, Math.min(100, (live - t.sl) / (t.tp - t.sl) * 100));
      head = `<span class="${pnl >= 0 ? "up" : "dn"}" style="font-size:18px;font-weight:700">${pnl >= 0 ? "🟢 PROFIT" : "🔴 LOSS"} ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)</span> <span class="st">live ${fnum(live)}</span>`;
      bar = `<div style="position:relative;height:8px;border-radius:4px;background:linear-gradient(90deg,${RED},#555 ${((t.entry - t.sl) / (t.tp - t.sl) * 100).toFixed(1)}%,${GREEN});margin:8px 0 2px"><span style="position:absolute;left:${pos}%;top:-4px;width:4px;height:16px;background:#fff;border:1px solid #000"></span></div><div class="st" style="display:flex;justify-content:space-between"><span>SL ${fnum(t.sl)}</span><span>TP ${fnum(t.tp)}</span></div>`;
    }
    const warn = hit ? `<div class="${hit === "TP" ? "up" : "dn"}" style="font-weight:700;margin:4px 0">${hit === "TP" ? "✅ TAKE PROFIT touched" : "❌ STOP LOSS touched"}, the bot books it at its next run (up to 30 min)</div>` : "";
    return `<div class="lsn qc" data-q="o:${t.id}"><div><b>${esc(t.sym.replace("USDT", ""))}</b> <b class="${t.side === "long" ? "up" : "dn"}">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · ${ago(t.t0)} ago · ${esc(t.why)}</span> <span class="chip" style="float:right">🔍 open full chart</span></div><div>${head}</div>${warn}${bar}${lvls(t)}</div>`;
  };
  const closedCard = (t) => {
    const win = t.pnl > 0, lab = t.reason === "TP" ? "✅ TAKE PROFIT HIT" : t.reason === "SL" ? "❌ STOP LOSS HIT" : t.reason === "TRAIL" ? "🔒 TRAILING STOP HIT" : "⏱ TIME EXIT";
    return `<div class="lsn qc" data-q="c:${t.id}"><div><b>${esc(t.sym.replace("USDT", ""))}</b> <b class="${t.side === "long" ? "up" : "dn"}">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · closed ${ago(t.t1)} ago</span> <span class="chip" style="float:right">🔍 open full chart</span></div><div class="${win ? "up" : "dn"}" style="font-size:16px;font-weight:700">${lab}: ${win ? "+" : "-"}$${Math.abs(t.pnl).toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r}R)</div>${lvls(t)}</div>`;
  };

  // ---------------- Quant (bot results) ----------------
  let Q = null, qErr = "";
  const loadQ = async () => {
    try { const r = await fetch("/quant.json?t=" + Math.floor(Date.now() / 6e4)); if (!r.ok) throw 0; Q = await r.json(); qErr = ""; } catch { qErr = "Quant bot data is not available yet."; }
    R.quant(); loadKs();
  };
  L.quant = () => { lazy("quant", loadQ, 6e4); lazy("quantk", loadKs, 15e3); };
  const stats = (rows) => {
    const n = rows.length, w = rows.filter((t) => t.pnl > 0), l = rows.filter((t) => t.pnl <= 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = -l.reduce((s, t) => s + t.pnl, 0);
    return { n, win: n ? w.length / n * 100 : null, pf: gl ? gw / gl : n && gw ? Infinity : null, exp: n ? rows.reduce((s, t) => s + t.r, 0) / n : null, pnl: gw - gl };
  };
  R.quant = () => {
    const el = $("s-quant");
    if (!Q) { el.innerHTML = panel("Quant bot", "paper trading, fake money", `<div class="st" style="padding:12px">${qErr || "loading…"}</div>`); return; }
    const c = Q.cfg, eq = Q.curve.length ? Q.curve[Q.curve.length - 1][1] : Q.equity, st = stats(Q.closed);
    const dd = (() => { let pk = c.start, m = 0; for (const [, v] of Q.curve) { pk = Math.max(pk, v); m = Math.min(m, (v / pk - 1) * 100); } return m; })();
    const byS = Object.keys(NAME).map((k) => { const s = stats(Q.closed.filter((t) => t.strat === k)); return `<tr><td><b>${NAME[k]}</b></td><td>${s.n}</td><td>${s.win == null ? "-" : s.win.toFixed(0) + "%"}</td><td>${s.pf == null ? "-" : s.pf === Infinity ? "∞" : s.pf.toFixed(2)}</td><td>${s.exp == null ? "-" : sg(s.exp)}R</td><td>${sg(s.pnl)}</td></tr>`; }).join("");
    const open = Q.open.length ? Q.open.map(openCard).join("") : '<div class="st" style="padding:10px">No open trades. The bot waits for a clean setup.</div>';
    const hist = Q.closed.length ? `<div class="tw"><table><thead><tr><th>Coin</th><th>Side</th><th>Strategy</th><th>Entry</th><th>Exit</th><th>Result</th><th>PnL</th><th>R</th><th>Closed</th></tr></thead><tbody>${Q.closed.slice(0, 30).map((t) => `<tr><td><b>${esc(t.sym.replace("USDT", ""))}</b></td><td class="${t.side === "long" ? "up" : "dn"}">${t.side.toUpperCase()}</td><td>${NAME[t.strat]}</td><td>${fnum(t.entry)}</td><td>${fnum(t.exit)}</td><td>${esc(t.reason)}</td><td>${sg(t.pnl)}</td><td>${sg(t.r)}</td><td>${ago(t.t1)} ago</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">No closed trades yet.</div>';
    el.innerHTML = '<style>.lsn{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.qc{cursor:pointer}.qc:hover{border-color:var(--acc)}</style>' + panel("Quant bot", `paper account · ${usd(c.start)} start · risk ${c.riskPct}% per trade · updated ${ago(Q.upd)} ago`,
      `<div class="mk7">${kc("Equity", usd(eq), sg((eq / c.start - 1) * 100) + "% vs start", eq >= c.start ? "up" : "dn")}${kc("Max drawdown", dd.toFixed(2) + "%", "on the equity curve", dd < -5 ? "dn" : "")}${kc("Win rate", st.win == null ? "-" : st.win.toFixed(0) + "%", st.n + " closed trades")}${kc("Profit factor", st.pf == null ? "-" : st.pf === Infinity ? "∞" : st.pf.toFixed(2), "gross win ÷ gross loss")}${kc("Expectancy", st.exp == null ? "-" : st.exp.toFixed(2) + "R", "avg result per trade")}${kc("Status", Q.halted ? "HALTED" : "RUNNING", Q.halted || "open " + Q.open.length + " / " + c.maxOpen, Q.halted ? "dn" : "up")}</div>` +
      `<div class="wh2" style="margin-top:12px">Equity curve</div>${line(Q.curve.map((p) => p[1]))}` +
      '<div class="mlegend">Fake money on Bybit public prices. Fees 0.11% round trip and 0.05% slippage are counted. Stops are checked on 15-minute candles, and if stop and target touch in one candle the stop wins (pessimistic). A few days of results prove nothing, so wait for 50+ trades before trusting any number.</div>') +
      panel("By strategy", "momentum breakout · RSI + Bollinger mean reversion (ranging markets only) · funding fade", `<div class="tw"><table><thead><tr><th>Strategy</th><th>Trades</th><th>Win</th><th>Profit factor</th><th>Expectancy</th><th>PnL</th></tr></thead><tbody>${byS}</tbody></table></div>`, "margin-top:12px") +
      panel("Live trades", "real-time profit / loss, refreshed every 15s · click a trade to open its chart", open, "margin-top:12px") +
      (Q.closed.length ? panel("Latest results", "chart of how each trade ended: SL or TP hit", Q.closed.slice(0, 6).map(closedCard).join(""), "margin-top:12px") : "") +
      panel("Closed trades", "last 30", hist, "margin-top:12px");
  };

  // ---------------- full-screen trade chart (TradingView-style) ----------------
  let MO = null; // {id}
  const hm = (ts, long) => { const d = new Date(ts); return long ? d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const dur = (ms) => { const m = Math.round(ms / 6e4); return m < 60 ? m + "m" : m < 2880 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : Math.floor(m / 1440) + "d " + Math.floor(m % 1440 / 60) + "h"; };
  const TF = { "1m": [6e4, "1", "1m"], "5m": [3e5, "5", "5m"], "15m": [9e5, "15", "15m"], "30m": [18e5, "30", "30m"], "1h": [36e5, "60", "1h"], "4h": [144e5, "240", "4h"], "1D": [864e5, "D", "1d"] };
  const PAD = 8, CW = 900, CH_ = 530;
  const CH = Object.assign({ tf: "15m", type: "c", ma: true }, LS.get("qch", {}), { n: 100, off: 0, fit: true, drag: null });
  const MK = {}; let CX = null, GEO = null;
  const saveCH = () => LS.set("qch", { tf: CH.tf, type: CH.type, ma: CH.ma });

  async function fetchTF(sym, tf, st, en) {
    const [, by, bn] = TF[tf], lim = st ? 1000 : 500;
    try {
      const r = await jget(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${by}${st ? "&start=" + st : ""}${en ? "&end=" + en : ""}&limit=${lim}`);
      if (r.retCode !== 0) throw 0;
      return r.result.list.slice().reverse().map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
    } catch {
      const r = await jget(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${bn}${st ? "&startTime=" + st : ""}${en ? "&endTime=" + en : ""}&limit=${lim}`);
      return r.map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
    }
  }
  const curTrade = () => { if (!MO || !Q) return null; let t = Q.open.find((x) => x.id === MO.id); if (t) return { t, closed: false }; t = Q.closed.find((x) => x.id === MO.id); return t ? { t, closed: true } : null; };
  async function loadModalK() {
    const c = curTrade(); if (!c) return;
    const { t, closed } = c, key = `${t.sym}|${CH.tf}|${closed ? t.id : "live"}`, hit = MK[key], ms = TF[CH.tf][0];
    if (hit && (closed || Date.now() - hit.at < 12e3)) return;
    let st, en;
    if (closed) { en = Math.min(Date.now(), t.t1 + 80 * ms); st = t.t0 - 80 * ms; if ((en - st) / ms > 999) st = en - 999 * ms; }
    try { MK[key] = { k: await fetchTF(t.sym, CH.tf, st, en), at: Date.now() }; } catch { if (!hit) MK[key] = { k: [], at: Date.now() - 6e3 }; }
  }
  const mkKey = (c) => `${c.t.sym}|${CH.tf}|${c.closed ? c.t.id : "live"}`;

  function fitView(k, t, closed) {
    const ms = TF[CH.tf][0], first = Math.max(0, k.findIndex((c) => c.t + ms > t.t0)), last = closed ? Math.max(first, k.findIndex((c) => c.t + ms > t.t1)) : k.length - 1;
    const span = (last < 0 ? k.length - 1 : last) - first + 1;
    CH.n = Math.max(40, Math.min(400, Math.round(span * 1.5 + 24 + PAD)));
    CH.off = closed ? Math.max(0, k.length + PAD - ((last < 0 ? k.length - 1 : last) + 1 + Math.round(CH.n * 0.25))) : 0;
  }
  const niceStep = (raw) => { const m = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / m; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * m; };
  const sma = (k, i, p) => { if (i < p - 1) return null; let s = 0; for (let j = i - p + 1; j <= i; j++) s += k[j].c; return s / p; };
  const fmtAx = (ms, ts, prev) => { const d = new Date(ts); if (ms >= 864e5) return d.toLocaleDateString([], { day: "2-digit", month: "short" }); if (d.getHours() === 0 && d.getMinutes() === 0) return d.toLocaleDateString([], { day: "2-digit", month: "short" }); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); };
  const vfmt = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(0));

  function draw() {
    const host = $("qchart"); if (!host || !CX) return;
    const { t, closed, k, ex } = CX, ms = TF[CH.tf][0];
    if (!k || k.length < 2) { host.innerHTML = `<div class="st" style="padding:60px;text-align:center">${k ? "no candles for this timeframe" : "loading candles…"}</div>`; GEO = null; return; }
    if (CH.fit) { fitView(k, t, closed); CH.fit = false; }
    const pr = 78, pw = CW - pr, ph = 350, vy = ph + 18, vh = 66, n = CH.n;
    CH.off = Math.max(-20, Math.min(k.length + PAD - Math.min(30, k.length), CH.off));
    const end = k.length + PAD - CH.off, start = end - n, i0 = Math.max(0, start), i1 = Math.min(k.length, end) - 1;
    if (i1 < i0) { CH.off = 0; return draw(); }
    const vis = k.slice(i0, i1 + 1), step = pw / n, x = (idx) => (idx - start + 0.5) * step;
    let lo = Math.min(...vis.map((c) => c.l)), hi = Math.max(...vis.map((c) => c.h));
    const span0 = hi - lo || hi * 0.01 || 1, lv = [t.entry, t.sl, t.tp].filter(isFinite);
    for (const v of lv) if (v > lo - span0 * 0.6 && v < hi + span0 * 0.6) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pd = (hi - lo) * 0.07 || 1, plo = lo - pd, phi = hi + pd, y = (v) => 8 + ph - (v - plo) / (phi - plo) * ph, yc = (v) => Math.max(14, Math.min(ph, y(v)));
    const vmax = Math.max(...vis.map((c) => c.v || 0), 1), vyf = (v) => vy + vh - (v / vmax) * vh;
    const up = (c) => c.c >= c.o, last = k[k.length - 1];
    let o = "";
    // grid + price axis
    const gs = niceStep((phi - plo) / 7), dec = gs >= 1 ? (gs % 1 ? 1 : 0) : Math.min(8, Math.ceil(-Math.log10(gs)) + 1);
    for (let v = Math.ceil(plo / gs) * gs; v < phi; v += gs) o += `<line x1="0" x2="${pw}" y1="${y(v)}" y2="${y(v)}" stroke="#8a94a6" opacity=".16"/><text x="${pw + 7}" y="${y(v) + 4}" fill="#8a94a6" font-size="11">${v.toFixed(dec)}</text>`;
    // time axis
    const every = Math.max(1, Math.ceil(n / 8));
    for (let idx = Math.ceil(i0 / every) * every; idx <= i1; idx += every) o += `<line x1="${x(idx)}" x2="${x(idx)}" y1="8" y2="${vy + vh}" stroke="#8a94a6" opacity=".1"/><text x="${x(idx)}" y="${CH_ - 8}" fill="#8a94a6" font-size="11" text-anchor="middle">${fmtAx(ms, k[idx].t)}</text>`;
    // trade zones
    const zone = (a, b, col) => `<rect x="0" width="${pw}" y="${Math.min(yc(a), yc(b))}" height="${Math.abs(yc(a) - yc(b))}" fill="${col}" opacity=".08"/>`;
    o += zone(t.entry, t.tp, GREEN) + zone(t.entry, t.sl, RED);
    // volume
    o += `<text x="6" y="${vy + 11}" fill="#8a94a6" font-size="10">Vol ${vfmt(vis[vis.length - 1].v || 0)}</text>`;
    if (CH.type === "c") o += vis.map((c, j) => { const xx = x(i0 + j), bw = Math.max(step * 0.68, 1.6); return `<line x1="${xx}" x2="${xx}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${up(c) ? GREEN : RED}"/><rect x="${xx - bw / 2}" width="${bw}" y="${Math.min(y(c.o), y(c.c))}" height="${Math.max(Math.abs(y(c.o) - y(c.c)), 1)}" fill="${up(c) ? GREEN : RED}"/>`; }).join("");
    else { const pts = vis.map((c, j) => `${x(i0 + j).toFixed(1)},${y(c.c).toFixed(1)}`).join(" "); o += `<polygon points="${x(i0)},${ph + 8} ${pts} ${x(i1)},${ph + 8}" fill="#2962ff" opacity=".1"/><polyline points="${pts}" fill="none" stroke="#2962ff" stroke-width="2"/>`; }
    o += vis.map((c, j) => { const xx = x(i0 + j), bw = Math.max(step * 0.68, 1.6); return `<rect x="${xx - bw / 2}" width="${bw}" y="${vyf(c.v || 0)}" height="${vy + vh - vyf(c.v || 0)}" fill="${up(c) ? GREEN : RED}" opacity=".45"/>`; }).join("");
    // moving averages
    if (CH.ma) for (const [p, col] of [[20, "#e8a317"], [50, "#2962ff"]]) {
      const pts = []; for (let idx = i0; idx <= i1; idx++) { const m = sma(k, idx, p); if (m != null && y(m) > 0 && y(m) < ph + 10) pts.push(`${x(idx).toFixed(1)},${y(m).toFixed(1)}`); }
      if (pts.length > 1) o += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.3" opacity=".9"/>`;
    }
    // price tags
    const tag = (v, col, lab, dash) => { const out = y(v) < 14 ? "↑ " : y(v) > ph ? "↓ " : "", yy = yc(v); return `<line x1="0" x2="${pw}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="${dash}" opacity=".9"/><rect x="${pw}" y="${yy - 9}" width="${pr - 2}" height="18" rx="3" fill="${col}"/><text x="${pw + 4}" y="${yy + 4}" fill="#fff" font-size="11" font-weight="700">${out}${lab} ${fnum(v)}</text>`; };
    o += tag(t.tp, GREEN, "TP", "6 4") + tag(t.sl, RED, "SL", "6 4") + tag(t.entry, "#6b7686", "IN", "2 3");
    if (!closed) o += tag(last.c, up(last) ? GREEN : RED, "", "1 3");
    // markers
    const ei = k.findIndex((c) => c.t + ms > t.t0);
    if (ei >= i0 && ei <= i1) {
      const xe = x(ei), ye = yc(t.entry), L = t.side === "long";
      o += `<line x1="${xe}" x2="${xe}" y1="8" y2="${vy + vh}" stroke="#9aa4b2" stroke-dasharray="2 3"/><polygon points="${L ? `${xe},${ye + 4} ${xe - 7},${ye + 16} ${xe + 7},${ye + 16}` : `${xe},${ye - 4} ${xe - 7},${ye - 16} ${xe + 7},${ye - 16}`}" fill="${L ? GREEN : RED}" stroke="#fff" stroke-width="1"/><text x="${xe + 10}" y="${L ? ye + 14 : ye - 8}" fill="${L ? GREEN : RED}" font-size="11" font-weight="700">${L ? "LONG" : "SHORT"} ${fnum(t.entry)}</text>`;
    }
    if (ex) {
      const xi = k.findIndex((c) => c.t + ms > ex.t);
      if (xi >= i0 && xi <= i1) o += `<circle cx="${x(xi)}" cy="${yc(ex.px)}" r="6" fill="${ex.col}" stroke="#fff" stroke-width="2"/><text x="${Math.min(x(xi), pw - 90)}" y="${Math.max(yc(ex.px) - 12, 24)}" fill="${ex.col}" font-size="12" font-weight="700">${ex.lab}</text>`;
    }
    o += `<text x="${pw / 2}" y="${ph / 2}" text-anchor="middle" fill="#8a94a6" opacity=".07" font-size="64" font-weight="800">${esc(t.sym.replace("USDT", ""))}</text>`;
    o += `<g id="qx" style="display:none;pointer-events:none"><line id="qxv" y1="8" y2="${vy + vh}" stroke="#9aa4b2" stroke-dasharray="3 3"/><line id="qxh" x1="0" x2="${pw}" stroke="#9aa4b2" stroke-dasharray="3 3"/><rect id="qxr" x="${pw}" width="${pr - 2}" height="18" rx="3" fill="#2b3340"/><text id="qxt" x="${pw + 4}" fill="#fff" font-size="11"></text><rect id="qxb" y="${CH_ - 22}" width="108" height="18" rx="3" fill="#2b3340"/><text id="qxbt" y="${CH_ - 9}" fill="#fff" font-size="11" text-anchor="middle"></text></g>`;
    GEO = { k, step, pw, ph, start, plo, phi, ms, i0, i1, t };
    host.innerHTML = `<svg id="qsvg" viewBox="0 0 ${CW} ${CH_}" style="width:100%;height:auto;display:block;cursor:crosshair;touch-action:none;user-select:none">${o}</svg>`;
  }

  const tfBar = () => `<div class="qtb">${Object.keys(TF).map((k) => `<span class="chip${CH.tf === k ? " on" : ""}" data-qtf="${k}">${k}</span>`).join("")}<span class="qsep"></span><span class="chip${CH.type === "c" ? " on" : ""}" data-ct="c">Candles</span><span class="chip${CH.type === "l" ? " on" : ""}" data-ct="l">Line</span><span class="chip${CH.ma ? " on" : ""}" data-ma="1">MA 20/50</span><span class="chip" data-fit="1">⤢ Fit trade</span><span class="st" style="margin-left:auto">scroll = zoom · drag = move · double-click = fit</span></div>`;

  const renderModal = () => {
    const box = $("qmodal-b"); if (!box || !MO || !Q || CH.drag) return;
    const c = curTrade();
    if (!c) { box.innerHTML = '<div class="st" style="padding:20px">This trade is no longer available.</div>'; return; }
    const { t, closed } = c, k15 = KC[(closed ? "c" : "o") + t.id], mk = MK[mkKey(c)], ck = mk ? mk.k : null;
    const live = !closed ? (ck && ck.length ? ck[ck.length - 1].c : k15 && k15.length ? k15[k15.length - 1].c : null) : null, dir = t.side === "long" ? 1 : -1, fee = Q.cfg.fee || 0.0011;
    const px_ = closed ? t.exit : live, pnl = px_ == null ? null : closed ? t.pnl : dir * (live - t.entry) * t.qty - t.qty * (t.entry + live) * fee / 2;
    const r = pnl == null ? null : pnl / t.risk, hit = closed ? "" : touched(k15, t), win = pnl != null && pnl >= 0;
    const rr = Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl), notional = t.qty * t.entry;
    const lab = closed ? (t.reason === "TP" ? "✅ TAKE PROFIT HIT" : t.reason === "SL" ? "❌ STOP LOSS HIT" : t.reason === "TRAIL" ? "🔒 TRAILING STOP HIT" : "⏱ TIME EXIT") : win ? "🟢 IN PROFIT" : "🔴 IN LOSS";
    const cell = (a, b, cl = "") => `<div class="qk"><span>${a}</span><b class="${cl}">${b}</b></div>`;
    CX = { t, closed, k: ck, ex: closed ? { px: t.exit, t: t.t1, col: win ? GREEN : RED, lab: t.reason === "TIME" ? "TIME EXIT" : t.reason + " HIT" } : null };
    box.innerHTML = `<div class="qh"><div><b style="font-size:20px">${esc(t.sym.replace("USDT", ""))}/USDT</b> <b class="${dir > 0 ? "up" : "dn"}" style="font-size:15px">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · perp · ${CH.tf}</span> ${closed ? "" : '<span class="qlive">● LIVE</span>'}</div><span data-snap-ignore><span class="chip" data-snap="modal" title="Chart snapshot">📷 Snapshot</span> <button id="qclose" class="chip">✕ Close</button></span></div>` +
      `<div class="qb ${win ? "up" : "dn"}"><span style="font-size:22px;font-weight:800">${lab}</span>${pnl == null ? "" : `<span style="font-size:22px;font-weight:800">${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${r >= 0 ? "+" : ""}${r.toFixed(2)}R · ${sg(pnl / Q.cfg.start * 100)}% of account)</span>`}</div>` +
      (hit ? `<div class="${hit === "TP" ? "up" : "dn"}" style="font-weight:700;margin:6px 0">${hit === "TP" ? "✅ Take profit level was touched" : "❌ Stop loss level was touched"}. The bot books it on its next run (up to 30 min).</div>` : "") +
      tfBar() + `<div id="qro" class="st" style="height:18px;margin:4px 0">hover the chart for candle details</div><div id="qchart"></div>` +
      `<div class="qg">${cell("Entry", fnum(t.entry))}${cell("Stop loss", fnum(t.sl), "dn")}${cell("Take profit", fnum(t.tp), "up")}${cell(closed ? "Exit" : "Live price", px_ == null ? "-" : fnum(px_))}${cell("Reward : risk", "1 : " + rr.toFixed(2))}${cell("Risk", "$" + t.risk.toFixed(2) + " (" + (Q.cfg.riskPct) + "%)")}${cell("Size", fnum(t.qty, 4) + " · $" + fnum(notional, 0))}${cell("Leverage", (notional / Q.cfg.start).toFixed(2) + "x of start equity")}${cell("Opened", hm(t.t0, true))}${cell(closed ? "Held" : "Open for", dur((closed ? t.t1 : Date.now()) - t.t0))}${cell("Fees", "$" + (t.qty * (t.entry + (px_ || t.entry)) * fee / 2).toFixed(2))}${cell("Max hold", { mom: "48h", mr: "24h", fund: "24h" }[t.strat])}</div>` +
      `<div class="st" style="margin-top:8px"><b>Why this trade:</b> ${esc(t.why)}</div>`;
    draw();
  };
  const refresh = async () => { await loadModalK(); renderModal(); };

  const hover = (e) => {
    const svg = e.target.closest?.("#qsvg"), G = GEO; if (!svg || !G) return;
    const b = svg.getBoundingClientRect(), sx = (e.clientX - b.left) / b.width * CW, sy = (e.clientY - b.top) / b.height * CH_;
    if (sx > G.pw || sy > G.ph + 8) return;
    const idx = Math.min(G.i1, Math.max(G.i0, Math.floor(sx / G.step) + G.start)), c = G.k[idx], xx = (idx - G.start + 0.5) * G.step;
    const v = G.plo + (1 - (sy - 8) / G.ph) * (G.phi - G.plo), set = (id, a) => { const el = $(id); for (const n in a) el.setAttribute(n, a[n]); };
    $("qx").style.display = ""; set("qxv", { x1: xx, x2: xx }); set("qxh", { y1: sy, y2: sy }); set("qxr", { y: sy - 9 }); set("qxt", { y: sy + 4 }); $("qxt").textContent = fnum(v);
    set("qxb", { x: xx - 54 }); set("qxbt", { x: xx }); $("qxbt").textContent = hm(c.t, true);
    const dir = G.t.side === "long" ? 1 : -1, vs = (c.c / G.t.entry - 1) * 100 * dir;
    $("qro").innerHTML = `${hm(c.t, true)} · O ${fnum(c.o)} H ${fnum(c.h)} L ${fnum(c.l)} C <span class="${c.c >= c.o ? "up" : "dn"}">${fnum(c.c)} (${((c.c / c.o - 1) * 100).toFixed(2)}%)</span> · Vol ${vfmt(c.v || 0)} · vs entry <span class="${vs >= 0 ? "up" : "dn"}">${vs >= 0 ? "+" : ""}${vs.toFixed(2)}%</span>`;
  };
  const openModal = (id) => {
    MO = { id }; CH.fit = true; CH.off = 0; CX = null;
    let m = $("qmodal");
    if (!m) {
      m = document.createElement("div"); m.id = "qmodal";
      m.innerHTML = '<style>#qmodal{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}#qmodal-b{background:var(--panel,#fff);color:var(--txt,inherit);border:1px solid var(--line);border-radius:12px;width:min(1100px,100%);padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}.qh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.qb{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid currentColor;background:rgba(127,127,127,.08)}.qtb{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}.qtb .chip{cursor:pointer}.qsep{width:1px;height:18px;background:var(--line);margin:0 4px}.qg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}.qk{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}.qk span{font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.04em}.qlive{color:#2fd27a;font-size:12px;font-weight:700;animation:qp 1.4s infinite}@keyframes qp{50%{opacity:.35}}</style><div id="qmodal-b"></div>';
      document.body.appendChild(m);
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.id === "qclose") return closeModal();
        const d = e.target.closest("[data-qtf],[data-ct],[data-ma],[data-fit]"); if (!d) return;
        if (d.dataset.qtf) { CH.tf = d.dataset.qtf; CH.fit = true; CH.off = 0; saveCH(); renderModal(); refresh(); return; }
        if (d.dataset.ct) CH.type = d.dataset.ct; else if (d.dataset.ma) CH.ma = !CH.ma; else if (d.dataset.fit) CH.fit = true;
        saveCH(); renderModal();
      });
      m.addEventListener("dblclick", (e) => { if (e.target.closest("#qsvg")) { CH.fit = true; draw(); } });
      m.addEventListener("wheel", (e) => {
        const svg = e.target.closest("#qsvg"), G = GEO; if (!svg || !G) return;
        e.preventDefault();
        const b = svg.getBoundingClientRect(), fx = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width * CW / G.pw)), n0 = CH.n, n1 = Math.max(20, Math.min(600, Math.round(n0 * (e.deltaY > 0 ? 1.15 : 1 / 1.15))));
        const anchor = G.start + fx * n0; CH.n = n1; const newStart = anchor - fx * n1; CH.off = Math.round(G.k.length + PAD - (newStart + n1)); draw();
      }, { passive: false });
      m.addEventListener("pointerdown", (e) => { if (e.target.closest("#qsvg") && e.button === 0) CH.drag = { x: e.clientX, off: CH.off, moved: false }; });
      m.addEventListener("pointermove", (e) => {
        const d = CH.drag;
        if (d && GEO) {
          const svg = $("qsvg"), b = svg.getBoundingClientRect(), dc = Math.round((e.clientX - d.x) / (b.width / CW * GEO.step));
          if (dc !== 0 || d.moved) { d.moved = true; const off = d.off + dc; if (off !== CH.off) { CH.off = off; draw(); } }
          return;
        }
        hover(e);
      });
      const up = () => { CH.drag = null; };
      m.addEventListener("pointerup", up); m.addEventListener("pointercancel", up); document.addEventListener("pointerup", up);
      m.addEventListener("mouseleave", () => { const x = $("qx"); if (x) x.style.display = "none"; });
    }
    m.style.display = "flex"; document.body.style.overflow = "hidden"; renderModal(); refresh();
  };
  const closeModal = () => { MO = null; CH.drag = null; const m = $("qmodal"); if (m) m.style.display = "none"; document.body.style.overflow = ""; };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && MO) closeModal(); });
  SP.snapModal = () => {
    const t = MO && (Q.open.find((x) => x.id === MO.id) || Q.closed.find((x) => x.id === MO.id)), sym = t ? t.sym.replace("USDT", "") : "trade";
    return { target: () => $("qmodal-b"), name: "trade-" + sym.toLowerCase(), link: () => location.origin + "/#trade=" + (MO ? MO.id : ""), text: () => `Spyder Trench quant bot paper trade: ${sym} ${t ? t.side.toUpperCase() : ""}` };
  };
  SP.quantOpen = async (id) => { document.querySelector('#subtabs [data-u="quant"]')?.click(); await loadQ(); await loadKs(); openModal(id); };
  $("s-quant").addEventListener("click", (e) => { const c = e.target.closest("[data-q]"); if (c) openModal(c.dataset.q.slice(2)); });

  // ---------------- Learn ----------------
  const QS = [
    ["Die game", "You are paid the number on one fair die. What is a fair price? Now you may re-roll once. What is a fair price?", "One roll: 3.5. With one re-roll you keep the first roll only if it beats 3.5, so keep 4, 5, 6 and re-roll 1, 2, 3 (worth 3.5): (4+5+6)/6 + 0.5 × 3.5 = 4.25."],
    ["Costly re-rolls", "Same die, but each re-roll costs $1 and you can re-roll forever. Fair price?", "Let V be the value. You keep a roll x only if x ≥ V − 1. Try V = 4: you keep 3, 4, 5, 6 and re-roll 1 and 2 (worth 4 − 1 = 3), so (3+3+3+4+5+6)/6 = 4. V = 4 is consistent."],
    ["Choose 3 of 10", "How many ways can you choose 3 people from 10?", "10 × 9 × 8 / (3 × 2 × 1) = 120."],
    ["Coin flips to HH", "Expected number of fair coin flips until you see two heads in a row?", "6. Let E be the expectation: E = 1/2 (1 + E) + 1/4 (2 + E) + 1/4 × 2 gives E = 6."],
    ["Funding to APR", "A perp pays +0.01% funding every 8 hours. What is that per year, and who pays whom?", "0.01% × 3 per day × 365 ≈ 10.95% a year. Positive funding means longs pay shorts, so crowded longs. A delta-neutral short earns it."],
    ["Kelly", "You win 55% of even-money bets. What fraction of your bankroll does full Kelly bet? Why do people use half?", "f = p − q/b = 0.55 − 0.45 = 10%. Full Kelly has huge swings and assumes you know p exactly. Half Kelly gives about 75% of the growth with far smaller drawdowns, and protects you when your p is overestimated."],
    ["Liquidation", "10x long at 100, ignoring fees and maintenance margin. Where do you get liquidated, and what if the leverage is 20x?", "Your margin is 10% of the position, so a 10% drop wipes it: about 90. At 20x it is 5%, about 95. Real exchanges liquidate a bit earlier because of maintenance margin and fees."],
  ];
  const LS_ = [
    ["Expected value and edge", `Every trade is a bet. EV = p × avg win − (1 − p) × avg loss − costs. A 40% win rate is fine if wins are 3× the losses. Fees and slippage are part of the loss side, so a strategy that loses to costs has no edge at all.`,
      `<div class="ctl"><label>Win %<input id="ev-p" type="number" value="40"></label><label>Avg win $<input id="ev-w" type="number" value="30"></label><label>Avg loss $<input id="ev-l" type="number" value="10"></label><label>Cost per trade $<input id="ev-c" type="number" value="1"></label></div><div class="calcout" id="ev-o"></div>`],
    ["Position sizing and Kelly", `Edge tells you whether to bet; sizing decides whether you survive. Kelly fraction f = p − (1 − p)/b, where b is win ÷ loss size. Real traders use a fraction of it, and 0.5–2% risk per trade is common because your estimate of p is always noisy.`,
      `<div class="ctl"><label>Win %<input id="kl-p" type="number" value="45"></label><label>Win ÷ loss size (b)<input id="kl-b" type="number" value="2" step="0.1"></label></div><div class="calcout" id="kl-o"></div>`],
    ["Risk of ruin and drawdown", `Even with a real edge, a bad streak can empty the account if you size too big. This simulation plays 200 trades 300 times and shows how often you lose half the account and how deep a typical drawdown gets.`,
      `<div class="ctl"><label>Win %<input id="rr-p" type="number" value="45"></label><label>Win ÷ loss (R)<input id="rr-b" type="number" value="2" step="0.1"></label><label>Risk % per trade<input id="rr-r" type="number" value="1" step="0.1"></label></div><div class="calcout" id="rr-o"></div>`],
    ["Funding, carry and basis", `Perpetual futures stay near spot through funding. Positive funding: longs pay shorts every 8 hours. A cash-and-carry trade (long spot, short perp) collects it with no price risk, but you still carry exchange risk, margin risk and fees. High funding for days means the crowd is one-sided and a squeeze is possible. The Funding fade strategy of the Quant bot bets against that.`,
      `<div class="ctl"><label>Funding % per 8h<input id="fn-f" type="number" value="0.03" step="0.005"></label><label>Position $<input id="fn-n" type="number" value="10000"></label></div><div class="calcout" id="fn-o"></div>`],
    ["Liquidation and leverage", `Leverage does not change your edge, it only shrinks the distance to ruin. Distance to liquidation is roughly 100 ÷ leverage percent, minus maintenance margin. If a normal daily move is 4%, 25x leverage is liquidated by noise.`,
      `<div class="ctl"><label>Entry price<input id="lq-e" type="number" value="100"></label><label>Leverage<input id="lq-l" type="number" value="10"></label><label>Maintenance %<input id="lq-m" type="number" value="0.5" step="0.1"></label></div><div class="calcout" id="lq-o"></div>`],
    ["Why backtests lie", `Overfitting (tuning until the past looks great), look-ahead (using a candle's close to decide at its open), survivorship (testing only coins that still exist), and ignoring fees, slippage and funding. Cure: test out-of-sample or walk-forward, count costs, keep rules simple, and forward-test on paper first. That is why this site has a paper bot.`, ""],
    ["Market making in one minute", `A market maker quotes a bid and an ask and earns the spread, but when informed traders hit a quote the maker is left holding the wrong side (adverse selection). Wider spread when uncertain, skew quotes to reduce inventory. An interview classic is "make me a market" on a quantity, where you pick a bid below and an ask above your fair value so that you are happy to trade on either side.`, ""],
  ];
  const done = () => new Set(LS.get("learn", []));
  const lessonHTML = () => {
    const d = done();
    return LS_.map(([t, body, tool], i) => `<details class="lsn"><summary><span class="chip${d.has("l" + i) ? " on" : ""}" data-x="ln-done" data-id="l${i}">${d.has("l" + i) ? "✓ done" : "mark done"}</span> <b>${i + 1}. ${t}</b></summary><p>${body}</p>${tool}</details>`).join("");
  };
  const qHTML = () => {
    const d = done();
    return QS.map(([t, q, a], i) => `<details class="lsn"><summary><span class="chip${d.has("q" + i) ? " on" : ""}" data-x="ln-done" data-id="q${i}">${d.has("q" + i) ? "✓ solved" : "mark solved"}</span> <b>${t}</b></summary><p>${q}</p><details><summary class="st">Show answer</summary><p>${a}</p></details></details>`).join("");
  };
  R.learn = () => {
    const el = $("s-learn");
    if (el.innerHTML) return;
    const d = done(), tot = LS_.length + QS.length;
    el.innerHTML = '<style>.lsn{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.lsn summary{cursor:pointer}.lsn p{margin:8px 0;line-height:1.5}.ctl{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}.ctl label{display:flex;flex-direction:column;font-size:12px;gap:3px}.ctl input{width:110px}.calcout{padding:8px;background:var(--bg2,rgba(127,127,127,.1));border-radius:6px;line-height:1.6}</style>' +
      panel("Quant Academy", "short lessons with calculators you can play with · progress is saved in this browser", `<div class="st" id="ln-prog">${d.size} of ${tot} done</div>${lessonHTML()}`) +
      panel("Interview-style questions", "the kind of puzzles quant firms ask · try first, then open the answer", qHTML(), "margin-top:12px") +
      '<div class="mlegend">Educational only. Nothing here is financial advice, and a simulation is not a promise about the future.</div>';
    calc();
  };
  const v = (id) => parseFloat($(id)?.value);
  const calc = () => {
    const set = (id, h) => { const e = $(id); if (e) e.innerHTML = h; };
    let p = v("ev-p") / 100, w = v("ev-w"), l = v("ev-l"), c = v("ev-c"), ev = p * w - (1 - p) * l - c;
    set("ev-o", `EV per trade: <b>${sg(ev)}$</b> · break-even win rate ${((l + c) / (w + l) * 100).toFixed(1)}% · ${ev > 0 ? "positive edge" : "no edge, you lose slowly"}`);
    p = v("kl-p") / 100; const b = v("kl-b"), k = p - (1 - p) / b;
    set("kl-o", k > 0 ? `Full Kelly: <b>${(k * 100).toFixed(1)}%</b> of bankroll · half Kelly ${(k * 50).toFixed(1)}%` : "Kelly is negative: this bet has no edge, so the right size is 0.");
    p = v("rr-p") / 100; const rb = v("rr-b"), rk = v("rr-r") / 100; let ruin = 0; const fin = [], dds = [];
    for (let i = 0; i < 300; i++) { let e = 1, pk = 1, md = 0, dead = false; for (let j = 0; j < 200; j++) { e *= 1 + (Math.random() < p ? rk * rb : -rk); pk = Math.max(pk, e); md = Math.max(md, 1 - e / pk); if (e < 0.5) dead = true; } if (dead) ruin++; fin.push(e); dds.push(md); }
    fin.sort((x, y) => x - y); dds.sort((x, y) => x - y);
    set("rr-o", `Median result after 200 trades: <b>${((fin[150] - 1) * 100).toFixed(0)}%</b> · worst 10%: ${((fin[30] - 1) * 100).toFixed(0)}% · typical max drawdown ${(dds[150] * 100).toFixed(0)}% · chance of losing half: <b>${(ruin / 3).toFixed(0)}%</b> <span class="st">(random every time)</span>`);
    const f = v("fn-f"), n = v("fn-n");
    set("fn-o", `APR ${(f * 3 * 365).toFixed(1)}% · per day ${usd(n * f * 3 / 100)} · per month ${usd(n * f * 90 / 100)} (before fees, if funding stays the same, which it will not)`);
    const e = v("lq-e"), lv = v("lq-l"), m = v("lq-m") / 100;
    set("lq-o", lv > 0 ? `Long liquidated near <b>${(e * (1 - 1 / lv + m)).toFixed(2)}</b> (${((1 / lv - m) * 100).toFixed(1)}% drop) · short near <b>${(e * (1 + 1 / lv - m)).toFixed(2)}</b>` : "");
  };
  $("s-learn").addEventListener("input", (e) => { if (e.target.tagName === "INPUT") calc(); });
  $("s-learn").addEventListener("click", (e) => {
    const t = e.target.closest("[data-x='ln-done']"); if (!t) return;
    e.preventDefault();
    const d = done(), id = t.dataset.id; d.has(id) ? d.delete(id) : d.add(id); LS.set("learn", [...d]);
    const on = d.has(id); t.classList.toggle("on", on); t.textContent = on ? (id[0] === "l" ? "✓ done" : "✓ solved") : (id[0] === "l" ? "mark done" : "mark solved");
    $("ln-prog").textContent = `${d.size} of ${LS_.length + QS.length} done`;
  });
})();
