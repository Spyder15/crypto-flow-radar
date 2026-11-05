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
    await Promise.all(jobs); R.quant(); renderModal();
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
    return `<div class="lsn qc" data-q="o:${t.id}"><div><b>${esc(t.sym.replace("USDT", ""))}</b> <b class="${t.side === "long" ? "up" : "dn"}">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · ${ago(t.t0)} ago · ${esc(t.why)}</span> <span class="chip" style="float:right">🔍 open full chart</span></div><div>${head}</div>${warn}${bar}${chart(k, t, null, 90)}</div>`;
  };
  const closedCard = (t) => {
    const win = t.pnl > 0, lab = t.reason === "TP" ? "✅ TAKE PROFIT HIT" : t.reason === "SL" ? "❌ STOP LOSS HIT" : "⏱ TIME EXIT";
    return `<div class="lsn qc" data-q="c:${t.id}"><div><b>${esc(t.sym.replace("USDT", ""))}</b> <b class="${t.side === "long" ? "up" : "dn"}">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · closed ${ago(t.t1)} ago</span> <span class="chip" style="float:right">🔍 open full chart</span></div><div class="${win ? "up" : "dn"}" style="font-size:16px;font-weight:700">${lab}: ${win ? "+" : "-"}$${Math.abs(t.pnl).toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r}R)</div>${chart(KC["c" + t.id], t, { px: t.exit, t: t.t1, col: win ? GREEN : RED, lab: t.reason }, 90)}</div>`;
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
      panel("Live trades", "real-time profit / loss on 15m candles, refreshed every 15s · green zone = target, red zone = stop", open, "margin-top:12px") +
      (Q.closed.length ? panel("Latest results", "chart of how each trade ended: SL or TP hit", Q.closed.slice(0, 6).map(closedCard).join(""), "margin-top:12px") : "") +
      panel("Closed trades", "last 30", hist, "margin-top:12px");
  };

  // ---------------- full-screen trade chart ----------------
  let MO = null; // {id, open}
  const hm = (ts, long) => { const d = new Date(ts); return long ? d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const dur = (ms) => { const m = Math.round(ms / 6e4); return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };
  let GEO = null;
  const bigChart = (k, t, ex, live) => {
    if (!k || k.length < 2) return '<div class="st" style="padding:40px;text-align:center">loading candles…</div>';
    const W = 900, H = 430, pr = 76, pw = W - pr, ph = H - 30, dt = k[1].t - k[0].t, step = pw / k.length;
    const lv = [t.entry, t.sl, t.tp, live].filter(isFinite), hi = Math.max(...k.map((c) => c.h), ...lv), lo = Math.min(...k.map((c) => c.l), ...lv), pd = (hi - lo) * 0.07;
    const y = (v) => 6 + ph - (v - lo + pd) / (hi - lo + 2 * pd) * ph, xi = (ts) => (Math.max(k.findIndex((c) => c.t + dt > ts), 0) + 0.5) * step;
    GEO = { k, step, pw, y, lo, hi, pd, ph, t };
    let g = "";
    for (let j = 0; j <= 6; j++) { const v = lo - pd + (hi - lo + 2 * pd) * j / 6; g += `<line x1="0" x2="${pw}" y1="${y(v)}" y2="${y(v)}" stroke="#8a94a6" opacity=".18"/><text x="${pw + 6}" y="${y(v) + 4}" fill="#8a94a6" font-size="11">${fnum(v)}</text>`; }
    const ev = Math.max(1, Math.ceil(k.length / 7)), span = k[k.length - 1].t - k[0].t > 36e5 * 30;
    for (let i = 0; i < k.length; i += ev) g += `<text x="${(i + 0.5) * step}" y="${H - 8}" fill="#8a94a6" font-size="11" text-anchor="middle">${hm(k[i].t, span)}</text>`;
    const zone = (a, b, col) => `<rect x="0" width="${pw}" y="${Math.min(y(a), y(b))}" height="${Math.abs(y(a) - y(b))}" fill="${col}" opacity=".09"/>`;
    const cs = k.map((c, i) => { const x = (i + 0.5) * step, col = c.c >= c.o ? GREEN : RED; return `<line x1="${x}" x2="${x}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}"/><rect x="${x - Math.max(step * 0.34, 0.8)}" width="${Math.max(step * 0.68, 1.6)}" y="${Math.min(y(c.o), y(c.c))}" height="${Math.max(Math.abs(y(c.o) - y(c.c)), 1)}" fill="${col}"/>`; }).join("");
    const tag = (v, col, lab, dash = "6 4") => `<line x1="0" x2="${pw}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="${dash}"/><rect x="${pw}" y="${y(v) - 9}" width="${pr - 2}" height="18" rx="3" fill="${col}"/><text x="${pw + 4}" y="${y(v) + 4}" fill="#fff" font-size="11" font-weight="700">${lab} ${fnum(v)}</text>`;
    let o = zone(t.entry, t.tp, GREEN) + zone(t.entry, t.sl, RED) + g + cs + tag(t.tp, GREEN, "TP") + tag(t.sl, RED, "SL") + tag(t.entry, "#6b7686", "IN", "2 3");
    if (live != null && !ex) o += tag(live, "#e8a317", "NOW", "3 3");
    o += `<line x1="${xi(t.t0)}" x2="${xi(t.t0)}" y1="6" y2="${ph + 6}" stroke="#9aa4b2" stroke-dasharray="2 3"/><text x="${xi(t.t0) > pw - 130 ? xi(t.t0) - 4 : xi(t.t0) + 4}" y="18" text-anchor="${xi(t.t0) > pw - 130 ? "end" : "start"}" fill="#9aa4b2" font-size="11">${t.side === "long" ? "▲ ENTRY LONG" : "▼ ENTRY SHORT"}</text>`;
    if (ex) o += `<circle cx="${xi(ex.t)}" cy="${y(ex.px)}" r="6" fill="${ex.col}" stroke="#fff" stroke-width="2"/><text x="${Math.min(xi(ex.t), pw - 90)}" y="${Math.max(y(ex.px) - 12, 28)}" fill="${ex.col}" font-size="12" font-weight="700">${ex.lab}</text>`;
    o += `<g id="qx" style="display:none;pointer-events:none"><line id="qxv" y1="6" y2="${ph + 6}" stroke="#9aa4b2" stroke-dasharray="3 3"/><line id="qxh" x1="0" x2="${pw}" stroke="#9aa4b2" stroke-dasharray="3 3"/><rect id="qxr" x="${pw}" width="${pr - 2}" height="18" rx="3" fill="#2b3340"/><text id="qxt" x="${pw + 4}" fill="#fff" font-size="11"></text></g>`;
    return `<svg id="qsvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;cursor:crosshair">${o}</svg>`;
  };
  const renderModal = () => {
    const box = $("qmodal-b"); if (!box || !MO || !Q) return;
    let t = Q.open.find((x) => x.id === MO.id), closed = false;
    if (!t) { t = Q.closed.find((x) => x.id === MO.id); closed = true; }
    if (!t) { box.innerHTML = '<div class="st" style="padding:20px">This trade is no longer available.</div>'; return; }
    const k = KC[(closed ? "c" : "o") + t.id], live = !closed && k && k.length ? k[k.length - 1].c : null, dir = t.side === "long" ? 1 : -1, fee = Q.cfg.fee || 0.0011;
    const px_ = closed ? t.exit : live, pnl = px_ == null ? null : closed ? t.pnl : dir * (live - t.entry) * t.qty - t.qty * (t.entry + live) * fee / 2;
    const r = pnl == null ? null : pnl / t.risk, hit = closed ? "" : touched(k, t), win = pnl != null && pnl >= 0;
    const rr = Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl), notional = t.qty * t.entry;
    const lab = closed ? (t.reason === "TP" ? "✅ TAKE PROFIT HIT" : t.reason === "SL" ? "❌ STOP LOSS HIT" : "⏱ TIME EXIT") : win ? "🟢 IN PROFIT" : "🔴 IN LOSS";
    const cell = (a, b, c = "") => `<div class="qk"><span>${a}</span><b class="${c}">${b}</b></div>`;
    box.innerHTML = `<div class="qh"><div><b style="font-size:20px">${esc(t.sym.replace("USDT", ""))}/USDT</b> <b class="${dir > 0 ? "up" : "dn"}" style="font-size:15px">${t.side.toUpperCase()}</b> <span class="st">${NAME[t.strat]} · perp · 15m candles</span> ${closed ? "" : '<span class="qlive">● LIVE</span>'}</div><span data-snap-ignore><span class="chip" data-snap="modal" title="Chart snapshot">📷 Snapshot</span> <button id="qclose" class="chip">✕ Close</button></span></div>` +
      `<div class="qb ${win ? "up" : "dn"}"><span style="font-size:22px;font-weight:800">${lab}</span>${pnl == null ? "" : `<span style="font-size:22px;font-weight:800">${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${r >= 0 ? "+" : ""}${r.toFixed(2)}R · ${sg(pnl / Q.cfg.start * 100)}% of account)</span>`}</div>` +
      (hit ? `<div class="${hit === "TP" ? "up" : "dn"}" style="font-weight:700;margin:6px 0">${hit === "TP" ? "✅ Take profit level was touched" : "❌ Stop loss level was touched"}. The bot books it on its next run (up to 30 min).</div>` : "") +
      `<div id="qro" class="st" style="height:18px;margin:6px 0">hover the chart for candle details</div>${bigChart(k, t, closed ? { px: t.exit, t: t.t1, col: win ? GREEN : RED, lab: t.reason === "TIME" ? "TIME EXIT" : t.reason + " HIT" } : null, live)}` +
      `<div class="qg">${cell("Entry", fnum(t.entry))}${cell("Stop loss", fnum(t.sl), "dn")}${cell("Take profit", fnum(t.tp), "up")}${cell(closed ? "Exit" : "Live price", px_ == null ? "-" : fnum(px_))}${cell("Reward : risk", "1 : " + rr.toFixed(2))}${cell("Risk", "$" + t.risk.toFixed(2) + " (" + (Q.cfg.riskPct) + "%)")}${cell("Size", fnum(t.qty, 4) + " · $" + fnum(notional, 0))}${cell("Leverage", (notional / Q.cfg.start).toFixed(2) + "x of start equity")}${cell("Opened", hm(t.t0, true))}${cell(closed ? "Held" : "Open for", dur((closed ? t.t1 : Date.now()) - t.t0))}${cell("Fees", "$" + (t.qty * (t.entry + (px_ || t.entry)) * fee / 2).toFixed(2))}${cell("Max hold", { mom: "48h", mr: "24h", fund: "24h" }[t.strat])}</div>` +
      `<div class="st" style="margin-top:8px"><b>Why this trade:</b> ${esc(t.why)}</div>`;
  };
  const openModal = (id) => {
    MO = { id };
    let m = $("qmodal");
    if (!m) {
      m = document.createElement("div"); m.id = "qmodal";
      m.innerHTML = '<style>#qmodal{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}#qmodal-b{background:var(--bg,#10141b);color:var(--fg,inherit);border:1px solid var(--line);border-radius:12px;width:min(980px,100%);padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}.qh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.qb{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid currentColor;background:rgba(127,127,127,.08)}.qg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}.qk{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}.qk span{font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.04em}.qlive{color:#2fd27a;font-size:12px;font-weight:700;animation:qp 1.4s infinite}@keyframes qp{50%{opacity:.35}}</style><div id="qmodal-b"></div>';
      document.body.appendChild(m);
      m.addEventListener("click", (e) => { if (e.target === m || e.target.id === "qclose") closeModal(); });
      m.addEventListener("mousemove", (e) => {
        const svg = e.target.closest?.("#qsvg"); if (!svg || !GEO) return;
        const b = svg.getBoundingClientRect(), sx = (e.clientX - b.left) / b.width * 900, sy = (e.clientY - b.top) / b.height * 430, G = GEO;
        const i = Math.min(G.k.length - 1, Math.max(0, Math.floor(sx / G.step))), c = G.k[i], x = (i + 0.5) * G.step;
        if (sx > G.pw) return;
        const v = G.lo - G.pd + (1 - (sy - 6) / G.ph) * (G.hi - G.lo + 2 * G.pd), set = (id, a) => { const el = $(id); for (const n in a) el.setAttribute(n, a[n]); };
        $("qx").style.display = ""; set("qxv", { x1: x, x2: x }); set("qxh", { y1: sy, y2: sy }); set("qxr", { y: sy - 9 }); set("qxt", { y: sy + 4 }); $("qxt").textContent = fnum(v);
        $("qro").innerHTML = `${hm(c.t, true)} · O ${fnum(c.o)} H ${fnum(c.h)} L ${fnum(c.l)} C <span class="${c.c >= c.o ? "up" : "dn"}">${fnum(c.c)} (${((c.c / c.o - 1) * 100).toFixed(2)}%)</span>`;
      });
      m.addEventListener("mouseleave", () => { const x = $("qx"); if (x) x.style.display = "none"; });
    }
    m.style.display = "flex"; document.body.style.overflow = "hidden"; renderModal();
  };
  const closeModal = () => { MO = null; const m = $("qmodal"); if (m) m.style.display = "none"; document.body.style.overflow = ""; };
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
