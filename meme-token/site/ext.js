// Extra Market Flow tools: coin page, OI/funding history, liquidation history, risk + PnL calculators, paper trading,
// pinned tabs, CSV export, Hinglish labels and indicator (RSI / SMA) values for alert rules.
(() => {
  const SP = window.SP, X = SP && SP.x; if (!X) return;
  const { LS, hlPost, jget, fire, HL, HW, RL, IND, LQ, LQS, DV, pxOf, fnum, inpS, kc, panel, ps, lazy } = X;
  const { M, big, px } = SP;
  const FA = "https://fapi.binance.com", BUCKET = 3e5;
  const R = (SP.xr = {}), L = (SP.xl = {});
  const now = () => Date.now(), num = (id) => parseFloat($(id)?.value);
  const rowOf = (s) => HL.rows.find((r) => r.s === s && !r.dex);
  const usd = (v) => (v == null || !isFinite(v) ? "-" : (v < 0 ? "-$" : "$") + fnum(Math.abs(v)));
  const sgn = (v, d = 2) => (v == null || !isFinite(v) ? "-" : `<span class="${v >= 0 ? "up" : "dn"}">${v >= 0 ? "+" : "-"}${fnum(Math.abs(v), d)}</span>`);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const GREEN = "#2fd27a", RED = "#ff4d4d";

  const svgLine = (v, h = 110, c = "var(--acc)") => {
    v = v.filter(isFinite); if (v.length < 2) return '<div class="st" style="padding:10px">no data for this coin</div>';
    const mn = Math.min(...v), r = Math.max(...v) - mn || 1, w = 600;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block"><polyline fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 4 - (y - mn) / r * (h - 8)).toFixed(1)}`).join(" ")}"/></svg>`;
  };
  const svgBars = (v, h = 90) => {
    v = v.filter(isFinite); if (!v.length) return '<div class="st" style="padding:10px">no data for this coin</div>';
    const w = 600, mx = Math.max(0, ...v), mn = Math.min(0, ...v), r = mx - mn || 1, z = (mx / r) * h, bw = w / v.length;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block"><line x1="0" x2="${w}" y1="${z}" y2="${z}" stroke="var(--line)"/>${v.map((y, i) => { const hh = Math.abs(y) / r * h; return `<rect x="${(i * bw).toFixed(1)}" y="${(y >= 0 ? z - hh : z).toFixed(1)}" width="${Math.max(bw - 0.4, 0.5).toFixed(1)}" height="${Math.max(hh, 0.4).toFixed(1)}" fill="${y >= 0 ? GREEN : RED}"/>`; }).join("")}</svg>`;
  };
  const chg = (a) => (a.length > 1 && a[0] ? (a[a.length - 1] / a[0] - 1) * 100 : null);

  // ---------- history loader (price, funding, open interest) shared by Coin + History ----------
  const HC = {};
  async function loadHist(sym, days) {
    const key = sym + "|" + days, c = HC[key]; if (c && now() - c.at < 12e4) return c;
    const o = c || (HC[key] = { at: 0, k: [], f: [], oi: [] }); o.at = now();
    const hrs = days * 24, st = now() - hrs * 36e5;
    const [k, f, oi] = await Promise.allSettled([hlPost({ type: "candleSnapshot", req: { coin: sym, interval: "1h", startTime: st } }), hlPost({ type: "fundingHistory", coin: sym, startTime: st }), jget(`${FA}/futures/data/openInterestHist?symbol=${sym}USDT&period=1h&limit=${Math.min(500, hrs)}`)]);
    if (k.status === "fulfilled") o.k = k.value.map((x) => +x.c);
    if (f.status === "fulfilled") o.f = f.value.map((x) => +x.fundingRate * 24 * 365 * 100);
    if (oi.status === "fulfilled") o.oi = oi.value.map((x) => +x.sumOpenInterestValue);
    return o;
  }
  const redraw = (id) => { if (document.body.dataset.v === "mkt" && !$("s-" + id).hidden) R[id](); };
  const symBar = (id, st, extra = "") => `<div class="bar"><input id="${id}q" value="${esc(st.sym)}" style="${inpS};width:110px" placeholder="BTC" autocomplete="off" spellcheck="false"><span class="chip on" data-x="${id}-go">Search</span>${extra}</div>`;
  const cleanSym = (v) => String(v || "").trim().toUpperCase().replace(/USDT$|-PERP$/, "").slice(0, 12);
  function onSym(id, st, load) {
    $("s-" + id).addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === id + "q") { const s = cleanSym(e.target.value); if (s) { st.sym = s; LS.set(id + "Sym", s); e.target.blur(); load(); R[id](); } } });
    $("s-" + id).addEventListener("click", (e) => { if (e.target.dataset?.x === id + "-go") { const s = cleanSym($(id + "q").value); if (s) { st.sym = s; LS.set(id + "Sym", s); load(); R[id](); } } });
  }

  // ---------- COIN page ----------
  const C = { sym: LS.get("coinSym", "BTC") };
  const loadCoin = () => loadHist(C.sym, 7).then(() => redraw("coin")).catch(() => {});
  L.coin = () => { lazy("coin" + C.sym, loadCoin, 3e4); lazy("snap", () => X.getSnap().then(X.getWhalePos), 6e5); lazy("wpos", X.getWhalePos, 6e4); };
  R.coin = () => {
    if (document.activeElement?.id === "coinq") return;
    const s = C.sym, r = rowOf(s), p = pxOf(s), h = HC[s + "|7"] || { k: [], f: [], oi: [] };
    const ch = M.px[s]?.ch ?? r?.chg, ls = DV.oi[s]?.ls;
    const pos = Object.entries(HW.pos).flatMap(([a, P]) => P.list.filter((x) => x.c === s).map((x) => ({ a, ...x }))).sort((a, b) => b.val - a.val);
    const lv = pos.filter((x) => x.sz > 0).reduce((a, x) => a + x.val, 0), sv = pos.filter((x) => x.sz < 0).reduce((a, x) => a + x.val, 0);
    const lq = LQ.filter((x) => x.s === s && now() - x.ts < 36e5), ll = lq.filter((x) => x.long).reduce((a, x) => a + x.u, 0), ls2 = lq.filter((x) => !x.long).reduce((a, x) => a + x.u, 0);
    const kp = `<div class="mk7">${kc("Price", p ? px(p) : "-", `${ps(ch)} 24h`)}${kc("Funding", r ? r.fa.toFixed(1) + "%/yr" : "-", r ? (r.fa > 30 ? "crowded longs" : r.fa < -30 ? "crowded shorts" : "neutral") : "not on Hyperliquid", r && r.fa >= 0 ? "up" : "dn")}${kc("Open interest", r ? big(r.oi) : "-", r ? "Vol/OI " + r.vo.toFixed(2) : "")}${kc("Volume 24h", r ? big(r.vol) : "-", "Hyperliquid")}${kc("Signal", r ? r.sig : "-", r ? "score " + r.score.toFixed(1) : "heuristic, not advice", r ? X.sigc(r.sig) : "")}${kc("Long/Short accts", ls ? ls.toFixed(2) : "-", "Binance")}${kc("Liq (1h)", big(ll + ls2), `L ${big(ll)} · S ${big(ls2)}`)}</div>`;
    const charts = `<div class="cols" style="margin-top:12px"><section class="panel"><h2><span>Price · 7 days</span><em>${ps(chg(h.k))}</em></h2>${svgLine(h.k, 130)}</section><section class="panel"><h2><span>Funding · 7 days (ann. %/hr)</span><em>${h.f.length ? "avg " + (h.f.reduce((a, x) => a + x, 0) / h.f.length).toFixed(1) + "%/yr" : ""}</em></h2>${svgBars(h.f, 130)}</section><section class="panel"><h2><span>Open interest · 7 days</span><em>${ps(chg(h.oi))}</em></h2>${svgLine(h.oi, 130, "#e8a317")}</section></div>`;
    const wt = pos.length ? `<div class="tw"><table><thead><tr><th>Wallet</th><th>Side</th><th>Size</th><th>Entry</th><th>uPnL</th><th>Lev</th><th>Liq price</th></tr></thead><tbody>${pos.slice(0, 12).map((x) => `<tr><td>${short(x.a)}</td><td class="${x.sz > 0 ? "up" : "dn"}"><b>${x.sz > 0 ? "LONG" : "SHORT"}</b></td><td>${big(x.val)}</td><td>${px(x.entry)}</td><td>${sgn(x.upnl, 0)}</td><td>${x.lev || "-"}x</td><td>${x.liq ? px(x.liq) : "-"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">None of the tracked whales hold this coin (open HL Whales / Liq Map once to load positions).</div>';
    const lt = lq.length ? `<div class="tw"><table><thead><tr><th>Time</th><th>Side</th><th>Size</th></tr></thead><tbody>${lq.slice(0, 10).map((x) => `<tr><td class="st">${new Date(x.ts).toLocaleTimeString()}</td><td class="${x.long ? "dn" : "up"}">${x.long ? "LONG liquidated" : "SHORT liquidated"}</td><td>${big(x.u)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">No liquidations of this coin seen in the last hour (stream fills while the page is open).</div>';
    $("s-coin").innerHTML = panel("Coin page", "everything about one coin in one place · Hyperliquid + Binance", symBar("coin", C, `<span class="chip"><span class="star" data-star="${esc(s)}">${X.star(s)}</span> Watchlist</span>`) + kp) + charts +
      `<div class="cols" style="margin-top:12px">${panel("Tracked whale positions", `longs ${big(lv)} · shorts ${big(sv)}`, wt)}${panel("Recent liquidations (1h)", "Binance + OKX + Bybit", lt)}</div>`;
  };
  onSym("coin", C, loadCoin);

  // ---------- HISTORY (funding + OI) ----------
  const H = { sym: LS.get("histSym", "BTC"), days: LS.get("histDays", 7) };
  const loadHistTab = () => loadHist(H.sym, H.days).then(() => redraw("hist")).catch(() => {});
  L.hist = () => lazy("hist" + H.sym + H.days, loadHistTab, 6e4);
  R.hist = () => {
    if (document.activeElement?.id === "histq") return;
    const h = HC[H.sym + "|" + H.days] || { k: [], f: [], oi: [] }, avg = h.f.length ? h.f.reduce((a, x) => a + x, 0) / h.f.length : null;
    const chip = (d) => `<span class="chip${H.days === d ? " on" : ""}" data-x="hist-d${d}">${d}d</span>`;
    $("s-hist").innerHTML = panel("Funding & open-interest history", "funding: Hyperliquid hourly · open interest: Binance 1h · price: Hyperliquid", symBar("hist", H, chip(3) + chip(7) + chip(20)) +
      `<div class="mk7">${kc("Price change", h.k.length ? ps(chg(h.k)) : "-", H.days + " days")}${kc("OI change", h.oi.length ? ps(chg(h.oi)) : "-", h.oi.length ? big(h.oi[h.oi.length - 1]) + " now" : "Binance only")}${kc("Avg funding", avg == null ? "-" : avg.toFixed(1) + "%/yr", "positive = longs pay")}${kc("Latest funding", h.f.length ? h.f[h.f.length - 1].toFixed(1) + "%/yr" : "-", "last hour")}</div>` +
      `<div class="wh2" style="margin-top:12px">Price</div>${svgLine(h.k, 150)}<div class="wh2" style="margin-top:12px">Funding rate (annualised, each bar = 1h)</div>${svgBars(h.f, 130)}<div class="wh2" style="margin-top:12px">Open interest ($)</div>${svgLine(h.oi, 150, "#e8a317")}` +
      '<div class="mlegend">Rising price + rising OI = new money entering the trend. Rising OI with price falling = shorts piling in. Very high positive funding for days = crowded longs, a squeeze risk.</div>');
  };
  onSym("hist", H, loadHistTab);
  $("s-hist").addEventListener("click", (e) => { const m = /^hist-d(\d+)$/.exec(e.target.dataset?.x || ""); if (m) { H.days = +m[1]; LS.set("histDays", H.days); loadHistTab(); R.hist(); } });

  // ---------- LIQUIDATION HISTORY (server-stored) ----------
  const LH = { srv: [], at: 0, start: now(), lastUp: 0 };
  const bkt = (t) => Math.floor(t / BUCKET) * BUCKET;
  function localBuckets() {
    const m = new Map();
    for (const x of LQ) {
      const t = bkt(x.ts), b = m.get(t) || { t, l: 0, s: 0, c: {} };
      b[x.long ? "l" : "s"] += x.u; const c = b.c[x.s] || (b.c[x.s] = [0, 0]); c[x.long ? 0 : 1] += x.u; m.set(t, b);
    }
    return m;
  }
  const loadLh = async () => { try { LH.srv = (await jget("/api/liqhist")).b || []; LH.at = now(); } catch (e) { /* keep old */ } redraw("lhist"); };
  L.lhist = () => lazy("lh", loadLh, 6e4);
  async function uploadLh() {
    if (!(LQS.bin || LQS.okx || LQS.byb)) return;
    const first = bkt(LH.start) + BUCKET, last = bkt(now()) - BUCKET, m = localBuckets(), out = [];
    for (let t = Math.max(first, LH.lastUp + BUCKET, last - 23 * BUCKET); t <= last; t += BUCKET) {
      const b = m.get(t) || { t, l: 0, s: 0, c: {} };
      b.c = Object.fromEntries(Object.entries(b.c).sort((a, z) => z[1][0] + z[1][1] - a[1][0] - a[1][1]).slice(0, 8)); out.push(b);
    }
    if (!out.length) return;
    try { const r = await (await fetch("/api/liqhist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ b: out }) })).json(); if (r.ok) LH.lastUp = last; } catch (e) { /* retry in 5 min */ }
  }
  setInterval(uploadLh, BUCKET); setTimeout(uploadLh, BUCKET + 2e4);
  R.lhist = () => {
    const m = new Map(LH.srv.map((b) => [b.t, b])), loc = localBuckets();
    for (const [t, b] of loc) { const o = m.get(t); if (!o) m.set(t, b); else m.set(t, { t, l: Math.max(o.l, b.l), s: Math.max(o.s, b.s), c: { ...o.c, ...b.c } }); }
    const end = bkt(now()), cols = 48, per = 6, arr = [];
    for (let i = 0; i < cols; i++) { let l = 0, s = 0; const t0 = end - ((cols - i) * per - 1) * BUCKET; for (let k = 0; k < per; k++) { const b = m.get(t0 + k * BUCKET); if (b) { l += b.l; s += b.s; } } arr.push({ t: t0, l, s }); }
    const tl = arr.reduce((a, x) => a + x.l, 0), ts = arr.reduce((a, x) => a + x.s, 0), mx = Math.max(1, ...arr.map((x) => x.l + x.s)), peak = arr.reduce((a, x) => (x.l + x.s > a.l + a.s ? x : a), arr[0]);
    const coins = {}; for (const b of m.values()) if (b.t > end - 288 * BUCKET) for (const k in b.c) { const c = coins[k] || (coins[k] = [0, 0]); c[0] += b.c[k][0]; c[1] += b.c[k][1]; }
    const top = Object.entries(coins).sort((a, z) => z[1][0] + z[1][1] - a[1][0] - a[1][1]).slice(0, 10);
    const bars = `<div style="display:flex;align-items:flex-end;gap:2px;height:170px;margin-top:10px">${arr.map((x) => `<div title="${new Date(x.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · longs ${big(x.l)} · shorts ${big(x.s)}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%"><div style="height:${(x.s / mx * 100).toFixed(1)}%;background:${GREEN};min-height:${x.s ? 1 : 0}px"></div><div style="height:${(x.l / mx * 100).toFixed(1)}%;background:${RED};min-height:${x.l ? 1 : 0}px"></div></div>`).join("")}</div><div class="st" style="display:flex;justify-content:space-between;font-size:10px"><span>24h ago</span><span>now</span></div>`;
    const tb = top.length ? `<div class="tw" style="margin-top:8px"><table><thead><tr><th>Coin</th><th>Longs wiped</th><th>Shorts wiped</th><th>Total</th></tr></thead><tbody>${top.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td class="dn">${big(v[0])}</td><td class="up">${big(v[1])}</td><td>${big(v[0] + v[1])}</td></tr>`).join("")}</tbody></table></div>` : "";
    $("s-lhist").innerHTML = panel("Liquidation history · 24h", "stored on the server in 5-min buckets · Binance + OKX + Bybit", `<div class="mk7">${kc("Longs wiped", big(tl), "red", "dn")}${kc("Shorts wiped", big(ts), "green", "up")}${kc("Peak 30 min", big(peak.l + peak.s), new Date(peak.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}${kc("Streams", `${LQS.bin ? "Binance ✓ " : ""}${LQS.okx ? "OKX ✓ " : ""}${LQS.byb ? "Bybit ✓" : ""}` || "none", "this browser")}</div>${bars}${tb}` +
      '<div class="mlegend">Each column = 30 min, red = longs liquidated, green = shorts liquidated. The exchange streams have no history, so this only covers times when someone had the site open; those browsers upload completed 5-minute buckets to the server (one write per 5 min). Gaps mean nobody was watching.</div>');
  };

  // ---------- CALCULATORS ----------
  const CK = Object.assign({ acct: 1000, risk: 1, entry: "", stop: "", tp: "", lev: 10, pside: "long", pm: 100, plev: 10, pe: "", px: "", fee: 0.05 }, LS.get("calc", {}));
  const fld = (id, l, v, st = "") => `<label class="st" style="display:inline-flex;flex-direction:column;gap:3px;margin:0 8px 8px 0">${l}<input id="${id}" type="number" step="any" value="${esc(v)}" style="${inpS};width:110px;${st}"></label>`;
  R.calc = () => {
    if ($("s-calc").innerHTML) return;
    $("s-calc").innerHTML = panel("Position size / risk calculator", "how big should the trade be so a stop-out loses only your risk %", `<div>${fld("ca", "Account ($)", CK.acct)}${fld("cr", "Risk (%)", CK.risk)}${fld("ce", "Entry", CK.entry)}${fld("cs", "Stop loss", CK.stop)}${fld("ct", "Take profit (opt.)", CK.tp)}${fld("cl", "Leverage (x)", CK.lev)}</div><div class="bar"><input id="cq" placeholder="coin" value="BTC" style="${inpS};width:80px"><span class="chip" data-x="calc-live">Use live price as entry</span></div><div id="cout" class="mk7"></div>`) +
      panel("PnL calculator", "what a trade makes or loses, including fees", `<div>${fld("pm", "Margin ($)", CK.pm)}${fld("pl", "Leverage (x)", CK.plev)}${fld("pe", "Entry", CK.pe)}${fld("px", "Exit", CK.px)}${fld("pf", "Fee per side (%)", CK.fee)}<label class="st" style="display:inline-flex;flex-direction:column;gap:3px;margin:0 8px 8px 0">Side<select id="pd" style="${inpS}"><option value="long"${CK.pside === "long" ? " selected" : ""}>Long</option><option value="short"${CK.pside === "short" ? " selected" : ""}>Short</option></select></label></div><div id="pout" class="mk7"></div><div class="mlegend">Approximate: ignores funding payments and exact exchange maintenance margin. Not advice.</div>`, "margin-top:12px");
    calcUpd();
  };
  function calcUpd() {
    const a = num("ca"), r = num("cr"), e = num("ce"), s = num("cs"), t = num("ct"), l = num("cl");
    Object.assign(CK, { acct: a, risk: r, entry: isFinite(e) ? e : "", stop: isFinite(s) ? s : "", tp: isFinite(t) ? t : "", lev: l });
    let h;
    if (a > 0 && r > 0 && e > 0 && s > 0 && e !== s && l >= 1) {
      const long = s < e, risk = a * r / 100, qty = risk / Math.abs(e - s), ntl = qty * e, mar = ntl / l, liq = long ? e * (1 - 1 / l + 0.005) : e * (1 + 1 / l - 0.005), bad = long ? liq >= s : liq <= s;
      h = kc("Side", long ? "LONG" : "SHORT", "from entry vs stop", long ? "up" : "dn") + kc("Risk", usd(risk), r + "% of account", "dn") + kc("Position size", fnum(qty, 4), "coins") + kc("Notional", usd(ntl), "× " + (ntl / a).toFixed(2) + " account") + kc("Margin needed", usd(mar), mar > a ? "⚠ more than your account" : "at " + l + "x", mar > a ? "dn" : "") + kc("Approx. liq price", fnum(liq), bad ? "⚠ liquidated before your stop" : "beyond your stop ✓", bad ? "dn" : "up");
      if (t > 0 && (long ? t > e : t < e)) { const rew = qty * Math.abs(t - e); h += kc("Reward", usd(rew), "at take profit", "up") + kc("Risk : Reward", "1 : " + (rew / risk).toFixed(2), rew / risk >= 2 ? "good" : "low", rew / risk >= 2 ? "up" : ""); }
    } else h = '<div class="st" style="padding:8px">Fill account, risk %, entry and stop loss.</div>';
    $("cout").innerHTML = h;
    const m = num("pm"), pl = num("pl"), pe = num("pe"), pxv = num("px"), pf = num("pf"), long = $("pd").value === "long";
    Object.assign(CK, { pm: m, plev: pl, pe: isFinite(pe) ? pe : "", px: isFinite(pxv) ? pxv : "", fee: pf, pside: long ? "long" : "short" });
    if (m > 0 && pl >= 1 && pe > 0 && pxv > 0) {
      const ntl = m * pl, qty = ntl / pe, gross = (long ? 1 : -1) * (pxv - pe) * qty, fees = (ntl + qty * pxv) * (pf || 0) / 100, net = gross - fees;
      $("pout").innerHTML = kc("Notional", usd(ntl), fnum(qty, 4) + " coins") + kc("Gross PnL", usd(gross), ps((pxv / pe - 1) * (long ? 1 : -1) * 100) + " price move", gross >= 0 ? "up" : "dn") + kc("Fees", usd(-fees), (pf || 0) + "% × 2 sides", "dn") + kc("Net PnL", usd(net), "", net >= 0 ? "up" : "dn") + kc("ROE", ((net / m) * 100).toFixed(1) + "%", "on your margin", net >= 0 ? "up" : "dn");
    } else $("pout").innerHTML = '<div class="st" style="padding:8px">Fill margin, leverage, entry and exit.</div>';
    LS.set("calc", CK);
  }
  $("s-calc").addEventListener("input", (e) => { if (e.target.id !== "cq") calcUpd(); });
  $("s-calc").addEventListener("change", (e) => { if (e.target.id === "pd") calcUpd(); });
  $("s-calc").addEventListener("click", (e) => { if (e.target.dataset?.x === "calc-live") { const p = pxOf(cleanSym($("cq").value)); if (p) { $("ce").value = p; $("pe").value = p; calcUpd(); } } });

  // ---------- PAPER TRADING ----------
  const PT = Object.assign({ bal: 10000, start: 10000, pos: [], hist: [] }, LS.get("paper", {})), PTF = 0.0005;
  const ptSave = () => LS.set("paper", PT);
  const ptPnl = (p, price) => (p.long ? 1 : -1) * (price - p.entry) / p.entry * p.ntl;
  const ptLiq = (p) => (p.long ? p.entry * (1 - 1 / p.lev + 0.005) : p.entry * (1 + 1 / p.lev - 0.005));
  function ptClose(p, price, why) {
    const gross = ptPnl(p, price), fee = p.ntl * PTF, pnl = Math.max(gross - fee * 2, -p.margin);
    PT.bal += p.margin + pnl; PT.pos = PT.pos.filter((x) => x.id !== p.id);
    PT.hist.unshift({ sym: p.sym, long: p.long, entry: p.entry, exit: price, ntl: p.ntl, pnl, why, t0: p.t0, t1: now() }); PT.hist.length = Math.min(PT.hist.length, 60);
    ptSave(); return pnl;
  }
  setInterval(() => {
    let hit = false;
    for (const p of [...PT.pos]) {
      const c = pxOf(p.sym); if (!c) continue;
      const liq = ptLiq(p), why = (p.long ? c <= liq : c >= liq) ? "liquidated" : p.sl && (p.long ? c <= p.sl : c >= p.sl) ? "stop loss" : p.tp && (p.long ? c >= p.tp : c <= p.tp) ? "take profit" : null;
      if (why) { const pnl = ptClose(p, why === "liquidated" ? liq : c, why); fire(`📒 Paper ${p.sym} ${p.long ? "LONG" : "SHORT"} closed (${why}): ${usd(pnl)}`, "pt" + p.id, 0, true); hit = true; }
    }
    if (hit && !$("s-paper").hidden) R.paper();
  }, 2000);
  R.paper = () => {
    if (document.activeElement?.closest?.("#s-paper") && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    let upnl = 0, mar = 0; for (const p of PT.pos) { const c = pxOf(p.sym); if (c) upnl += ptPnl(p, c); mar += p.margin; }
    const eq = PT.bal + mar + upnl, real = PT.hist.reduce((a, x) => a + x.pnl, 0), wins = PT.hist.filter((x) => x.pnl > 0).length;
    const open = PT.pos.length ? `<div class="tw"><table><thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>Now</th><th>uPnL</th><th>ROE</th><th>SL</th><th>TP</th><th>Liq</th><th></th></tr></thead><tbody>${PT.pos.map((p) => { const c = pxOf(p.sym), u = c ? ptPnl(p, c) : null; return `<tr><td><b>${esc(p.sym)}</b> <span class="st">${p.lev}x</span></td><td class="${p.long ? "up" : "dn"}"><b>${p.long ? "LONG" : "SHORT"}</b></td><td>${px(p.entry)}</td><td>${c ? px(c) : "-"}</td><td>${sgn(u)}</td><td>${u == null ? "-" : ps(u / p.margin * 100, 1)}</td><td>${p.sl ? px(p.sl) : "-"}</td><td>${p.tp ? px(p.tp) : "-"}</td><td class="st">${px(ptLiq(p))}</td><td><span class="chip" data-x="pt-close" data-id="${p.id}">Close</span></td></tr>`; }).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">No open paper positions.</div>';
    const hist = PT.hist.length ? `<div class="tw" style="max-height:300px"><table><thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Why</th><th>Closed</th></tr></thead><tbody>${PT.hist.slice(0, 30).map((x) => `<tr><td><b>${esc(x.sym)}</b></td><td class="${x.long ? "up" : "dn"}">${x.long ? "LONG" : "SHORT"}</td><td>${px(x.entry)}</td><td>${px(x.exit)}</td><td>${sgn(x.pnl)}</td><td class="st">${x.why}</td><td class="st">${new Date(x.t1).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">No closed trades yet.</div>';
    const form = `<div>${["Coin|ptc|text|BTC", "Margin ($)|ptm|number|100", "Leverage (x)|ptl|number|10", "Stop loss|pts|number|", "Take profit|ptt|number|"].map((f) => { const [l, id, t, v] = f.split("|"); return `<label class="st" style="display:inline-flex;flex-direction:column;gap:3px;margin:0 8px 8px 0">${l}<input id="${id}" type="${t}" step="any" value="${v}" style="${inpS};width:100px"></label>`; }).join("")}</div><div class="bar"><span class="chip on" data-x="pt-long">▲ Open LONG</span><span class="chip" data-x="pt-short" style="color:${RED}">▼ Open SHORT</span><span class="chip" data-x="pt-reset">Reset account</span><span class="st">${PT.msg ? esc(PT.msg) : ""}</span></div>`;
    $("s-paper").innerHTML = panel("Paper trading", "fake money at live prices · stop / take-profit / liquidation are checked every 2s while this page is open", `<div class="mk7">${kc("Equity", usd(eq), (eq >= PT.start ? "+" : "") + ((eq / PT.start - 1) * 100).toFixed(2) + "% vs start", eq >= PT.start ? "up" : "dn")}${kc("Free cash", usd(PT.bal), "margin in use " + usd(mar))}${kc("Unrealised", usd(upnl), PT.pos.length + " open", upnl >= 0 ? "up" : "dn")}${kc("Realised", usd(real), PT.hist.length + " closed", real >= 0 ? "up" : "dn")}${kc("Win rate", PT.hist.length ? (wins / PT.hist.length * 100).toFixed(0) + "%" : "-", wins + " wins")}</div>${form}`) + panel("Open positions", "uses your live prices from the screener / Binance", open, "margin-top:12px") + panel("History", "last 30 closed trades · fees 0.05% per side", hist, "margin-top:12px");
  };
  $("s-paper").addEventListener("click", (e) => {
    const x = e.target.dataset?.x; if (!x || !x.startsWith("pt-")) return;
    if (x === "pt-close") { const p = PT.pos.find((q) => String(q.id) === e.target.dataset.id), c = p && pxOf(p.sym); if (p && c) ptClose(p, c, "manual"); PT.msg = ""; }
    else if (x === "pt-reset") { if (!confirm("Reset the paper account to $10,000?")) return; Object.assign(PT, { bal: 10000, start: 10000, pos: [], hist: [], msg: "" }); ptSave(); }
    else {
      const sym = cleanSym($("ptc").value), m = num("ptm"), lev = num("ptl"), sl = num("pts"), tp = num("ptt"), long = x === "pt-long", p0 = pxOf(sym);
      PT.msg = !p0 ? "No live price for that coin." : !(m > 0) || m > PT.bal ? "Margin must be between 0 and your free cash." : !(lev >= 1 && lev <= 100) ? "Leverage 1-100." : sl && (long ? sl >= p0 : sl <= p0) ? "Stop loss is on the wrong side." : tp && (long ? tp <= p0 : tp >= p0) ? "Take profit is on the wrong side." : "";
      if (!PT.msg) { PT.bal -= m; PT.pos.push({ id: now(), sym, long, entry: p0, margin: m, lev, ntl: m * lev, sl: sl || null, tp: tp || null, t0: now() }); ptSave(); }
    }
    R.paper();
  });

  // ---------- indicator values for alert rules (RSI 14 / price vs 50-SMA, 1h) ----------
  function indicators(c) {
    const o = {}; if (c.length < 51) return o;
    let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } g /= 14; l /= 14;
    for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; }
    o.rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); const sma = c.slice(-50).reduce((a, x) => a + x, 0) / 50; o.vsma = (c[c.length - 1] / sma - 1) * 100; return o;
  }
  async function refreshInd() {
    const coins = [...new Set(RL.list.filter((r) => r.on && (r.m === "rsi" || r.m === "vsma")).map((r) => r.s))].slice(0, 8);
    for (const c of coins) { try { IND[c] = indicators((await hlPost({ type: "candleSnapshot", req: { coin: c, interval: "1h", startTime: now() - 90 * 36e5 } })).map((x) => +x.c)); } catch (e) { /* retry next minute */ } await X.sleep(200); }
  }
  setInterval(refreshInd, 6e4); setTimeout(refreshInd, 4000);

  // ---------- pinned tabs (double-click a tab) ----------
  const pinned = () => LS.get("pins", []);
  function applyPins() { const p = pinned(); document.querySelectorAll("#subtabs .tab").forEach((t) => { const i = p.indexOf(t.dataset.u); t.style.order = i < 0 ? 0 : -100 + i; t.classList.toggle("pin", i >= 0); t.title = i >= 0 ? "Pinned · double-click to unpin" : "Double-click to pin"; }); }
  $("subtabs").addEventListener("dblclick", (e) => { const u = e.target.dataset?.u; if (!u) return; const p = pinned(); LS.set("pins", p.includes(u) ? p.filter((x) => x !== u) : [...p, u]); applyPins(); });
  const st = document.createElement("style"); st.textContent = ".tab.pin::before{content:'📌 ';font-size:10px}"; document.head.appendChild(st);
  applyPins();

  // ---------- CSV export of the tables on the current tab ----------
  const thm = $("thm");
  const mkBtn = (id, label, title) => { const b = document.createElement("div"); b.className = "bell"; b.id = id; b.title = title; b.textContent = label; thm.parentNode.insertBefore(b, thm); return b; };
  mkBtn("csvb", "⬇ CSV", "Download the tables on this tab as CSV").onclick = () => {
    const root = document.body.dataset.v === "mkt" ? $("s-" + document.querySelector("#subtabs .tab.on")?.dataset.u) : $("v-meme"), tabs = [...(root ? root.querySelectorAll("table") : [])];
    if (!tabs.length) { fire("No table on this tab to export.", "csv", 0, true); return; }
    const q = (v) => '"' + v.replace(/\s+/g, " ").trim().replace(/"/g, '""') + '"';
    const csv = tabs.map((t) => [...t.rows].map((r) => [...r.cells].map((c) => q(c.textContent)).join(",")).join("\n")).join("\n\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `spyder-${document.body.dataset.v === "mkt" ? document.querySelector("#subtabs .tab.on")?.dataset.u : "meme"}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  // ---------- Hinglish labels ----------
  const HG = {
    "Overview": "Overview (ek nazar)", "Screener": "Screener (coin dhundho)", "Derivatives": "Derivatives (futures)", "Movers": "Movers (tez coins)", "Chains & ETF": "Chains & ETF", "HL Whales": "HL Whales (bade players)", "Liq Map": "Liq Map (liquidation)", "Options": "Options", "On-Chain": "On-Chain", "Cycles": "Cycles", "Macro": "Macro (duniya)",
    "Journal": "Journal (trade diary)", "Treemap": "Treemap (coin map)", "Social": "Social (chatter)", "Orderflow": "Orderflow (kaun buy/sell)", "Liq Heatmap": "Liq Heatmap", "Compare": "Compare (tulna)", "Network": "Network (gas)", "Portfolio": "Portfolio (mera paisa)", "Funding Map": "Funding Map", "Basis & L/S": "Basis & L/S", "Smart Money": "Smart Money (bada paisa)", "Backtest": "Backtest (purana test)", "Alert Rules": "Alert Rules (meri alerts)", "Multi-chart": "Multi-chart (4 chart)", "Daily Brief": "Daily Brief (aaj ka summary)", "Views": "Views (saved)", "Ask": "Ask (poocho)", "Watchlist ★": "Watchlist ★ (meri list)",
    "Coin": "Coin (ek coin ki poori detail)", "Calc": "Calc (size / PnL)", "Paper": "Paper (fake trading)", "Liq History": "Liq History (24h)", "History": "History (funding / OI)",
    "Where is the money going?": "Paisa kahan ja raha hai?", "Whale radar": "Whale radar (kaun buy/sell kar raha)", "Funding rates": "Funding rates", "Most crowded longs": "Sabse zyada longs (risky)", "Most crowded shorts": "Sabse zyada shorts (squeeze ka chance)", "Open interest + long/short ratio": "Open interest + long/short ratio",
    "Long liquidations": "Long liquidations (longs ka nuksaan)", "Short liquidations": "Short liquidations (shorts ka nuksaan)", "Liquidation bias": "Liquidation bias (kaun pit raha)", "Avg funding (top 20)": "Avg funding (top 20)", "Open interest (top 15)": "Open interest (top 15)",
    "Hot right now": "Abhi garam (hot)", "Saved filters:": "Saved filters:", "Paper trading": "Paper trading (nakli paise se)", "Open positions": "Khuli positions", "History": "History", "Position size / risk calculator": "Position size / risk calculator (kitna lagana)", "PnL calculator": "PnL calculator (profit/loss)", "Coin page": "Coin page", "Tracked whale positions": "Tracked whale positions (bade wallets)", "Recent liquidations (1h)": "Recent liquidations (1h)",
    "Position size": "Position size (kitne coins)", "Risk : Reward": "Risk : Reward", "Margin needed": "Margin needed (kitna lock hoga)", "Equity": "Equity (kul value)", "Free cash": "Free cash", "Win rate": "Win rate (jeet %)", "Unrealised": "Unrealised (abhi ka)", "Realised": "Realised (pakka)",
  };
  const hgOn = () => LS.get("hg", false), skip = new Set(["SCRIPT", "STYLE", "INPUT", "SELECT", "TEXTAREA"]);
  function hgApply() {
    const on = hgOn();
    document.querySelectorAll(".tab, h2 span, .kpi .k, .wh2").forEach((el) => {
      if (skip.has(el.tagName) || el.children.length) return;
      const t = el.textContent.trim(), en = el.dataset.en;
      if (on && !en && HG[t]) { el.dataset.en = t; el.textContent = HG[t]; }
      else if (!on && en) { el.textContent = en; delete el.dataset.en; }
    });
  }
  const hb = mkBtn("hgb", "", "Switch labels between English and Hinglish"), hbLabel = () => { hb.textContent = hgOn() ? "🇮🇳 Hinglish ON" : "🇮🇳 Hinglish"; };
  hbLabel(); hb.onclick = () => { LS.set("hg", !hgOn()); hbLabel(); hgApply(); };
  let hgT = 0; new MutationObserver(() => { if (hgOn() && !hgT) hgT = setTimeout(() => { hgT = 0; hgApply(); }, 300); }).observe($("v-mkt"), { childList: true, subtree: true });
  hgApply();
})();
