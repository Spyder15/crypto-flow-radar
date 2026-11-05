// Meme Quant tab: results of the paper meme bot (state served from /api/mq), live P/L cards, and a trade chart popup.
(() => {
  const SP = window.SP, X = SP && SP.x; if (!X || !SP.xr) return;
  const { LS, kc, panel, fnum, lazy, jget } = X, R = SP.xr, L = SP.xl;
  const NAME = { brk: "Volume breakout", whale: "Whale follow", rec: "Dip reclaim" };
  const usd = (v) => (v == null || !isFinite(v) ? "-" : (v < 0 ? "-$" : "$") + fnum(Math.abs(v)));
  const sgn = (v, d = 2) => `<span class="${v >= 0 ? "up" : "dn"}">${v >= 0 ? "+" : "-"}${fnum(Math.abs(v), d)}</span>`;
  const px = (v) => (v == null || !isFinite(v) || v === 0 ? "-" : v >= 1 ? v.toFixed(v >= 100 ? 2 : 4) : v.toPrecision(4));
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 6e4)); return m < 60 ? m + "m" : m < 2880 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
  const kf = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : Math.round(v)), GREEN = "#2fd27a", RED = "#ff4d4d";
  let M = null, err = "", LV = {};

  const cfg = () => M.cfg || {};
  // paper value of a position if sold now (same fee/slippage assumptions as the bot)
  const worth = (t, p) => t.real + t.units * p * (1 - (cfg().fee || 0.003)) * (1 - (cfg().slipBase || 0.015));
  const livePx = (t) => (LV[t.id] && LV[t.id].px) || t.px || t.entry;
  const openPnl = (t) => worth(t, livePx(t)) - t.size;

  async function loadLive() {
    if (!M || !M.open || !M.open.length) return;
    const addrs = [...new Set(M.open.map((t) => t.addr))];
    for (let i = 0; i < addrs.length; i += 30) {
      try {
        const r = await jget("https://api.dexscreener.com/latest/dex/tokens/" + addrs.slice(i, i + 30).join(","));
        for (const p of r.pairs || []) for (const t of M.open) if (p.pairAddress && p.pairAddress.toLowerCase() === t.pair.toLowerCase() && +p.priceUsd) LV[t.id] = { px: +p.priceUsd, liq: +(p.liquidity && p.liquidity.usd) || 0, at: Date.now() };
      } catch { /* keep last known price */ }
    }
  }
  async function loadM() {
    try { const r = await fetch("/api/mq?t=" + Math.floor(Date.now() / 2e4)); if (!r.ok) throw 0; const j = await r.json(); if (!j.cfg) throw 0; M = j; err = ""; } catch { if (!M) err = "Meme quant bot has not saved data yet. It runs every 5 minutes, check back soon."; }
    R.mq(); await loadLive(); R.mq(); if (MO) { await loadModalK(); renderModal(); }
  }
  L.mq = () => { lazy("mq", loadM, 2e4); };

  const stats = (rows) => {
    const n = rows.length, w = rows.filter((t) => t.pnl > 0), l = rows.filter((t) => t.pnl <= 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = -l.reduce((s, t) => s + t.pnl, 0);
    return { n, win: n ? w.length / n * 100 : null, pf: gl ? gw / gl : n && gw ? Infinity : null, avg: n ? rows.reduce((s, t) => s + t.pct, 0) / n : null, pnl: gw - gl };
  };
  const curve = (v, h = 120) => {
    if (v.length < 2) return '<div class="st" style="padding:10px">curve fills as the bot keeps running</div>';
    const step = Math.ceil(v.length / 240), a = v.filter((_, i) => i % step === 0 || i === v.length - 1), mn = Math.min(...a), r = Math.max(...a) - mn || 1, w = 600;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block"><polyline fill="none" stroke="var(--acc)" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${a.map((y, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 4 - (y - mn) / r * (h - 8)).toFixed(1)}`).join(" ")}"/></svg>`;
  };
  const REASON = { SL: ["❌ STOP LOSS HIT", "dn"], TRAIL: ["✅ TP1 hit, trailing stop closed the rest", "up"], TIME: ["⏱ TIME EXIT", ""], "LIQUIDITY PULLED": ["☠ LIQUIDITY PULLED, bot exited", "dn"], "PAIR GONE": ["☠ PAIR DISAPPEARED (rug?)", "dn"] };

  const openCard = (t) => {
    const p = livePx(t), pnl = openPnl(t), pct = pnl / t.size * 100, lo = Math.min(t.sl0, t.sl), span = t.tp1 - lo;
    const pos = Math.max(0, Math.min(100, (p - lo) / span * 100)), ent = Math.max(0, Math.min(100, (t.entry - lo) / span * 100));
    const warn = p <= t.sl ? '<div class="dn" style="font-weight:700;margin:4px 0">❌ STOP LOSS touched, bot books it on its next run (≤5 min)</div>' : t.tp1Hit ? `<div class="up" style="margin:4px 0;font-weight:600">✅ TP1 hit, half sold, stop moved to ${px(t.sl)} and trailing</div>` : p >= t.tp1 ? '<div class="up" style="font-weight:700;margin:4px 0">✅ TP1 touched, bot sells half on its next run</div>' : "";
    return `<div class="lsn qc" data-mq="o:${t.id}"><div><b>${esc(t.sym)}</b> <span class="tag">${esc(t.net)}</span> <span class="st">${NAME[t.strat]} · ${ago(t.t0)} ago · ${esc(t.why)}</span> <span class="chip" style="float:right">🔍 open chart</span></div>
<div><span class="${pnl >= 0 ? "up" : "dn"}" style="font-size:18px;font-weight:700">${pnl >= 0 ? "🟢 PROFIT" : "🔴 LOSS"} ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)</span> <span class="st">live ${px(p)}${LV[t.id] ? "" : " (bot price)"}</span></div>
<div style="position:relative;height:8px;border-radius:4px;background:linear-gradient(90deg,${RED},#555 ${ent.toFixed(1)}%,${GREEN});margin:8px 0 2px"><span style="position:absolute;left:${pos}%;top:-4px;width:4px;height:16px;background:#fff;border:1px solid #000"></span></div>
<div class="st" style="display:flex;justify-content:space-between"><span>SL ${px(t.sl)}</span><span>entry ${px(t.entry)}</span><span>TP1 ${px(t.tp1)}</span></div>${warn}</div>`;
  };
  const closedCard = (t) => {
    const [lab, cl] = REASON[t.reason] || [t.reason, ""], win = t.pnl > 0;
    return `<div class="lsn qc" data-mq="c:${t.id}"><div><b>${esc(t.sym)}</b> <span class="tag">${esc(t.net)}</span> <span class="st">${NAME[t.strat]} · closed ${ago(t.t1)} ago</span> <span class="chip" style="float:right">🔍 open chart</span></div>
<div class="${win ? "up" : "dn"}" style="font-size:16px;font-weight:700">${win ? "🟢" : "🔴"} ${win ? "+" : "-"}$${Math.abs(t.pnl).toFixed(2)} (${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(1)}%) <span class="${cl}" style="font-size:12px">${lab}</span></div>
<div class="st">entry ${px(t.entry)} → exit ${px(t.exit)} · peak ${px(t.peak)} · held ${ago(t.t0).replace(/m$/, " min")}</div></div>`;
  };

  R.mq = () => {
    const el = $("s-mq");
    if (!M) { el.innerHTML = panel("Meme Quant", "paper trading, fake money", `<div class="st" style="padding:12px">${err || "loading…"}</div>`); return; }
    const c = cfg(), open = M.open || [], closed = M.closed || [], eqLive = M.cash + open.reduce((s, t) => s + t.units * livePx(t), 0), st = stats(closed);
    const dd = (() => { let pk = c.start, m = 0; for (const [, v] of M.curve || []) { pk = Math.max(pk, v); m = Math.min(m, (v / pk - 1) * 100); } return m; })();
    const rows = Object.keys(NAME).map((k) => { const s = stats(closed.filter((t) => t.strat === k)); return `<tr><td><b>${NAME[k]}</b></td><td>${s.n}</td><td>${s.win == null ? "-" : s.win.toFixed(0) + "%"}</td><td>${s.pf == null ? "-" : s.pf === Infinity ? "∞" : s.pf.toFixed(2)}</td><td>${s.avg == null ? "-" : sgn(s.avg) + "%"}</td><td>${usd(s.pnl)}</td></tr>`; }).join("");
    const live = open.length ? open.map(openCard).join("") : '<div class="st" style="padding:10px">No open trades. The bot waits for a clean setup (whale buys, volume breakout or dip reclaim on safe tokens).</div>';
    const hist = closed.length ? `<div class="tw"><table><thead><tr><th>Token</th><th>Strategy</th><th>Entry</th><th>Exit</th><th>Result</th><th>PnL</th><th>%</th><th>Closed</th></tr></thead><tbody>${closed.slice(0, 40).map((t) => `<tr class="qc" data-mq="c:${t.id}" style="cursor:pointer"><td><b>${esc(t.sym)}</b> <span class="tag">${esc(t.net)}</span></td><td>${NAME[t.strat]}</td><td>${px(t.entry)}</td><td>${px(t.exit)}</td><td>${(REASON[t.reason] || [t.reason])[0]}</td><td>${sgn(t.pnl)}</td><td>${sgn(t.pct, 1)}%</td><td>${ago(t.t1)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">No closed trades yet.</div>';
    el.innerHTML = '<style>.lsn{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.qc{cursor:pointer}.qc:hover{border-color:var(--acc)}</style>' +
      panel("Meme Quant", `paper account · ${usd(c.start)} start · ${c.sizePct}% per trade · max ${c.maxOpen} open · bot updated ${ago(M.upd)} ago (every 5 min)`,
        `<div class="mk7">${kc("Equity", usd(eqLive), sgn((eqLive / c.start - 1) * 100) + "% vs start", eqLive >= c.start ? "up" : "dn")}${kc("Max drawdown", dd.toFixed(2) + "%", "on the equity curve", dd < -5 ? "dn" : "")}${kc("Win rate", st.win == null ? "-" : st.win.toFixed(0) + "%", st.n + " closed trades")}${kc("Profit factor", st.pf == null ? "-" : st.pf === Infinity ? "∞" : st.pf.toFixed(2), "gross win ÷ gross loss")}${kc("Avg trade", st.avg == null ? "-" : (st.avg >= 0 ? "+" : "") + st.avg.toFixed(1) + "%", "per closed trade")}${kc("Open", open.length + " / " + c.maxOpen, "cash " + usd(M.cash))}</div>
<div class="st" style="margin:12px 0 2px">Equity curve</div>${curve((M.curve || []).map((x) => x[1]))}
<div class="mlegend" style="margin-top:8px">⚠ Fake money. Meme coins can rug, gap down or become impossible to sell. The bot models ~1.5% slippage + 0.3% fee per side and only buys tokens that pass a GoPlus safety check, but real fills are worse. Wait for 50+ trades before believing any number here.</div>`) +
      panel("By strategy", "needs 20+ trades per strategy to mean anything", `<div class="tw"><table><thead><tr><th>Strategy</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Avg %</th><th>PnL</th></tr></thead><tbody>${rows}</tbody></table></div>`) +
      panel("Live trades", "live P/L from DexScreener · click a card for the full chart", live) +
      panel("Latest results", "SL / TP / trail outcome of the last trades", closed.length ? closed.slice(0, 6).map(closedCard).join("") : '<div class="st" style="padding:10px">No closed trades yet.</div>') +
      panel("Closed trades", "last 40", hist) +
      panel("How the bot decides", "", `<div class="st" style="line-height:1.7"><b>Universe:</b> trending tokens from the whale feed + DexScreener boosts on Solana, Ethereum, Base, BSC, Arbitrum, Polygon, Avalanche. Liquidity ≥ $25k, 1h volume ≥ $15k, age ≥ 30 min.<br><b>Whale follow:</b> 2+ whale wallets bought ≥ $3k (or one ≥ $8k) in the last hour and price is not falling.<br><b>Volume breakout:</b> 5m volume running ≥ 1.5× the hourly pace, buyers beating sellers, price up 5%+ in 1h but not already a spike.<br><b>Dip reclaim:</b> strong 24h token pulled back 12-40% in 1h and buyers are back.<br><b>Exits:</b> stop-loss 12-15%, half sold at +25-30% then stop to breakeven and a trailing stop, liquidity-pull exit, and a 6-12h time stop.<br><b>Risk:</b> ${c.sizePct}% of equity per trade (capped at ${c.maxLiqPct}% of pool liquidity), ${c.dailyStopPct}% daily loss stop, 12h cooldown per token.</div>`);
  };

  // ---------------- chart popup ----------------
  const TF = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4] };
  let MO = null, CH = Object.assign({ tf: "5m", n: 100 }, LS.get("mqch", {})), MK = {};
  if (!TF[CH.tf]) CH.tf = "5m";
  const find = (id) => M && ((M.open || []).find((t) => t.id === id) || (M.closed || []).find((t) => t.id === id));
  const ctx = () => { const t = MO && find(MO.id); return t ? { t, closed: !!(M.closed || []).find((x) => x.id === t.id) } : null; };
  const secOf = () => { const [u, a] = TF[CH.tf]; return a * (u === "hour" ? 3600 : 60); };

  async function loadModalK() {
    const c = ctx(); if (!c) return;
    const { t, closed } = c, key = `${t.id}|${CH.tf}`, hit = MK[key];
    if (hit && (closed || Date.now() - hit.at < 15e3) && hit.k.length) return;
    const [u, a] = TF[CH.tf], pool = t.net === "solana" ? t.pair : t.pair.toLowerCase();
    const before = closed ? `&before_timestamp=${Math.floor(t.t1 / 1000) + 60 * secOf()}` : "";
    try {
      const r = await jget(`https://api.geckoterminal.com/api/v2/networks/${t.net}/pools/${pool}/ohlcv/${u}?aggregate=${a}&limit=300&currency=usd${before}`);
      const k = ((r.data && r.data.attributes && r.data.attributes.ohlcv_list) || []).map((x) => ({ t: x[0] * 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })).reverse();
      MK[key] = { k, at: Date.now() };
    } catch { if (!hit) MK[key] = { k: [], at: Date.now() - 1e4 }; }
  }

  const nice = (lo, hi, n) => {
    const raw = (hi - lo) / n, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e, s = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e, o = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) o.push(v);
    return o;
  };
  let VIEW = null;
  function draw() {
    const c = ctx(), box = $("mqchart"); if (!c || !box) return;
    const { t, closed } = c, hit = MK[`${t.id}|${CH.tf}`], k = hit ? hit.k : [];
    if (!k.length) { box.innerHTML = `<div class="st" style="padding:30px;text-align:center">${hit ? "No candle data for this timeframe yet (new pools may not have it). Try 5m or 15m." : "loading chart…"}</div>`; VIEW = null; return; }
    const sec = secOf() * 1000, anchor = closed ? Math.max(0, k.findIndex((x) => x.t + sec > t.t1)) : k.length - 1;
    const end = Math.min(k.length, (anchor < 0 ? k.length : anchor) + 1 + Math.round(CH.n * 0.2)), i1 = end, i0 = Math.max(0, i1 - CH.n), v = k.slice(i0, i1);
    const lv = [t.entry, t.sl, t.tp1, closed ? t.exit : livePx(t)].filter((x) => isFinite(x) && x > 0);
    let hi = Math.max(...v.map((x) => x.h), ...lv), lo = Math.min(...v.map((x) => x.l), ...lv); const pd = (hi - lo) * 0.06; hi += pd; lo -= pd;
    const W = 900, PH = 330, VT = 345, VH = 70, AX = 440, RP = 70, plotW = W - RP, bw = plotW / (v.length + 2);
    const y = (p) => 8 + (hi - p) / (hi - lo) * (PH - 8), xi = (i) => (i + 0.5) * bw + 4;
    const vmax = Math.max(...v.map((x) => x.v)) || 1;
    const xt = (ts) => { const i = v.findIndex((x) => x.t + sec > ts); return i < 0 ? (ts < v[0].t ? 0 : v.length - 1) : i; };
    let g = nice(lo, hi, 6).map((p) => `<line x1="0" x2="${plotW}" y1="${y(p)}" y2="${y(p)}" stroke="var(--line)" stroke-width="1" opacity=".7"/><text x="${plotW + 6}" y="${y(p) + 4}" fill="var(--mut)" font-size="11">${px(p)}</text>`).join("");
    const tl = Math.max(1, Math.floor(v.length / 6));
    for (let i = 0; i < v.length; i += tl) { const d = new Date(v[i].t); g += `<line x1="${xi(i)}" x2="${xi(i)}" y1="0" y2="${VT + VH}" stroke="var(--line)" opacity=".4"/><text x="${xi(i)}" y="${AX}" text-anchor="middle" fill="var(--mut)" font-size="11">${CH.tf === "4h" || CH.tf === "1h" ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>`; }
    const zone = (a, b, col) => `<rect x="0" width="${plotW}" y="${Math.min(y(a), y(b))}" height="${Math.abs(y(a) - y(b))}" fill="${col}" opacity=".07"/>`;
    const tag = (p, col, lab) => `<line x1="0" x2="${plotW}" y1="${y(p)}" y2="${y(p)}" stroke="${col}" stroke-dasharray="5 4"/><rect x="${plotW}" y="${y(p) - 9}" width="${RP}" height="18" rx="3" fill="${col}"/><text x="${plotW + 4}" y="${y(p) + 4}" fill="#fff" font-size="10.5" font-weight="700">${lab} ${px(p)}</text>`;
    const cs = v.map((x, i) => { const col = x.c >= x.o ? GREEN : RED, cx = xi(i), bh = Math.max(Math.abs(y(x.o) - y(x.c)), 1), vh = x.v / vmax * VH;
      return `<line x1="${cx}" x2="${cx}" y1="${y(x.h)}" y2="${y(x.l)}" stroke="${col}"/><rect x="${cx - Math.max(bw * .32, 1)}" width="${Math.max(bw * .64, 2)}" y="${Math.min(y(x.o), y(x.c))}" height="${bh}" fill="${col}"/><rect x="${cx - Math.max(bw * .32, 1)}" width="${Math.max(bw * .64, 2)}" y="${VT + VH - vh}" height="${vh}" fill="${col}" opacity=".35"/>`; }).join("");
    const ent = xt(t.t0), entM = t.t0 < v[0].t ? "" : `<path d="M${xi(ent)} ${y(t.entry) + 4} l-6 12 l12 0z" fill="#3b82f6"/><text x="${Math.min(xi(ent) + 10, plotW - 70)}" y="${y(t.entry) + 18}" fill="#3b82f6" font-size="11" font-weight="700">BUY ${px(t.entry)}</text>`;
    const exM = closed ? `<circle cx="${xi(xt(t.t1))}" cy="${y(t.exit)}" r="5.5" fill="${t.pnl > 0 ? GREEN : RED}" stroke="#fff" stroke-width="1.5"/><text x="${Math.min(xi(xt(t.t1)) + 9, plotW - 90)}" y="${Math.max(y(t.exit) - 9, 12)}" fill="${t.pnl > 0 ? GREEN : RED}" font-size="11" font-weight="700">${esc((REASON[t.reason] || [t.reason])[0].replace(/^\S+\s/, "")).slice(0, 26)}</text>` : "";
    const last = closed ? "" : tag(livePx(t), "#64748b", "LIVE");
    VIEW = { v, bw, plotW, W, xi };
    box.innerHTML = `<svg id="mqsvg" viewBox="0 0 ${W} 455" style="width:100%;height:auto;display:block;touch-action:none;user-select:none"><text x="${plotW / 2}" y="${PH / 2 + 30}" text-anchor="middle" fill="var(--txt)" opacity=".05" font-size="90" font-weight="800">${esc(t.sym).slice(0, 8)}</text>${g}${zone(t.entry, t.tp1, GREEN)}${zone(t.entry, Math.min(t.sl0, t.sl), RED)}${cs}${tag(t.tp1, GREEN, "TP1")}${tag(Math.min(t.sl0, t.sl), RED, "SL")}${t.tp1Hit && t.sl > t.sl0 ? tag(t.sl, "#f59a23", "TRAIL") : ""}${tag(t.entry, "#3b82f6", "IN")}${last}${entM}${exM}<line id="mqx" x1="0" x2="0" y1="0" y2="${VT + VH}" stroke="var(--mut)" stroke-dasharray="3 3" opacity="0"/></svg>`;
  }
  const readout = (x, ent) => `${new Date(x.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · O ${px(x.o)} H ${px(x.h)} L ${px(x.l)} C ${px(x.c)} (${((x.c / x.o - 1) * 100).toFixed(2)}%) · Vol $${kf(x.v)} · vs entry ${((x.c / ent - 1) * 100).toFixed(1)}%`;

  function renderModal() {
    const m = $("mqmodal-b"); if (!m) return;
    const c = ctx(); if (!c) { m.innerHTML = '<div class="st" style="padding:20px">Trade not found.</div>'; return; }
    const { t, closed } = c, p = closed ? t.exit : livePx(t), pnl = closed ? t.pnl : openPnl(t), pct = pnl / t.size * 100, win = pnl >= 0, tf = Object.keys(TF);
    const keep = $("mqchart") && $("mqchart").innerHTML;
    m.innerHTML = `<div class="qh"><div><b style="font-size:20px">${esc(t.sym)}</b> <span class="tag">${esc(t.net)}</span> <b class="up" style="font-size:15px">LONG</b> <span class="st">${NAME[t.strat]} · ${CH.tf}</span> ${closed ? "" : '<span class="qlive">● LIVE</span>'}</div><span data-snap-ignore><span class="chip" data-snap="modal">📷 Snapshot</span> <a class="chip" href="${esc(t.url || "#")}" target="_blank" rel="noopener">DexScreener ↗</a> <button id="mqclose" class="chip">✕ Close</button></span></div>
<div class="qb ${win ? "up" : "dn"}"><b style="font-size:22px">${win ? "🟢 IN PROFIT" : "🔴 IN LOSS"}${closed ? " (closed)" : ""}</b><b style="font-size:20px">${win ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)</b></div>
${closed ? `<div class="${t.pnl > 0 ? "up" : "dn"}" style="margin-top:8px;font-weight:700">${(REASON[t.reason] || [t.reason])[0]} · exit ${px(t.exit)}</div>` : ""}
<div class="qtb">${tf.map((k) => `<span class="chip${CH.tf === k ? " on" : ""}" data-mtf="${k}">${k}</span>`).join("")}<span class="qsep"></span><span class="chip" data-mz="-">− zoom</span><span class="chip" data-mz="+">+ zoom</span><span class="st" id="mqro" style="margin-left:auto">hover the chart for candle details</span></div>
<div id="mqchart" style="margin-top:6px">${keep || ""}</div>
<div class="qg"><div class="qk"><span>Entry</span><b>${px(t.entry)}</b></div><div class="qk"><span>Stop loss</span><b class="dn">${px(t.sl0)}</b></div><div class="qk"><span>TP1 (sell half)</span><b class="up">${px(t.tp1)}</b></div><div class="qk"><span>${closed ? "Exit" : "Live price"}</span><b>${px(p)}</b></div><div class="qk"><span>Position</span><b>${usd(t.size)}</b></div><div class="qk"><span>Liquidity</span><b>$${kf(t.liq0)} → $${kf(closed ? t.liq : (LV[t.id] && LV[t.id].liq) || t.liq)}</b></div><div class="qk"><span>Opened</span><b>${new Date(t.t0).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b></div><div class="qk"><span>${closed ? "Held" : "Open for"}</span><b>${ago(t.t0).replace(/m$/, " min")}</b></div></div>
<div class="st" style="margin-top:8px"><b>Why this trade:</b> ${esc(t.why)} · <span style="word-break:break-all">${esc(t.addr)}</span></div>`;
    draw();
  }
  async function refresh() { await loadModalK(); renderModal(); }
  function openModal(id) {
    MO = { id };
    let m = $("mqmodal");
    if (!m) {
      m = document.createElement("div"); m.id = "mqmodal";
      m.innerHTML = '<style>#mqmodal{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 10px}#mqmodal-b{background:var(--panel,#fff);color:var(--txt,inherit);border:1px solid var(--line);border-radius:12px;width:min(1000px,100%);padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}#mqmodal .qh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}#mqmodal .qb{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 14px;border-radius:8px;border:1px solid currentColor;background:rgba(127,127,127,.08)}#mqmodal .qtb{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}.qsep{width:1px;height:18px;background:var(--line);margin:0 4px}#mqmodal .qg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}#mqmodal .qk{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}#mqmodal .qk span{font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.04em}.qlive{color:#2fd27a;font-size:12px;font-weight:700;animation:qp 1.4s infinite}@keyframes qp{50%{opacity:.35}}</style><div id="mqmodal-b"></div>';
      document.body.appendChild(m);
      m.addEventListener("mousedown", (e) => { if (e.target === m) closeModal(); });
      m.addEventListener("click", (e) => {
        if (e.target.closest("#mqclose")) return closeModal();
        const f = e.target.closest("[data-mtf]"); if (f) { CH.tf = f.dataset.mtf; LS.set("mqch", { tf: CH.tf, n: CH.n }); renderModal(); refresh(); return; }
        const z = e.target.closest("[data-mz]"); if (z) { CH.n = Math.max(30, Math.min(300, Math.round(CH.n * (z.dataset.mz === "+" ? 0.7 : 1.4)))); LS.set("mqch", { tf: CH.tf, n: CH.n }); draw(); }
      });
      m.addEventListener("wheel", (e) => { if (!e.target.closest("#mqsvg")) return; e.preventDefault(); CH.n = Math.max(30, Math.min(300, Math.round(CH.n * (e.deltaY < 0 ? 0.85 : 1.18)))); draw(); }, { passive: false });
      m.addEventListener("mousemove", (e) => {
        const s = e.target.closest("#mqsvg"); if (!s || !VIEW) return;
        const r = s.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * VIEW.W, i = Math.max(0, Math.min(VIEW.v.length - 1, Math.floor((x - 4) / VIEW.bw))), cx = $("mqx"), c = ctx();
        if (x > VIEW.plotW) { cx.setAttribute("opacity", 0); return; }
        cx.setAttribute("x1", VIEW.xi(i)); cx.setAttribute("x2", VIEW.xi(i)); cx.setAttribute("opacity", 1);
        if (c) $("mqro").textContent = readout(VIEW.v[i], c.t.entry);
      });
    }
    renderModal(); refresh();
  }
  function closeModal() { MO = null; const m = $("mqmodal"); if (m) m.remove(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && MO) closeModal(); });
  setInterval(() => { if (MO && ctx() && !ctx().closed) { loadLive().then(() => refresh()); } }, 15e3);

  const prevSnap = SP.snapModal;
  SP.snapModal = () => {
    if (!$("mqmodal-b")) return prevSnap ? prevSnap() : null;
    const c = ctx(), sym = c ? c.t.sym : "trade";
    return { target: () => $("mqmodal-b"), name: "meme-" + sym.toLowerCase(), link: () => location.origin + "/#tab=mq", text: () => `Spyder Trench meme quant bot paper trade: ${sym}` };
  };
  $("s-mq").addEventListener("click", (e) => { const c = e.target.closest("[data-mq]"); if (c) openModal(c.dataset.mq.slice(2)); });
})();
