// Market Flow extras: derivatives (funding, OI, liquidations), movers scanner, chains + ETF, watchlist, coin chart, alerts.
(() => {
  const { M, F, W, big, sgb, px, pc, jget, STB } = window.SP;
  const FA = "https://fapi.binance.com", BA = "https://api.binance.com";
  const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("spy." + k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("spy." + k, JSON.stringify(v)); } catch (e) { /* storage disabled */ } } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cls = (v) => (v >= 0 ? "up" : "dn");
  const ps = (v, d = 2) => (v == null || !isFinite(v) ? '<span class="st">-</span>' : `<span class="${cls(v)}">${v >= 0 ? "+" : ""}${v.toFixed(d)}%</span>`);
  const kc = (k, v, s, c = "") => `<div class="kpi"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
  const panel = (t, em, body, st = "") => `<section class="panel" style="${st}"><h2><span>${t}</span><em>${em}</em></h2>${body}</section>`;
  const symRow = (s, inner, extra = "") => `<div class="wr" data-sym="${esc(s)}" style="cursor:pointer;${extra}"><b>${esc(s)}</b>${inner}</div>`;
  const perps = () => new Set(DV.fund.map((f) => f.s));
  const topByVol = (n, only) => Object.entries(M.px).filter(([s, t]) => t.q > 0 && !STB.test(s) && (!only || only.has(s))).sort((a, b) => b[1].q - a[1].q).slice(0, n).map((e) => e[0]);

  // ---------- state ----------
  const DV = { fund: [], oi: {} }, LQ = [], MV = {}, CHN = { rows: [], etf: null };
  let WLIST = LS.get("watch", ["BTC", "ETH", "SOL"]), sub = "over", mvSort = "c5m";
  const AL = Object.assign({ on: false, notify: true, sound: true, whale: 1e6, wwhale: 2.5e5, liq: 5e5, pump: 3, sector: true, tgToken: "", tgChat: "" }, LS.get("alerts", {}));
  const star = (s) => (WLIST.includes(s) ? "★" : "☆");
  window.SP.star = star;

  // ---------- sub tabs ----------
  const wrap = $("v-mkt");
  for (const id of ["scr", "deriv", "mov", "chain", "hlw", "liq", "hype", "opt", "onc", "cyc", "mac", "jrn", "ask", "watch"]) { const d = document.createElement("div"); d.id = "s-" + id; d.hidden = true; wrap.appendChild(d); }
  function show(u) {
    sub = u;
    document.querySelectorAll("#subtabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.u === u));
    for (const id of ["over", "scr", "deriv", "mov", "chain", "hlw", "liq", "hype", "opt", "onc", "cyc", "mac", "jrn", "ask", "watch"]) $("s-" + id).hidden = id !== u;
    LAZY[u]?.();
    renderSub();
  }
  $("subtabs").onclick = (e) => { const u = e.target.dataset?.u; if (u) show(u); };
  function renderSub() { if ((sub === "jrn" || sub === "ask") && $("s-" + sub).innerHTML) return; ({ scr: rScr, hlw: rHlw, liq: rLiq, hype: rHype, onc: rOn, jrn: rJrn, ask: rAsk, opt: rOpt, cyc: rCyc, mac: rMac, deriv: rDeriv, mov: rMov, chain: rChain, watch: rWatch })[sub]?.(); }

  // ---------- data: derivatives ----------
  const lg = (fn) => async () => { try { await fn(); } catch (e) { /* keep stale data */ } if (document.body.dataset.v === "mkt") renderSub(); };
  const getFund = lg(async () => {
    DV.fund = (await jget(FA + "/fapi/v1/premiumIndex")).filter((x) => x.symbol.endsWith("USDT") && !x.symbol.includes("_")).map((x) => ({ s: x.symbol.slice(0, -4), mark: +x.markPrice, fr: +x.lastFundingRate * 100, next: x.nextFundingTime }));
  });
  async function getOI() {
    for (const s of topByVol(15, perps())) {
      try {
        const [h, l] = await Promise.all([jget(`${FA}/futures/data/openInterestHist?symbol=${s}USDT&period=1h&limit=25`), jget(`${FA}/futures/data/globalLongShortAccountRatio?symbol=${s}USDT&period=1h&limit=1`)]);
        const v = h.map((x) => +x.sumOpenInterestValue), now = v[v.length - 1];
        DV.oi[s] = { v: now, c1: v.length > 1 ? (now / v[v.length - 2] - 1) * 100 : null, c24: (now / v[0] - 1) * 100, ls: +l[0]?.longShortRatio };
      } catch (e) { /* skip symbol */ }
      await sleep(500);
    }
    if (document.body.dataset.v === "mkt") renderSub();
  }
  function connectL() {
    let ws; try { ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr"); } catch (e) { return; }
    ws.onmessage = (m) => { try { const o = JSON.parse(m.data).o; if (!o) return; LQ.unshift({ s: o.s.replace(/USDT$/, ""), long: o.S === "SELL", u: +o.ap * +o.z || +o.p * +o.q, ts: o.T }); if (LQ.length > 1500) LQ.length = 1500; } catch (e) { /* ignore frame */ } };
    ws.onclose = () => setTimeout(connectL, 5000); ws.onerror = () => ws.close();
  }

  function rDeriv() {
    const now = Date.now(), L = LQ.filter((x) => now - x.ts < 9e5), lng = L.filter((x) => x.long).reduce((a, x) => a + x.u, 0), sht = L.filter((x) => !x.long).reduce((a, x) => a + x.u, 0);
    const bias = lng + sht < 1 ? "waiting for liquidations…" : lng > sht * 1.5 ? "Longs are getting wiped (price falling)" : sht > lng * 1.5 ? "Shorts are getting squeezed (price rising)" : "balanced";
    const per = {}; for (const x of L) per[x.s] = (per[x.s] || 0) + x.u;
    const liqTop = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const top20 = new Set(topByVol(20, perps())), f20 = DV.fund.filter((f) => top20.has(f.s)), avg = f20.length ? f20.reduce((a, f) => a + f.fr, 0) / f20.length : null;
    const oiS = Object.values(DV.oi), oiT = oiS.reduce((a, o) => a + o.v, 0), oi24 = oiS.reduce((a, o) => a + o.v - o.v / (1 + o.c24 / 100), 0);
    const fr = (f) => symRow(f.s, `<span class="${cls(f.fr)}">${f.fr.toFixed(4)}%</span><span class="st">${(f.fr * 3 * 365).toFixed(0)}%/yr</span><span class="st sp">${px(f.mark)}</span>`);
    const hi = DV.fund.slice().sort((a, b) => b.fr - a.fr).slice(0, 10), lo = DV.fund.slice().sort((a, b) => a.fr - b.fr).slice(0, 10);
    const oiRows = Object.entries(DV.oi).sort((a, b) => b[1].v - a[1].v).map(([s, o]) => { const f = DV.fund.find((x) => x.s === s); return `<tr class="cr" data-sym="${esc(s)}"><td><b>${esc(s)}</b></td><td>${big(o.v)}</td><td>${ps(o.c1)}</td><td>${ps(o.c24)}</td><td class="${o.ls > 1.5 ? "up" : o.ls < 0.8 ? "dn" : ""}">${isFinite(o.ls) ? o.ls.toFixed(2) : "-"}</td><td>${f ? ps(f.fr, 4) : "-"}</td></tr>`; }).join("");
    const tape = LQ.slice(0, 25).map((x) => symRow(x.s, `<span class="bd ${x.long ? "dn" : "up"}">${x.long ? "LONG LIQ" : "SHORT LIQ"}</span><span class="${x.long ? "dn" : "up"}" ${x.u >= 1e5 ? 'style="font-weight:800"' : ""}>${big(x.u)}</span><span class="st sp">${ago(x.ts)} ago</span>`)).join("");
    $("s-deriv").innerHTML = `<div class="mk7">${kc("Long liquidations 15m", big(lng), "longs wiped out", "dn")}${kc("Short liquidations 15m", big(sht), "shorts squeezed", "up")}${kc("Liquidation bias", `<span style="font-size:13px">${bias}</span>`, `${L.length} events`)}${kc("Avg funding (top 20)", avg == null ? "-" : avg.toFixed(4) + "%", avg == null ? "" : avg > 0.02 ? "longs crowded" : avg < -0.01 ? "shorts crowded" : "neutral", avg > 0 ? "up" : "dn")}${kc("Open interest (top 15)", oiS.length ? big(oiT) : "-", oiS.length ? `<span class="${cls(oi24)}">${sgb(oi24)} 24h</span>` : "loading…")}</div>
    <div class="cols" style="margin-top:12px">
      <div>${panel("Funding rates", "positive = longs pay shorts (crowded longs) · % per 8h", `<div class="two" style="margin-top:8px"><div><div class="wh2" style="margin-top:0">Most crowded LONGS</div>${hi.map(fr).join("") || '<span class="st">loading…</span>'}</div><div><div class="wh2" style="margin-top:0">Most crowded SHORTS</div>${lo.map(fr).join("") || '<span class="st">loading…</span>'}</div></div>`)}
      ${panel("Open interest + long/short ratio", "top 15 perps by volume · L/S = accounts long ÷ short", `<div class="tw"><table><thead><tr><th>Coin</th><th>OI</th><th>1h</th><th>24h</th><th>L/S</th><th>Funding</th></tr></thead><tbody>${oiRows || '<tr><td colspan="6" class="st">loading…</td></tr>'}</tbody></table></div>`, "margin-top:12px")}</div>
      ${panel("Liquidation tape", "live, Binance futures", `<div class="mlegend" style="margin:6px 0">Last 15 min by coin: ${liqTop.length ? liqTop.map(([s, v]) => `<b>${esc(s)}</b> ${big(v)}`).join(" · ") : "-"}</div><div class="tw" style="max-height:640px">${tape || '<div class="st">waiting for liquidations…</div>'}</div>`)}
    </div>`;
  }

  // ---------- movers scanner ----------
  const tick = async (win, syms, depth = 0) => {
    try { return await jget(`${BA}/api/v3/ticker?windowSize=${win}&symbols=${encodeURIComponent(JSON.stringify(syms.map((s) => s + "USDT")))}`); } catch (e) {
      if (syms.length < 2 || depth > 4) return [];
      const h = syms.length >> 1; return [...(await tick(win, syms.slice(0, h), depth + 1)), ...(await tick(win, syms.slice(h), depth + 1))];
    }
  };
  const getMov = lg(async () => {
    const top = topByVol(200);
    for (const win of ["5m", "1h"]) {
      for (let i = 0; i < top.length; i += 100) {
        for (const x of await tick(win, top.slice(i, i + 100))) { const s = x.symbol.slice(0, -4), m = MV[s] || (MV[s] = {}); m["c" + win] = +x.priceChangePercent; m["v" + win] = +x.quoteVolume; m.p = +x.lastPrice; }
      }
    }
    for (const [s, m] of Object.entries(MV)) { const q = M.px[s]?.q; if (q) { m.s5 = m.v5m / (q / 288); m.s1 = m.v1h / (q / 24); } }
  });
  function rMov() {
    const rows = Object.entries(MV).filter(([, m]) => m.c5m != null && m.v5m > 2e4).map(([s, m]) => ({ s, ...m }));
    const key = { c5m: [(r) => r.c5m, -1], d5m: [(r) => r.c5m, 1], s5: [(r) => r.s5 || 0, -1], c1h: [(r) => r.c1h, -1] }[mvSort];
    rows.sort((a, b) => key[1] * (key[0](a) - key[0](b)));
    const tag = (r) => (r.c5m >= 2 && r.s5 >= 3 ? '<span class="bd up">PUMP</span>' : r.c5m <= -2 && r.s5 >= 3 ? '<span class="bd dn">DUMP</span>' : r.s5 >= 5 ? '<span class="bd up" style="background:rgba(255,161,26,.2);color:var(--acc)">VOL</span>' : "");
    const chips = [["c5m", "Top pumps 5m"], ["d5m", "Top dumps 5m"], ["s5", "Volume surge"], ["c1h", "Movers 1h"]].map(([k, l]) => `<span class="chip${mvSort === k ? " on" : ""}" data-mv="${k}">${l}</span>`).join("");
    $("s-mov").innerHTML = panel("Live movers scanner", "top 200 Binance coins by volume · refreshes every 45s · click a coin for its chart", `<div class="bar">${chips}</div><div class="mlegend" style="margin:0 0 8px">Surge = last-5m volume vs the coin's normal 5-minute volume. PUMP/DUMP = move over 2% with 3x+ volume.</div><div class="tw"><table><thead><tr><th>Coin</th><th>Price</th><th>5m</th><th>1h</th><th>Vol 5m</th><th>Surge 5m</th><th>Surge 1h</th><th>24h</th><th></th></tr></thead><tbody>${rows.slice(0, 50).map((r) => `<tr class="cr" data-sym="${esc(r.s)}"><td><span class="star" data-star="${esc(r.s)}">${star(r.s)}</span> <b>${esc(r.s)}</b></td><td>${px(r.p)}</td><td>${ps(r.c5m)}</td><td>${ps(r.c1h)}</td><td>${big(r.v5m)}</td><td>${r.s5 ? r.s5.toFixed(1) + "x" : "-"}</td><td>${r.s1 ? r.s1.toFixed(1) + "x" : "-"}</td><td>${ps(M.px[r.s]?.ch)}</td><td>${tag(r)}</td></tr>`).join("") || '<tr><td colspan="9" class="st">scanning…</td></tr>'}</tbody></table></div>`);
  }
  $("s-mov").onclick = (e) => { const k = e.target.dataset?.mv; if (k) { mvSort = k; rMov(); } };

  // ---------- chains + ETF ----------
  const getChains = lg(async () => {
    const list = (await jget("https://api.llama.fi/v2/chains")).filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 12);
    CHN.rows = list.map((c) => ({ n: c.name, tvl: c.tvl }));
    for (const r of CHN.rows) {
      try { const h = await jget("https://api.llama.fi/v2/historicalChainTvl/" + encodeURIComponent(r.n)), n = h.length; r.d1 = (h[n - 1].tvl / h[n - 2].tvl - 1) * 100; r.d7 = (h[n - 1].tvl / h[n - 8].tvl - 1) * 100; } catch (e) { /* no history */ }
      if (CHN.rows.indexOf(r) < 8) { try { const d = await jget(`https://api.llama.fi/overview/dexs/${encodeURIComponent(r.n)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`); r.dv = d.total24h; r.dv1 = d.change_1d; r.dv7 = d.change_7d; } catch (e) { /* no dex data */ } }
      if (document.body.dataset.v === "mkt") renderSub();
    }
  });
  const getEtf = lg(async () => { CHN.etf = await jget("/api/etf"); });
  const SW = { rows: [], sym: {} };
  const getSol = lg(async () => {
    const a = await jget("/api/sol-whales"), seen = new Set(SW.rows.map((r) => r.sig));
    SW.rows = [...a.filter((r) => !seen.has(r.sig)), ...SW.rows].slice(0, 300);
    const need = [...new Set(SW.rows.map((r) => r.mint))].filter((m) => !(m in SW.sym)).slice(0, 30);
    if (need.length) {
      need.forEach((m) => (SW.sym[m] = null));
      try { for (const p of await jget("https://api.dexscreener.com/tokens/v1/solana/" + need.join(","))) if (p.baseToken && !SW.sym[p.baseToken.address]) SW.sym[p.baseToken.address] = p.baseToken.symbol; } catch (e) { /* symbols optional */ }
    }
    if (document.body.dataset.v === "mkt") renderSub();
  });
  function solPanel() {
    const sp = M.px.SOL?.p || 0, usd0 = (s) => (sp ? big(s * sp) : s.toFixed(0) + " SOL"), g = {};
    for (const r of SW.rows) { const m = g[r.mint] || (g[r.mint] = { mint: r.mint, buy: 0, sell: 0, n: 0 }); m[r.side] += r.sol; m.n++; }
    const nm = (m) => esc(SW.sym[m] || m.slice(0, 4) + "…" + m.slice(-4)), lk = (m) => `<a href="https://dexscreener.com/solana/${esc(m)}" target="_blank" rel="noopener">${nm(m)}</a>`;
    const top = Object.values(g).sort((a, b) => b.buy - b.sell - (a.buy - a.sell)).slice(0, 12);
    const tp = `<div class="tw"><table><thead><tr><th>Token</th><th>Whale buys</th><th>Whale sells</th><th>Net</th><th>Swaps</th></tr></thead><tbody>${top.map((m) => `<tr><td><b>${lk(m.mint)}</b></td><td class="up">${usd0(m.buy)}</td><td class="dn">${usd0(m.sell)}</td><td class="${cls(m.buy - m.sell)}">${usd0(m.buy - m.sell)}</td><td>${m.n}</td></tr>`).join("") || '<tr><td colspan="5" class="st">collecting…</td></tr>'}</tbody></table></div>`;
    const tape = `<div class="tw" style="margin-top:8px"><table><thead><tr><th>Time</th><th>Side</th><th>Token</th><th>Size</th><th>Wallet</th></tr></thead><tbody>${SW.rows.slice(0, 25).map((r) => `<tr><td class="st">${ago(r.ts * 1000)} ago</td><td class="${r.side === "buy" ? "up" : "dn"}">${r.side.toUpperCase()}</td><td><b>${lk(r.mint)}</b></td><td>${usd0(r.sol)} <span class="st">(${r.sol.toFixed(0)} SOL)</span></td><td><a href="https://solscan.io/tx/${esc(r.sig)}" target="_blank" rel="noopener">${esc(r.w.slice(0, 4))}…${esc(r.w.slice(-4))}</a></td></tr>`).join("")}</tbody></table></div>`;
    return panel("Solana whale swaps (Helius)", "Jupiter swaps of 3+ SOL · sampled every 10s (Jupiter is very busy, so not every swap is caught) · net = buys minus sells since page opened", tp + tape, "margin-top:12px");
  }
  function rChain() {
    const e = CHN.etf?.data, btc = M.px.BTC?.p || 0;
    let etf = '<div class="st" style="padding:10px">ETF data unavailable right now.</div>';
    if (e) {
      const rows = Object.values(e).sort((a, b) => b.holdings - a.holdings), tot = rows.reduce((a, r) => a + r.change, 0), hold = rows.reduce((a, r) => a + r.holdings, 0);
      etf = `<div class="mk7" style="margin-top:8px">${kc("Net change (latest day)", `${tot >= 0 ? "+" : ""}${tot.toFixed(0)} BTC`, btc ? `≈ ${sgb(tot * btc)}` : "", cls(tot))}${kc("Total ETF holdings", hold.toFixed(0) + " BTC", btc ? "≈ " + big(hold * btc) : "")}</div><div class="tw" style="margin-top:8px"><table><thead><tr><th>ETF</th><th>Holdings</th><th>Change (BTC)</th><th>≈ Flow</th><th>As of</th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${esc(r.ticker)}</b></td><td>${r.holdings.toFixed(0)}</td><td class="${cls(r.change)}">${r.change >= 0 ? "+" : ""}${r.change.toFixed(1)}</td><td class="${cls(r.change)}">${btc ? sgb(r.change * btc) : "-"}</td><td class="st">${esc(r.dt)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    const mx = Math.max(1, ...CHN.rows.map((r) => Math.abs(r.d1 || 0)));
    const chains = `<div class="tw" style="margin-top:8px"><table><thead><tr><th>Chain</th><th>TVL</th><th>TVL 1d</th><th>TVL 7d</th><th>DEX vol 24h</th><th>DEX 1d</th><th>DEX 7d</th></tr></thead><tbody>${CHN.rows.map((r) => `<tr><td><b>${esc(r.n)}</b></td><td>${big(r.tvl)}</td><td style="background:rgba(${(r.d1 || 0) >= 0 ? "47,210,122" : "255,77,77"},${(Math.abs(r.d1 || 0) / mx * 0.25).toFixed(2)})">${ps(r.d1)}</td><td>${ps(r.d7)}</td><td>${r.dv ? big(r.dv) : "-"}</td><td>${ps(r.dv1)}</td><td>${ps(r.dv7)}</td></tr>`).join("") || '<tr><td colspan="7" class="st">loading…</td></tr>'}</tbody></table></div>`;
    $("s-chain").innerHTML = panel("Spot Bitcoin ETF flows", "issuer holdings change · as-of dates differ per issuer · est. flow = BTC change × price", etf) + panel("Chain money flow", "TVL = capital parked on the chain · DEX volume = trading activity · DefiLlama", chains, "margin-top:12px") + stblPanel() + solPanel();
  }

  // ---------- screener (Hyperliquid perps) ----------
  const HL = { rows: [], first: {}, cls: "all", sig: "all", q: "", sk: "vol", sd: -1, ts: 0 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hlPost = async (body) => { const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.status); return r.json(); };
  function hlAdd(meta, ctx, out, dex) {
    meta.universe.forEach((u, i) => {
      const c = ctx[i]; if (!c || u.isDelisted) return;
      const p = +c.markPx, prev = +c.prevDayPx, oi = +c.openInterest * p, vol = +c.dayNtlVlm, fund = +c.funding;
      if (!p || !prev) return;
      const f0 = HL.first[u.name] || (HL.first[u.name] = { oi, p });
      const chg = (p / prev - 1) * 100, fa = fund * 24 * 365 * 100, oid = f0.oi ? (oi / f0.oi - 1) * 100 : 0, pd = (p / f0.p - 1) * 100;
      const tags = []; let s = clamp(chg / 4, -2, 2) - clamp(fa / 60, -2, 2) * 0.8;
      if (Math.abs(oid) >= 1) { s += Math.sign(pd) * Math.sign(oid) * 0.5; tags.push(oid > 0 ? (pd >= 0 ? "LONG BUILD" : "SHORT BUILD") : (pd >= 0 ? "SQUEEZE" : "LONG FLUSH")); }
      if (fa > 40) tags.push("CROWDED LONGS"); else if (fa < -20) tags.push("CROWDED SHORTS");
      if (oi > 0 && vol / oi > 4) tags.push("VOL/OI HIGH");
      out.push({ s: u.name, dex, p, chg, vol, oi, fa, oid, vo: oi ? vol / oi : 0, tags, score: s, sig: s >= 2.5 ? "STRONG BUY" : s >= 1.2 ? "BUY" : s <= -2.5 ? "STRONG SELL" : s <= -1.2 ? "SELL" : "NEUTRAL", lev: u.maxLeverage });
    });
  }
  const getHL = lg(async () => {
    const [meta, ctx] = await hlPost({ type: "metaAndAssetCtxs" }), out = [];
    hlAdd(meta, ctx, out, "");
    if (!HL.dexes) { try { HL.dexes = (await hlPost({ type: "perpDexs" })).filter(Boolean).map((d) => d.name); } catch (e) { HL.dexes = []; } }
    for (const dx of HL.dexes) { try { const [m2, c2] = await hlPost({ type: "metaAndAssetCtxs", dex: dx }); hlAdd(m2, c2, out, dx); } catch (e) { /* skip dex */ } }
    HL.rows = out; HL.ts = Date.now();
  });
  const sigc = (g) => (g.includes("BUY") ? "up" : g.includes("SELL") ? "dn" : "st");
  function rScr() {
    const q = HL.q.toUpperCase(), liquid = HL.rows.slice().sort((a, b) => b.vol - a.vol).slice(0, 100);
    const hot = liquid.filter((r) => r.sig !== "NEUTRAL").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 6);
    const kpi = `<div class="mk7">${kc("Markets", HL.rows.length, HL.rows.filter((r) => r.dex).length + " HIP-3 (stocks / commodities / FX)")}${kc("24h volume", big(HL.rows.reduce((a, r) => a + r.vol, 0)), "all pairs")}${kc("Open interest", big(HL.rows.reduce((a, r) => a + r.oi, 0)), "all pairs")}${kc("Active signals", liquid.filter((r) => r.sig !== "NEUTRAL").length, "top 100 by volume")}</div>`;
    const cards = hot.map((r) => `<div class="stile" data-sym="${esc(r.s)}" style="background:rgba(${r.score >= 0 ? "47,210,122" : "255,77,77"},.1)"><div class="n"><span>${esc(r.s)}</span><span class="${sigc(r.sig)}">${r.sig}</span></div><div class="a">${px(r.p)}</div><div class="d">${ps(r.chg)} · funding ${r.fa.toFixed(0)}% ann.<br>${esc(r.tags.join(" · ") || "momentum")}</div></div>`).join("") || '<span class="st">no strong setups right now</span>';
    const chip = (k, v, l) => `<span class="chip${HL[k] === v ? " on" : ""}" data-sf="${k}:${v}">${l}</span>`;
    let rows = HL.rows.filter((r) => (HL.cls === "all" || (HL.cls === "crypto" ? !r.dex : !!r.dex)) && (!q || r.s.toUpperCase().includes(q)) && (HL.sig === "all" || (HL.sig === "buy" && r.sig.includes("BUY")) || (HL.sig === "sell" && r.sig.includes("SELL")) || (HL.sig === "strong" && r.sig.startsWith("STRONG"))));
    const key = HL.sk, d = HL.sd; rows = rows.sort((a, b) => key === "s" ? d * a.s.localeCompare(b.s) : d * (a[key] - b[key]));
    const cols = [["s", "Pair"], ["score", "Signal"], [null, "Flags"], ["p", "Price"], ["chg", "24h"], ["vol", "Vol 24h"], ["oi", "OI"], ["oid", "OI Δ (session)"], ["fa", "Funding ann."], ["vo", "Vol/OI"]];
    const th = cols.map(([k, l]) => `<th ${k ? `data-ss="${k}"` : ""} class="${k === key ? "on" : ""}">${l}${k === key ? (d < 0 ? " ▼" : " ▲") : ""}</th>`).join("");
    const tr = rows.slice(0, 200).map((r) => `<tr class="cr"${M.px[r.s] ? ` data-sym="${esc(r.s)}"` : ""}><td><span class="star" data-star="${esc(r.s)}">${star(r.s)}</span> <b>${esc(r.s)}</b>${r.dex ? "" : '<span class="st">-PERP</span>'}</td><td class="${sigc(r.sig)}"><b>${r.sig}</b></td><td class="st" style="text-align:left">${esc(r.tags.join(" · "))}</td><td>${px(r.p)}</td><td>${ps(r.chg)}</td><td>${big(r.vol)}</td><td>${big(r.oi)}</td><td>${ps(r.oid)}</td><td class="${r.fa > 40 ? "dn" : r.fa < -10 ? "up" : ""}">${r.fa >= 0 ? "+" : ""}${r.fa.toFixed(1)}%</td><td>${r.vo.toFixed(2)}</td></tr>`).join("");
    const keep = document.activeElement?.id === "scq", sc = $("s-scr").querySelector(".tw")?.scrollTop || 0;
    $("s-scr").innerHTML = panel("Hyperliquid perp screener", "live from Hyperliquid · refreshes every 5s · click a row for its chart (Binance-listed coins)", `${kpi}<div class="wh2">Hot right now</div><div class="tiles" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">${cards}</div><div class="bar" style="margin-top:12px">${chip("sig", "all", "All")}${chip("sig", "buy", "Buy")}${chip("sig", "sell", "Sell")}${chip("sig", "strong", "Strong only")}<span class="st">|</span>${chip("cls", "all", "All markets")}${chip("cls", "crypto", "Crypto perps")}${chip("cls", "dex", "HIP-3 (stocks, commodities, FX)")}<input id="scq" value="${esc(HL.q)}" placeholder="Search pair…" autocomplete="off" spellcheck="false" style="background:#0b0b0b;border:1px solid var(--line);color:var(--fg);padding:6px 8px;font:inherit;width:160px"></div><div class="mlegend" style="margin:0 0 8px">Signal = rule-based score of 24h momentum, funding (crowded side fades), and session OI/price flow. It is a screening heuristic, not a prediction or advice. OI Δ counts only since you opened this page.</div><div class="tw" style="max-height:70vh"><table><thead><tr>${th}</tr></thead><tbody>${tr || '<tr><td colspan="10" class="st">'+(HL.rows.length ? "no pairs match this filter" : "loading Hyperliquid…")+'</td></tr>'}</tbody></table></div>`);
    const tw = $("s-scr").querySelector(".tw"); if (tw) tw.scrollTop = sc;
    if (keep) { const i = $("scq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  $("s-scr").onclick = (e) => {
    const sf = e.target.dataset?.sf, ss = e.target.dataset?.ss;
    if (sf) { const [k, v] = sf.split(":"); HL[k] = v; rScr(); } else if (ss) { HL.sd = HL.sk === ss ? -HL.sd : -1; HL.sk = ss; rScr(); }
  };
  $("s-scr").oninput = (e) => { if (e.target.id === "scq") { HL.q = e.target.value; rScr(); } };
  getHL(); setInterval(getHL, 5000);

  // ---------- watchlist ----------
  function rWatch() {
    const now = Date.now(), rows = WLIST.map((s) => {
      const t = M.px[s], f = DV.fund.find((x) => x.s === s), m = MV[s], fl = F[s] ? F[s].b - F[s].s : null, wn = W.filter((w) => w.s === s && now - w.ts < 18e5).reduce((a, w) => a + (w.buy ? w.u : -w.u), 0);
      return `<tr class="cr" data-sym="${esc(s)}"><td><span class="star" data-star="${esc(s)}">★</span> <b>${esc(s)}</b></td><td>${t ? px(t.p) : "-"}</td><td>${ps(t?.ch)}</td><td>${ps(m?.c5m)}</td><td>${fl == null ? "-" : `<span class="${cls(fl)}">${sgb(fl)}</span>`}</td><td>${wn ? `<span class="${cls(wn)}">${sgb(wn)}</span>` : "-"}</td><td>${f ? ps(f.fr, 4) : "-"}</td><td>${DV.oi[s] ? big(DV.oi[s].v) : "-"}</td></tr>`;
    }).join("");
    if (document.activeElement?.id === "wadd") return;
    $("s-watch").innerHTML = panel("My watchlist ★", "saved in this browser · click ★ on any coin to add / remove", `<div class="bar"><input id="wadd" placeholder="Add symbol, e.g. PEPE then Enter" autocomplete="off" spellcheck="false" style="background:var(--panel2);border:1px solid var(--line);color:var(--txt);font:inherit;padding:6px 10px;width:260px"></div><div class="tw"><table><thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>5m</th><th>Live net buying</th><th>Whales 30m</th><th>Funding</th><th>OI</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="st">Nothing here yet. Tap ☆ next to a coin.</td></tr>'}</tbody></table></div>`);
  }
  $("s-watch").addEventListener("keydown", (e) => { if (e.target.id === "wadd" && e.key === "Enter") { const s = e.target.value.trim().toUpperCase(); if (s && !WLIST.includes(s)) { WLIST.push(s); LS.set("watch", WLIST); } e.target.value = ""; e.target.blur(); rWatch(); } });

  // ---------- coin chart ----------
  const CM = document.createElement("div");
  CM.className = "modal"; CM.hidden = true;
  CM.innerHTML = '<div class="mbox"><h3><span id="cmt"></span><span id="cmiv" class="bar" style="padding:0"></span><span class="x" id="cmx">✕</span></h3><canvas id="cmc"></canvas><div class="mlegend" id="cmi"></div></div>';
  document.body.appendChild(CM);
  let cur = null;
  const IVS = [["15m", "15m"], ["1h", "1h"], ["4h", "4h"], ["1d", "1d"]];
  async function openChart(sym, iv = "1h") {
    cur = { sym, iv }; CM.hidden = false;
    $("cmt").textContent = sym + " / USDT";
    $("cmiv").innerHTML = IVS.map(([k, l]) => `<span class="chip${iv === k ? " on" : ""}" data-iv="${k}">${l}</span>`).join("");
    $("cmi").textContent = "loading…";
    let k = null;
    try { k = (await jget(`${BA}/api/v3/klines?symbol=${sym}USDT&interval=${iv}&limit=120`)).map((c) => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], q: +c[7], net: 2 * +c[10] - +c[7] })); } catch (e) { /* not on Binance */ }
    if (!cur || cur.sym !== sym || cur.iv !== iv) return;
    if (!k) { $("cmi").textContent = "No Binance chart for this coin."; clearCanvas(); return; }
    drawChart(k); infoChart(sym, k);
  }
  function clearCanvas() { const c = $("cmc"), g = c.getContext?.("2d"); if (g) g.clearRect(0, 0, c.width, c.height); }
  function drawChart(k) {
    const c = $("cmc"), g = c.getContext?.("2d"); if (!g) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 54, pH = h * 0.68, fTop = pH + 14, fH = h - fTop - 16, bw = (w - pad - 8) / k.length;
    const hi = Math.max(...k.map((x) => x.h)), lo = Math.min(...k.map((x) => x.l)), y = (v) => 8 + (hi - v) / (hi - lo || 1) * (pH - 16), mxn = Math.max(1, ...k.map((x) => Math.abs(x.net)));
    g.clearRect(0, 0, w, h); g.font = "10px ui-monospace,Menlo,monospace"; g.fillStyle = "#7a7a7a"; g.strokeStyle = "#1f1f1f";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, yy = y(v); g.beginPath(); g.moveTo(pad, yy); g.lineTo(w, yy); g.stroke(); g.fillText(px(v).replace("$", ""), 2, yy + 3); }
    const zero = fTop + fH / 2; g.beginPath(); g.moveTo(pad, zero); g.lineTo(w, zero); g.stroke(); g.fillText("net taker flow", 2, fTop + 8);
    k.forEach((x, i) => {
      const xx = pad + i * bw + bw / 2, up = x.c >= x.o, col = up ? "#2fd27a" : "#ff4d4d";
      g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(xx, y(x.h)); g.lineTo(xx, y(x.l)); g.stroke();
      g.fillRect(xx - Math.max(1, bw * 0.35), Math.min(y(x.o), y(x.c)), Math.max(2, bw * 0.7), Math.max(1, Math.abs(y(x.o) - y(x.c))));
      const bh = Math.abs(x.net) / mxn * (fH / 2); g.fillStyle = x.net >= 0 ? "rgba(47,210,122,.7)" : "rgba(255,77,77,.7)"; g.fillRect(xx - Math.max(1, bw * 0.35), x.net >= 0 ? zero - bh : zero, Math.max(2, bw * 0.7), Math.max(1, bh));
    });
    g.fillStyle = "#7a7a7a"; for (const i of [0, Math.floor(k.length / 2), k.length - 1]) { const d = new Date(k[i].t); g.fillText(d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), Math.min(w - 90, pad + i * bw), h - 3); }
  }
  function infoChart(sym, k) {
    const first = k[0].o, last = k[k.length - 1].c, net = k.reduce((a, x) => a + x.net, 0), vol = k.reduce((a, x) => a + x.q, 0), now = Date.now();
    const wn = W.filter((w) => w.s === sym && now - w.ts < 18e5).reduce((a, w) => a + (w.buy ? w.u : -w.u), 0), f = DV.fund.find((x) => x.s === sym), o = DV.oi[sym];
    $("cmi").innerHTML = `Price <b>${px(last)}</b> · range change ${ps((last / first - 1) * 100)} · volume ${big(vol)} · <b>net taker flow ${`<span class="${cls(net)}">${sgb(net)}</span>`}</b> (${net >= 0 ? "buyers aggressive" : "sellers aggressive"})${wn ? ` · whales 30m <span class="${cls(wn)}">${sgb(wn)}</span>` : ""}${f ? ` · funding ${f.fr.toFixed(4)}%` : ""}${o ? ` · OI ${big(o.v)} (${o.c24 >= 0 ? "+" : ""}${o.c24.toFixed(1)}% 24h)` : ""}<br>Bars below candles = net taker buying (green) vs selling (red) per candle, from Binance spot.`;
  }
  CM.onclick = (e) => { if (e.target === CM || e.target.id === "cmx") { CM.hidden = true; cur = null; } const iv = e.target.dataset?.iv; if (iv && cur) openChart(cur.sym, iv); };

  // ---------- global click: star / chart ----------
  document.addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { e.stopPropagation(); const s = st.dataset.star; WLIST = WLIST.includes(s) ? WLIST.filter((x) => x !== s) : [...WLIST, s]; LS.set("watch", WLIST); document.querySelectorAll(`[data-star="${s}"]`).forEach((n) => { n.textContent = star(s); }); if (sub === "watch") rWatch(); return; }
    const r = e.target.closest("[data-sym]"); if (r && !r.closest(".modal")) openChart(r.dataset.sym);
  }, true);

  // ---------- alerts ----------
  const AM = document.createElement("div");
  AM.className = "modal"; AM.hidden = true;
  const fld = (k, l, t = "number") => `<label>${l}<input data-a="${k}" type="${t}"></label>`;
  AM.innerHTML = `<div class="mbox" style="max-width:640px"><h3>ALERTS <span class="x" id="amx">✕</span></h3><div class="mlegend">Alerts work while this page is open in a tab. Settings stay in this browser only.</div><div class="frm">
    <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input data-a="on" type="checkbox"> Alerts ON</label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input data-a="notify" type="checkbox"> Desktop notification</label><label style="flex-direction:row;align-items:center;gap:8px"><input data-a="sound" type="checkbox"> Beep</label>
    ${fld("whale", "Whale trade at least ($)")}${fld("wwhale", "Whale trade on my watchlist coins ($)")}${fld("liq", "Single liquidation at least ($)")}${fld("pump", "Pump / dump move 5m at least (%)")}
    <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input data-a="sector" type="checkbox"> Sector money-flow flips (in to out / out to in)</label>
    ${fld("tgToken", "Telegram bot token (optional)", "password")}${fld("tgChat", "Telegram chat id (optional)", "text")}
    <div class="full mlegend">Telegram: the token is saved only in this browser and sent straight to api.telegram.org. Use a throwaway bot, never your main one.</div>
    <div class="full"><span class="chip" id="atest">Send test alert</span></div></div><div class="wh2">Recent alerts</div><div class="alog" id="alog"></div></div>`;
  document.body.appendChild(AM);
  const bell = $("bell"), logs = [];
  const syncBell = () => bell.classList.toggle("on", !!AL.on);
  const saveAl = () => { LS.set("alerts", AL); syncBell(); };
  AM.querySelectorAll("[data-a]").forEach((i) => { const k = i.dataset.a; if (i.type === "checkbox") i.checked = !!AL[k]; else i.value = AL[k]; });
  AM.onchange = (e) => { const i = e.target, k = i.dataset?.a; if (!k) return; AL[k] = i.type === "checkbox" ? i.checked : i.type === "number" ? +i.value : i.value.trim(); if (k === "on" && AL.on && AL.notify && window.Notification && Notification.permission === "default") Notification.requestPermission(); saveAl(); };
  AM.onclick = (e) => { if (e.target === AM || e.target.id === "amx") AM.hidden = true; if (e.target.id === "atest") fire("🔔 Test alert from SPYDER", "test", 0, true); };
  bell.onclick = () => { AM.hidden = false; renderLog(); };
  syncBell();
  const renderLog = () => { $("alog").innerHTML = logs.slice(0, 30).map((l) => `<div class="wr"><span>${esc(l.msg)}</span><span class="st sp">${ago(l.ts)} ago</span></div>`).join("") || '<div class="st">none yet</div>'; };
  const cool = {};
  function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.18); } catch (e) { /* no audio */ } }
  function fire(msg, key, cd = 6e5, force = false) {
    if (!AL.on && !force) return;
    const now = Date.now(); if (cd && cool[key] && now - cool[key] < cd) return; cool[key] = now;
    logs.unshift({ ts: now, msg }); if (logs.length > 100) logs.length = 100; if (!AM.hidden) renderLog();
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.onclick = () => t.remove(); $("toasts").appendChild(t); setTimeout(() => t.remove(), 9000);
    if (AL.sound) beep();
    if (AL.notify && window.Notification && Notification.permission === "granted") { try { new Notification("SPYDER", { body: msg }); } catch (e) { /* ignore */ } }
    if (AL.tgToken && AL.tgChat) fetch(`https://api.telegram.org/bot${AL.tgToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: AL.tgChat, text: "SPYDER: " + msg }) }).catch(() => {});
  }
  const tw = document.createElement("div"); tw.id = "toasts"; document.body.appendChild(tw);
  let lastW = Date.now(), lastL = Date.now(), secSign = null;
  function checkAlerts() {
    if (!AL.on) { lastW = lastL = Date.now(); return; }
    for (const w of W) { if (w.ts <= lastW) break; if (w.u >= (WLIST.includes(w.s) ? AL.wwhale : AL.whale)) fire(`🐋 ${w.s} whale ${w.buy ? "BUY" : "SELL"} ${big(w.u)} @ ${px(w.p)}`, "w" + w.ts + w.s + w.u, 0); }
    if (W[0]) lastW = Math.max(lastW, W[0].ts);
    for (const x of LQ) { if (x.ts <= lastL) break; if (x.u >= AL.liq) fire(`💥 ${x.s} ${x.long ? "LONG" : "SHORT"} liquidated ${big(x.u)}`, "l" + x.ts + x.s + x.u, 0); }
    if (LQ[0]) lastL = Math.max(lastL, LQ[0].ts);
  }
  function checkMovers() {
    if (!AL.on) return;
    for (const [s, m] of Object.entries(MV)) if (Math.abs(m.c5m) >= AL.pump && m.s5 >= 3) fire(`${m.c5m > 0 ? "🚀 PUMP" : "🔻 DUMP"} ${s} ${m.c5m.toFixed(1)}% in 5m, volume ${m.s5.toFixed(1)}x`, "m" + s, 9e5);
  }
  function checkSectors() {
    if (!M.cats.length) return;
    const cur2 = Object.fromEntries(M.cats.map((c) => [c.id, c.flow >= 0]));
    if (secSign && AL.on && AL.sector) for (const c of M.cats) if (secSign[c.id] != null && secSign[c.id] !== cur2[c.id] && Math.abs(c.ch) >= 1) fire(`🔄 ${c.n} sector money flipped to ${c.flow >= 0 ? "INFLOW" : "OUTFLOW"} (${c.ch.toFixed(1)}%)`, "s" + c.id, 36e5);
    secSign = cur2;
  }

  // ---------- shared helpers for the extra tabs ----------
  const addr = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const usdS = (v) => (v >= 0 ? "+" : "-") + big(Math.abs(v));
  const lazyAt = {};
  const lazy = (k, fn, ms) => { if (Date.now() - (lazyAt[k] || 0) > ms) { lazyAt[k] = Date.now(); fn(); } };
  const inp = "background:#0b0b0b;border:1px solid var(--line);color:var(--fg);padding:6px 8px;font:inherit";

  // ---------- Hyperliquid whales, top traders, vaults, wallet explorer ----------
  const HW = { snap: null, pos: {}, view: "whales", ex: null, exAddr: "", exErr: "" };
  const getSnap = lg(async () => { HW.snap = await jget("/hl-snap.json"); });
  const parsePos = (st) => ({ av: +st.marginSummary.accountValue, ntl: +st.marginSummary.totalNtlPos, wd: +st.withdrawable, list: st.assetPositions.map(({ position: p }) => ({ c: p.coin, sz: +p.szi, entry: +p.entryPx, val: +p.positionValue, upnl: +p.unrealizedPnl, lev: p.leverage?.value, liq: p.liquidationPx ? +p.liquidationPx : null, roe: +p.returnOnEquity })).filter((x) => x.val > 0) });
  const getWhalePos = lg(async () => {
    if (!HW.snap) return;
    for (const w of HW.snap.whales.slice(0, 40)) { try { HW.pos[w.a] = parsePos(await hlPost({ type: "clearinghouseState", user: w.a })); } catch (e) { /* skip */ } await sleep(120); }
  });
  async function loadWallet(a) {
    HW.exAddr = a; HW.exErr = ""; HW.ex = null; rHlw();
    try { HW.ex = parsePos(await hlPost({ type: "clearinghouseState", user: a })); } catch (e) { HW.exErr = "Could not load this wallet (check the address)."; }
    rHlw();
  }
  const priceOf = (c) => HL.rows.find((r) => r.s === c)?.p;
  function rHlw() {
    if (document.activeElement?.id === "wx" && $("s-hlw").innerHTML) return;
    const S = HW.snap, chip = (v, l) => `<span class="chip${HW.view === v ? " on" : ""}" data-hv="${v}">${l}</span>`;
    let ex = '<div class="st" style="padding:6px 0">Paste any Hyperliquid wallet (0x…) or click a trader below to see its open positions, leverage and liquidation risk.</div>';
    if (HW.exErr) ex = `<div class="dn" style="padding:6px 0">${esc(HW.exErr)}</div>`;
    else if (HW.exAddr && !HW.ex) ex = '<div class="st" style="padding:6px 0">loading wallet…</div>';
    else if (HW.ex) {
      const e = HW.ex, lv = e.av ? e.ntl / e.av : 0, tot = e.list.reduce((a, x) => a + x.upnl, 0);
      ex = `<div class="mk7">${kc("Account value", big(e.av), addr(HW.exAddr))}${kc("Open notional", big(e.ntl), "effective leverage " + lv.toFixed(1) + "x")}${kc("Unrealized PnL", usdS(tot), "", cls(tot))}${kc("Positions", e.list.length, "")}</div><div class="tw" style="margin-top:8px"><table><thead><tr><th>Coin</th><th>Side</th><th>Size $</th><th>Entry</th><th>uPnL</th><th>ROE</th><th>Lev</th><th>Liq px</th><th>To liq</th></tr></thead><tbody>${e.list.sort((a, b) => b.val - a.val).map((x) => { const p = priceOf(x.c), d = x.liq && p ? (x.liq / p - 1) * 100 : null; return `<tr><td><b>${esc(x.c)}</b></td><td class="${x.sz > 0 ? "up" : "dn"}">${x.sz > 0 ? "LONG" : "SHORT"}</td><td>${big(x.val)}</td><td>${px(x.entry)}</td><td class="${cls(x.upnl)}">${usdS(x.upnl)}</td><td>${ps(x.roe * 100, 1)}</td><td>${x.lev ?? "-"}x</td><td>${x.liq ? px(x.liq) : "-"}</td><td class="${d != null && Math.abs(d) < 10 ? "dn" : ""}">${d == null ? "-" : d.toFixed(1) + "%"}</td></tr>`; }).join("") || '<tr><td colspan="9" class="st">no open positions</td></tr>'}</tbody></table></div>`;
    }
    let body = '<div class="st" style="padding:10px">loading Hyperliquid trader snapshot…</div>';
    if (S) {
      const wl = (list) => list.map((w) => { const p = HW.pos[w.a], lg2 = p ? p.list.filter((x) => x.sz > 0).reduce((a, x) => a + x.val, 0) : null, sh = p ? p.list.filter((x) => x.sz < 0).reduce((a, x) => a + x.val, 0) : null; return `<tr class="cr" data-w="${esc(w.a)}"><td style="text-align:left"><b>${esc(w.n || addr(w.a))}</b></td><td>${big(w.av)}</td><td>${ps(w.rm * 100, 1)}</td><td class="${cls(w.pd)}">${usdS(w.pd)}</td><td class="${cls(w.pw)}">${usdS(w.pw)}</td><td class="${cls(w.pm)}">${usdS(w.pm)}</td><td class="${cls(w.pa)}">${usdS(w.pa)}</td><td>${lg2 == null ? "-" : `<span class="up">${big(lg2)}</span> / <span class="dn">${big(sh)}</span>`}</td></tr>`; }).join("");
      const th = '<thead><tr><th style="text-align:left">Trader</th><th>Account</th><th>ROI 30d</th><th>PnL 24h</th><th>PnL 7d</th><th>PnL 30d</th><th>PnL all-time</th><th>Long / Short now</th></tr></thead>';
      if (HW.view === "whales") {
        const agg = {}; let n = 0;
        for (const w of S.whales.slice(0, 40)) { const p = HW.pos[w.a]; if (!p) continue; n++; for (const x of p.list) { const g = agg[x.c] || (agg[x.c] = { c: x.c, l: 0, s: 0, nl: 0, ns: 0 }); if (x.sz > 0) { g.l += x.val; g.nl++; } else { g.s += x.val; g.ns++; } } }
        const rows = Object.values(agg).sort((a, b) => b.l + b.s - (a.l + a.s)).slice(0, 15);
        const tl = rows.reduce((a, g) => a + g.l, 0), ts = rows.reduce((a, g) => a + g.s, 0);
        body = `<div class="wh2" style="margin-top:0">What the ${n} biggest whale accounts hold right now</div><div class="mk7">${kc("Whale longs", big(tl), "top 15 coins", "up")}${kc("Whale shorts", big(ts), "top 15 coins", "dn")}${kc("Net bias", usdS(tl - ts), tl + ts ? (tl / (tl + ts) * 100).toFixed(0) + "% long" : "", cls(tl - ts))}</div><div class="tw" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Coin</th><th>Whale longs</th><th>Whale shorts</th><th>Net</th><th>Long / short wallets</th><th>Bias</th></tr></thead><tbody>${rows.map((g) => `<tr${M.px[g.c] ? ` class="cr" data-sym="${esc(g.c)}"` : ""}><td style="text-align:left"><b>${esc(g.c)}</b></td><td class="up">${big(g.l)}</td><td class="dn">${big(g.s)}</td><td class="${cls(g.l - g.s)}">${usdS(g.l - g.s)}</td><td>${g.nl} / ${g.ns}</td><td>${g.l + g.s ? (g.l / (g.l + g.s) * 100).toFixed(0) : 0}% long</td></tr>`).join("") || '<tr><td colspan="6" class="st">loading positions…</td></tr>'}</tbody></table></div><div class="wh2">Biggest accounts (click a row for positions)</div><div class="tw" style="max-height:60vh"><table>${th}<tbody>${wl(S.whales)}</tbody></table></div>`;
      } else if (HW.view === "top") {
        body = `<div class="wh2" style="margin-top:0">Best 30-day PnL (accounts over $50k with real volume)</div><div class="tw" style="max-height:70vh"><table>${th}<tbody>${wl(S.top)}</tbody></table></div>`;
      } else {
        body = `<div class="wh2" style="margin-top:0">Largest Hyperliquid vaults by TVL (of ${S.vaults.length} shown)</div><div class="tw" style="max-height:70vh"><table><thead><tr><th style="text-align:left">Vault</th><th>TVL</th><th>APR</th><th>PnL 30d</th><th>Age</th><th></th></tr></thead><tbody>${S.vaults.map((v) => `<tr><td style="text-align:left"><b>${esc(v.n)}</b> <span class="st">${esc(addr(v.l))}</span></td><td>${big(v.tvl)}</td><td>${ps(v.apr * 100, 1)}</td><td class="${cls(v.pm)}">${usdS(v.pm)}</td><td class="st">${v.created ? ago(v.created) : "-"}</td><td><a href="https://app.hyperliquid.xyz/vaults/${esc(v.a)}" target="_blank" rel="noopener">open</a></td></tr>`).join("")}</tbody></table></div>`;
      }
    }
    $("s-hlw").innerHTML = panel("Hyperliquid whale tracker", S ? "snapshot " + ago(S.ts) + " old · positions live from Hyperliquid · " + S.count.toLocaleString() + " ranked accounts" : "", `<div class="bar"><input id="wx" value="${esc(HW.exAddr)}" placeholder="Wallet explorer: paste 0x… address then Enter" autocomplete="off" spellcheck="false" style="${inp};width:min(440px,100%)"></div>${ex}`) + panel("Traders & vaults", "public Hyperliquid leaderboard", `<div class="bar">${chip("whales", "Whales")}${chip("top", "Top traders")}${chip("vaults", "Vaults")}</div>${body}`, "margin-top:12px");
  }
  $("s-hlw").onclick = (e) => {
    const v = e.target.dataset?.hv, row = e.target.closest?.("[data-w]");
    if (v) { HW.view = v; rHlw(); } else if (row) { loadWallet(row.dataset.w); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  $("s-hlw").addEventListener("keydown", (e) => { if (e.target.id === "wx" && e.key === "Enter") { const a = e.target.value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) loadWallet(a.toLowerCase()); else { HW.exErr = "That is not a valid 0x wallet address."; HW.exAddr = a; HW.ex = null; e.target.blur(); rHlw(); } } });

  // ---------- Options (Deribit via /api/options) ----------
  const OP = { cur: "BTC", data: {}, dvol: {}, exp: null };
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const expMs = (d) => { const m = /^(\d+)([A-Z]{3})(\d+)$/.exec(d); return m ? Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8) : 0; };
  const getOpt = lg(async () => {
    for (const c of ["BTC", "ETH"]) {
      try { OP.data[c] = await jget("/api/options?c=" + c); } catch (e) { /* keep stale */ }
      try { const n = Date.now(), d = await jget(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${c}&start_timestamp=${n - 30 * 864e5}&end_timestamp=${n}&resolution=86400`); OP.dvol[c] = d.result.data.map((x) => x[4]); } catch (e) { /* optional */ }
    }
  });
  function rOpt() {
    const D2 = OP.data[OP.cur], dv = OP.dvol[OP.cur] || [];
    const chip = (v) => `<span class="chip${OP.cur === v ? " on" : ""}" data-oc="${v}">${v}</span>`;
    if (!D2) { $("s-opt").innerHTML = panel("Options (Deribit)", "", `<div class="bar">${chip("BTC")}${chip("ETH")}</div><div class="st" style="padding:10px">loading options chain…</div>`); return; }
    const ex = D2.ex.slice().sort((a, b) => expMs(a.d) - expMs(b.d)).filter((e) => expMs(e.d) > Date.now()), sp = D2.spot;
    const call = ex.reduce((a, e) => a + e.call, 0), put = ex.reduce((a, e) => a + e.put, 0), sel = ex.find((e) => e.d === OP.exp) || ex.slice().sort((a, b) => b.call + b.put - (a.call + a.put))[0];
    const dnow = dv.at(-1), d7 = dv.length > 7 ? dnow - dv.at(-8) : null;
    const rowsT = ex.map((e) => `<tr class="cr" data-oe="${esc(e.d)}"${e === sel ? ' style="outline:1px solid var(--acc)"' : ""}><td style="text-align:left"><b>${esc(e.d)}</b></td><td>${Math.max(0, Math.round((expMs(e.d) - Date.now()) / 864e5))}d</td><td class="up">${big(e.call * sp)}</td><td class="dn">${big(e.put * sp)}</td><td>${e.call ? (e.put / e.call).toFixed(2) : "-"}</td><td>${px(e.pain)}</td><td>${ps((e.pain / sp - 1) * 100, 1)}</td></tr>`).join("");
    let ladder = "";
    if (sel) { const ks = sel.strikes, mx = Math.max(1, ...ks.map((k) => Math.max(k[1], k[2]))); ladder = `<div class="wh2">Open interest by strike · ${esc(sel.d)} · max pain ${px(sel.pain)} · spot ${px(sp)}</div><div class="tw" style="max-height:50vh"><table><thead><tr><th style="text-align:left">Strike</th><th>Calls</th><th></th><th></th><th>Puts</th></tr></thead><tbody>${ks.map(([k, c, p]) => `<tr${Math.abs(k - sp) < sp * 0.01 ? ' style="background:#1a1408"' : ""}><td style="text-align:left"><b>${px(k)}</b></td><td class="up">${c ? big(c * sp) : "-"}</td><td style="width:22%"><div style="height:8px;background:var(--up,#2fd27a);width:${(c / mx * 100).toFixed(0)}%;margin-left:auto"></div></td><td style="width:22%"><div style="height:8px;background:var(--dn,#ff4d4d);width:${(p / mx * 100).toFixed(0)}%"></div></td><td class="dn">${p ? big(p * sp) : "-"}</td></tr>`).join("")}</tbody></table></div>`; }
    $("s-opt").innerHTML = panel("Options (Deribit)", "open interest, put/call, max pain, DVOL · refreshes every 2 min", `<div class="bar">${chip("BTC")}${chip("ETH")}</div><div class="mk7">${kc("Spot", px(sp), OP.cur)}${kc("Call OI", big(call * sp), "notional", "up")}${kc("Put OI", big(put * sp), "notional", "dn")}${kc("Put / Call", call ? (put / call).toFixed(2) : "-", put / call > 1 ? "hedging heavy" : "call heavy")}${kc("DVOL (implied vol)", dnow ? dnow.toFixed(1) : "-", d7 == null ? "" : (d7 >= 0 ? "+" : "") + d7.toFixed(1) + " vs 7d ago", d7 == null ? "" : d7 >= 0 ? "dn" : "up")}</div><div class="wh2">Expiries (click one for its strike ladder)</div><div class="tw"><table><thead><tr><th style="text-align:left">Expiry</th><th>In</th><th>Call OI</th><th>Put OI</th><th>P/C</th><th>Max pain</th><th>vs spot</th></tr></thead><tbody>${rowsT}</tbody></table></div>${ladder}<div class="mlegend" style="margin-top:8px">Max pain = strike where option buyers lose the most at expiry. A gravity-like level near expiry, not a guarantee. Deribit data via a Worker proxy.</div>`);
  }
  $("s-opt").onclick = (e) => { const c = e.target.dataset?.oc, r = e.target.closest?.("[data-oe]"); if (c) { OP.cur = c; OP.exp = null; rOpt(); } else if (r) { OP.exp = r.dataset.oe; rOpt(); } };

  // ---------- Cycle models (BTC history from Binance: rainbow regression, S2F, MAs) ----------
  const CY = { t: [], p: [], m: null };
  const getCyc = lg(async () => {
    const t = [], p = []; let st = Date.UTC(2017, 7, 17);
    for (let i = 0; i < 8; i++) { const k = await jget(`${BA}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&startTime=${st}`); for (const x of k) { t.push(x[0]); p.push(+x[4]); } if (k.length < 1000) break; st = k.at(-1)[0] + 864e5; }
    if (p.length < 500) throw new Error("short");
    CY.t = t; CY.p = p; CY.m = cycModel(t, p);
  });
  function fit(xs, ys) { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const b = sxy / sxx, a = my - b * mx; let ss = 0; for (let i = 0; i < n; i++) ss += (ys[i] - a - b * xs[i]) ** 2; return { a, b, sd: Math.sqrt(ss / n) }; }
  const GEN = Date.UTC(2009, 0, 3), halv = (blocks) => 50 / 2 ** Math.floor(blocks / 210000);
  function stockFlow(t) { const blocks = (t - GEN) / 864e5 * 144; let stock = 0, left = blocks; for (let e = 0; left > 0; e++) { const n = Math.min(left, 210000); stock += n * 50 / 2 ** e; left -= n; } return stock / (52560 * halv(blocks)); }
  function cycModel(t, p) {
    const lp = p.map((x) => Math.log10(x)), rx = t.map((x) => Math.log((x - GEN) / 864e5)), sx = t.map((x) => Math.log10(stockFlow(x)));
    const R = fit(rx, lp), S = fit(sx, lp), n = p.length;
    const sma = (k) => (n >= k ? p.slice(-k).reduce((a, b) => a + b, 0) / k : null);
    return { R, S, rain: rx.map((x) => R.a + R.b * x), s2f: sx.map((x) => S.a + S.b * x), ma200: sma(200), ma1400: sma(1400), ath: Math.max(...p) };
  }
  const BANDS = [["Fire sale", "#7b1fa2"], ["Buy!", "#1565c0"], ["Accumulate", "#00838f"], ["Still cheap", "#2e7d32"], ["HODL", "#9e9d24"], ["Is this a bubble?", "#f9a825"], ["FOMO intensifies", "#ef6c00"], ["Sell. Seriously, sell!", "#d84315"], ["Max bubble", "#b71c1c"]];
  function rCyc() {
    const m = CY.m;
    if (!m) { $("s-cyc").innerHTML = panel("Cycle models (BTC)", "", '<div class="st" style="padding:10px">loading ~9 years of BTC history…</div>'); return; }
    const n = CY.p.length, price = CY.p[n - 1], fairR = 10 ** m.rain[n - 1], fairS = 10 ** m.s2f[n - 1];
    const z = (Math.log10(price) - m.rain[n - 1]) / m.R.sd, bi = clamp(Math.floor((z + 2.25) / 0.5), 0, 8), band = BANDS[bi];
    const mayer = m.ma200 ? price / m.ma200 : null;
    $("s-cyc").innerHTML = panel("Cycle models (BTC)", "Binance daily closes since 2017 · models are fitted to that history", `<div class="mk7">${kc("BTC price", px(price), "daily close")}${kc("Rainbow band", `<span style="color:${band[1]}">${band[0]}</span>`, "model fair ≈ " + px(fairR))}${kc("Mayer multiple", mayer ? mayer.toFixed(2) : "-", "price / 200-day MA" + (mayer ? (mayer > 2.4 ? " · overheated" : mayer < 0.8 ? " · deep value" : "") : ""), mayer > 2.4 ? "dn" : mayer < 0.8 ? "up" : "")}${kc("200-week MA", m.ma1400 ? px(m.ma1400) : "-", m.ma1400 ? ps((price / m.ma1400 - 1) * 100, 0) + " above" : "")}${kc("Stock-to-flow model", px(fairS), "price / model " + (price / fairS).toFixed(2) + "x")}${kc("From ATH", ps((price / m.ath - 1) * 100, 1), "ATH " + px(m.ath))}</div><canvas id="cycc" style="width:100%;height:340px;margin-top:10px;background:#080808;border:1px solid var(--line)"></canvas><div class="bar" style="font-size:11px"><span><b style="color:#fff">▬</b> price</span><span><b style="color:#4aa3ff">▬</b> rainbow fair value</span><span><b style="color:#b36cff">▬</b> stock-to-flow model</span><span class="st">log scale</span></div><div class="mlegend">Rainbow = log-regression of price vs time with ±σ bands (our own fit, so band edges differ from other sites). S2F is shown for reference: it badly over-predicted after 2021 and is widely criticised. SOPR / NVT / NUPL need paid on-chain data and are not included. Educational only, not advice.</div>`);
    drawCyc();
  }
  function drawCyc() {
    const cv = $("cycc"), m = CY.m; if (!cv || !m) return;
    const ctx = cv.getContext?.("2d"); if (!ctx) return;
    const r = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = cv.clientHeight; cv.width = W * r; cv.height = Hh * r; ctx.scale(r, r);
    const n = CY.p.length, lo = Math.min(...CY.p.map(Math.log10), ...m.rain) - 0.1, hi = Math.max(...CY.p.map(Math.log10), ...m.rain, ...m.s2f) + 0.1;
    const X = (i) => 38 + i / (n - 1) * (W - 46), Y = (v) => Hh - 18 - (v - lo) / (hi - lo) * (Hh - 28);
    ctx.font = "10px monospace"; ctx.fillStyle = "#666"; ctx.strokeStyle = "#1a1a1a";
    for (let v = Math.ceil(lo); v <= hi; v++) { ctx.beginPath(); ctx.moveTo(38, Y(v)); ctx.lineTo(W - 8, Y(v)); ctx.stroke(); ctx.fillText("$" + (10 ** v).toLocaleString(), 2, Y(v) - 2); }
    for (let b = 0; b < 9; b++) { ctx.strokeStyle = BANDS[b][1] + "88"; ctx.beginPath(); m.rain.forEach((v, i) => { const y = Y(v + (b - 4) * 0.5 * m.R.sd); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke(); }
    const line = (arr, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); arr.forEach((v, i) => { const y = Y(v); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke(); ctx.lineWidth = 1; };
    line(m.s2f, "#b36cff", 1); line(m.rain, "#4aa3ff", 1.5); line(CY.p.map(Math.log10), "#ffffff", 1.6);
  }

  // ---------- Macro (Polymarket odds via /api/macro) ----------
  const MC = { rows: [] };
  const getMac = lg(async () => { MC.rows = await jget("/api/macro"); });
  function rMac() {
    const r = MC.rows.map((e) => `<tr><td style="text-align:left;white-space:normal;max-width:380px"><a href="https://polymarket.com/event/${esc(e.slug)}" target="_blank" rel="noopener"><b>${esc(e.t)}</b></a><div class="st">${esc(e.q)}</div></td><td style="text-align:left">${e.o.map(([n, p]) => `<div style="min-width:170px"><span class="${p >= 0.5 ? "up" : "st"}">${esc(n)} ${(p * 100).toFixed(0)}%</span><div style="height:4px;background:#222"><div style="height:4px;width:${(p * 100).toFixed(0)}%;background:${p >= 0.5 ? "#2fd27a" : "#555"}"></div></div></div>`).join("")}</td><td>${big(e.v24)}</td><td>${big(e.liq)}</td><td class="st">${e.end ? esc(e.end.slice(0, 10)) : "-"}</td></tr>`).join("");
    $("s-mac").innerHTML = panel("Macro & event odds (Polymarket)", "most traded prediction markets right now · crowd probability, not a forecast guarantee", `<div class="tw"><table><thead><tr><th style="text-align:left">Event</th><th style="text-align:left">Odds</th><th>Vol 24h</th><th>Liquidity</th><th>Ends</th></tr></thead><tbody>${r || '<tr><td colspan="5" class="st">loading…</td></tr>'}</tbody></table></div>`);
  }

  // ---------- Stablecoin supply (DefiLlama), shown on the Chains & ETF tab ----------
  const STBL = { s: null };
  const getStbl = lg(async () => { const a = await jget("https://stablecoins.llama.fi/stablecoincharts/all"); STBL.s = a.slice(-180).map((x) => x.totalCirculatingUSD.peggedUSD); });
  function stblPanel() {
    const s = STBL.s; if (!s) return "";
    const L = s.at(-1), ch = (d) => (L / s[s.length - 1 - d] - 1) * 100, lo = Math.min(...s), hi = Math.max(...s);
    const pts = s.map((v, i) => `${(i / (s.length - 1) * 300).toFixed(1)},${(38 - (v - lo) / (hi - lo || 1) * 36).toFixed(1)}`).join(" ");
    return panel("Stablecoin supply (dry powder)", "total stablecoins in circulation · rising = fresh cash entering crypto · DefiLlama", `<div class="mk7">${kc("Total supply", big(L), "")}${kc("24h", ps(ch(1), 2), usdS(L - s.at(-2)), cls(ch(1)))}${kc("7d", ps(ch(7), 2), usdS(L - s.at(-8)), cls(ch(7)))}${kc("30d", ps(ch(30), 2), usdS(L - s.at(-31)), cls(ch(30)))}${kc("90d", ps(ch(90), 2), usdS(L - s.at(-91)), cls(ch(90)))}</div><svg viewBox="0 0 300 40" preserveAspectRatio="none" style="width:100%;height:70px;margin-top:8px"><polyline fill="none" stroke="#ff9f1a" stroke-width="1.5" points="${pts}"/></svg><div class="st" style="font-size:10px">last 180 days</div>`, "margin-top:12px");
  }

  // ---------- Liquidation map + cascade (from live whale positions) ----------
  const LM = { coin: "BTC" };
  function rLiq() {
    const agg = {};
    for (const [a, p] of Object.entries(HW.pos)) for (const x of p.list) if (x.liq) { const g = agg[x.c] || (agg[x.c] = { c: x.c, v: 0, rows: [] }); g.v += x.val; g.rows.push({ liq: x.liq, val: x.val, long: x.sz > 0 }); }
    const coins = Object.values(agg).sort((a, b) => b.v - a.v).slice(0, 10), n = Object.keys(HW.pos).length;
    const chips = coins.map((g) => `<span class="chip${LM.coin === g.c ? " on" : ""}" data-lc="${esc(g.c)}">${esc(g.c)}</span>`).join("");
    const g = agg[LM.coin] || coins[0], price = g && priceOf(g.c);
    let body = '<div class="st" style="padding:10px">loading whale positions (takes ~10s)…</div>';
    if (g && price) {
      const B = 30, lo = price * 0.6, hi = price * 1.4, st = (hi - lo) / B, bk = Array.from({ length: B }, (_, i) => ({ p: lo + (i + 0.5) * st, l: 0, s: 0 }));
      for (const r of g.rows) { const i = Math.floor((r.liq - lo) / st); if (i >= 0 && i < B) bk[i][r.long ? "l" : "s"] += r.val; }
      const mx = Math.max(1, ...bk.map((b) => b.l + b.s));
      const cas = [2, 5, 10, 20].map((d) => { const dn = g.rows.filter((r) => r.long && r.liq >= price * (1 - d / 100) && r.liq <= price).reduce((a, r) => a + r.val, 0), up = g.rows.filter((r) => !r.long && r.liq <= price * (1 + d / 100) && r.liq >= price).reduce((a, r) => a + r.val, 0); return [d, dn, up]; });
      body = `<div class="mk7">${kc("Price", px(price), g.c)}${kc("Long liquidations below", big(g.rows.filter((r) => r.long && r.liq < price).reduce((a, r) => a + r.val, 0)), "whale longs at risk", "dn")}${kc("Short liquidations above", big(g.rows.filter((r) => !r.long && r.liq > price).reduce((a, r) => a + r.val, 0)), "whale shorts at risk", "up")}${kc("Positions counted", g.rows.length, "from " + n + " whale wallets")}</div><div class="wh2">Liquidation cascade: notional forced to close if price moves</div><div class="tw"><table><thead><tr><th style="text-align:left">Move</th><th>Price</th><th>Longs liquidated (drop)</th><th>Price</th><th>Shorts liquidated (rise)</th></tr></thead><tbody>${cas.map(([d, dn, up]) => `<tr><td style="text-align:left"><b>±${d}%</b></td><td>${px(price * (1 - d / 100))}</td><td class="dn">${big(dn)}</td><td>${px(price * (1 + d / 100))}</td><td class="up">${big(up)}</td></tr>`).join("")}</tbody></table></div><div class="wh2">Liquidation map: whale liquidation prices (${esc(g.c)})</div><div class="tw" style="max-height:60vh"><table><thead><tr><th style="text-align:left">Price level</th><th>Distance</th><th>Long liq</th><th style="width:35%"></th><th>Short liq</th></tr></thead><tbody>${bk.slice().reverse().map((b) => `<tr${Math.abs(b.p - price) < st / 2 ? ' style="background:#1a1408"' : ""}><td style="text-align:left"><b>${px(b.p)}</b></td><td>${ps((b.p / price - 1) * 100, 1)}</td><td class="dn">${b.l ? big(b.l) : "-"}</td><td><div style="height:8px;background:${b.p < price ? "#ff4d4d" : "#2fd27a"};width:${((b.l + b.s) / mx * 100).toFixed(0)}%"></div></td><td class="up">${b.s ? big(b.s) : "-"}</td></tr>`).join("")}</tbody></table></div>`;
    }
    $("s-liq").innerHTML = panel("Liquidation map & cascade", "built from live positions of the biggest Hyperliquid whales · not the whole market", `<div class="bar">${chips}</div>${body}<div class="mlegend" style="margin-top:8px">This is a partial map: it only counts the ~${n || 40} whale wallets we poll, so real exchange-wide liquidations are larger. Cross-margin liquidation prices are estimates from Hyperliquid. For market-wide forced closes see the Derivatives tab (live Binance liquidations).</div>`);
  }
  $("s-liq").onclick = (e) => { const c = e.target.dataset?.lc; if (c) { LM.coin = c; rLiq(); } };

  // ---------- HYPE buyback fund + HyperEVM DeFi ----------
  const HY = { bal: null, circ: null, hist: LS.get("hypefund", []) };
  const getHype = lg(async () => {
    const st = await hlPost({ type: "spotClearinghouseState", user: "0xfefefefefefefefefefefefefefefefefefefefe" });
    HY.bal = +(st.balances.find((b) => b.coin === "HYPE")?.total || 0);
    try { const d = await hlPost({ type: "tokenDetails", tokenId: "0x0d01dc56dcaaca66ad901c959b4011ec" }); HY.circ = +d.circulatingSupply; } catch (e) { /* optional */ }
    const h = HY.hist, now = Date.now();
    if (!h.length || now - h.at(-1)[0] > 6e5) { h.push([now, HY.bal]); if (h.length > 600) h.shift(); LS.set("hypefund", h); }
  });
  function rHype() {
    const S = HW.snap, p = priceOf("HYPE") || 0, b = HY.bal, h = HY.hist, d0 = h.length > 1 ? b - h[0][1] : null;
    const fund = b == null ? '<div class="st" style="padding:10px">loading…</div>' : `<div class="mk7">${kc("Assistance Fund HYPE", b.toLocaleString(undefined, { maximumFractionDigits: 0 }), "protocol buyback wallet")}${kc("Value", p ? big(b * p) : "-", "HYPE " + (p ? px(p) : "-"))}${kc("% of circulating", HY.circ ? (b / HY.circ * 100).toFixed(2) + "%" : "-", "")}${kc("Added since first seen", d0 == null ? "-" : (d0 >= 0 ? "+" : "") + d0.toLocaleString(undefined, { maximumFractionDigits: 0 }), d0 == null ? "keep the page open / revisit" : "in " + ago(h[0][0]), d0 > 0 ? "up" : "")}</div>`;
    const bridge = S?.defi?.find((x) => x.cat === "Bridge" && /Hyperliquid/.test(x.n));
    const defi = S?.defi ? `<div class="mk7">${kc("DeFi TVL on Hyperliquid", big(S.defi.reduce((a, x) => a + x.tvl, 0)), "top " + S.defi.length + " protocols")}${bridge ? kc("USDC bridge TVL", big(bridge.tvl), "1d " + (bridge.d1 >= 0 ? "+" : "") + bridge.d1.toFixed(2) + "% · 7d " + (bridge.d7 >= 0 ? "+" : "") + bridge.d7.toFixed(2) + "% (capital flow in/out)", cls(bridge.d1)) : ""}</div><div class="tw" style="margin-top:8px;max-height:60vh"><table><thead><tr><th style="text-align:left">Protocol</th><th>Category</th><th>TVL</th><th>1d</th><th>7d</th></tr></thead><tbody>${S.defi.map((x) => `<tr><td style="text-align:left"><a href="${esc(x.url || "#")}" target="_blank" rel="noopener"><b>${esc(x.n)}</b></a></td><td class="st">${esc(x.cat || "")}</td><td>${big(x.tvl)}</td><td>${ps(x.d1)}</td><td>${ps(x.d7)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">loading…</div>';
    $("s-hype").innerHTML = panel("HYPE buyback (Assistance Fund)", "Hyperliquid fees buy HYPE into this wallet · balance read live on-chain", fund + '<div class="mlegend" style="margin-top:8px">The fund wallet\'s HYPE balance only grows from buybacks, so its growth is the buyback pace. "Added since first seen" is measured from when this browser first opened the tab.</div>') + panel("HyperEVM / Hyperliquid DeFi & bridge flow", "DefiLlama TVL by protocol · snapshot " + (S ? ago(S.ts) + " old" : ""), defi, "margin-top:12px");
  }

  // ---------- On-chain valuation (MVRV, NUPL, NVT) ----------
  const ON = { d: {}, nvt: null };
  const getOn = lg(async () => {
    for (const a of ["btc", "eth"]) {
      const r = await jget(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${a}&metrics=CapMVRVCur,CapMrktCurUSD&frequency=1d&start_time=${new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)}&page_size=1000`);
      ON.d[a] = r.data.map((x) => ({ mv: +x.CapMVRVCur, mc: +x.CapMrktCurUSD }));
    }
    try { const t = await jget("https://api.blockchain.info/charts/estimated-transaction-volume-usd?timespan=120days&format=json&cors=true"), v = t.values.map((x) => x.y).slice(-90); ON.nvt = ON.d.btc.at(-1).mc / (v.reduce((a, b) => a + b, 0) / v.length); } catch (e) { /* optional */ }
  });
  const zone = (n) => (n < 0 ? ["Capitulation", "#7b1fa2"] : n < 0.25 ? ["Hope / fear", "#1565c0"] : n < 0.5 ? ["Optimism", "#2e7d32"] : n < 0.75 ? ["Belief", "#f9a825"] : ["Euphoria / greed", "#d84315"]);
  function rOn() {
    const card = (a, S) => {
      const d = ON.d[a]; if (!d) return "";
      const L = d.at(-1), nupl = 1 - 1 / L.mv, z = zone(nupl), rc = L.mc / L.mv, p = M.px[S]?.p, spark = d.slice(-365).map((x) => x.mv), lo = Math.min(...spark), hi = Math.max(...spark);
      const pts = spark.map((v, i) => `${(i / (spark.length - 1) * 300).toFixed(1)},${(38 - (v - lo) / (hi - lo || 1) * 36).toFixed(1)}`).join(" ");
      return `<div class="wh2">${S}</div><div class="mk7">${kc("MVRV", L.mv.toFixed(2), L.mv > 3.2 ? "historically overheated" : L.mv < 1 ? "below realized value (cheap)" : "market cap / realized cap")}${kc("NUPL", nupl.toFixed(2), `<span style="color:${z[1]}">${z[0]}</span>`)}${kc("Realized cap", big(rc), "avg on-chain cost basis")}${kc("Realized price", p ? px(p / L.mv) : "-", p ? "price is " + ((L.mv - 1) * 100).toFixed(0) + "% above" : "")}${a === "btc" && ON.nvt ? kc("NVT (90d)", ON.nvt.toFixed(0), ON.nvt > 150 ? "expensive vs network use" : ON.nvt < 50 ? "cheap vs network use" : "market cap / tx volume") : ""}</div><svg viewBox="0 0 300 40" preserveAspectRatio="none" style="width:100%;height:60px;margin-top:6px"><polyline fill="none" stroke="#ff9f1a" stroke-width="1.5" points="${pts}"/></svg><div class="st" style="font-size:10px">MVRV, last 12 months</div>`;
    };
    $("s-onc").innerHTML = panel("On-chain valuation", "Coin Metrics community data (daily) · NUPL = 1 − 1/MVRV · NVT = market cap / 90d avg on-chain USD volume", (ON.d.btc ? card("btc", "BTC") + card("eth", "ETH") : '<div class="st" style="padding:10px">loading…</div>') + '<div class="mlegend" style="margin-top:8px">SOPR needs per-coin spent-output data that is not free, so it is not shown. Valuation indicators are context, not timing signals. Not advice.</div>');
  }

  // ---------- Trade journal (stored only in this browser) ----------
  const JR = { list: LS.get("journal", []), msg: "" };
  const jsave = () => LS.set("journal", JR.list);
  const jpnl = (t) => (t.exit / t.entry - 1) * (t.side === "SHORT" ? -1 : 1) * t.size - (t.fee || 0);
  function rJrn() {
    const L = JR.list.slice().sort((a, b) => a.ts - b.ts), pn = L.map(jpnl), tot = pn.reduce((a, b) => a + b, 0), win = pn.filter((v) => v > 0), los = pn.filter((v) => v < 0);
    let eq = 0, peak = 0, dd = 0; const curve = pn.map((v) => (eq += v, peak = Math.max(peak, eq), dd = Math.min(dd, eq - peak), eq));
    const pf = los.length ? win.reduce((a, b) => a + b, 0) / Math.abs(los.reduce((a, b) => a + b, 0)) : null;
    const mn = Math.min(0, ...curve), mxv = Math.max(0, ...curve), pts = curve.map((v, i) => `${(curve.length > 1 ? i / (curve.length - 1) * 300 : 150).toFixed(1)},${(38 - (v - mn) / (mxv - mn || 1) * 36).toFixed(1)}`).join(" ");
    const f = (id, ph, w) => `<input id="${id}" placeholder="${ph}" autocomplete="off" style="${inp};width:${w}px">`;
    $("s-jrn").innerHTML = panel("Trade journal", "saved only in this browser (localStorage) · nothing is uploaded", `<div class="bar">${f("jsym", "Symbol e.g. BTC", 110)}<select id="jside" style="${inp}"><option>LONG</option><option>SHORT</option></select>${f("jen", "Entry price", 100)}${f("jex", "Exit price", 100)}${f("jsz", "Size $ notional", 120)}${f("jfee", "Fees $ (opt.)", 100)}${f("jnote", "Note", 160)}<span class="chip on" data-j="add">Add trade</span></div><div class="bar"><textarea id="jcsv" rows="2" placeholder="Or paste CSV rows: symbol,side,entry,exit,size[,fees[,note]]  (one trade per line)" style="${inp};width:min(520px,100%)"></textarea><span class="chip" data-j="csv">Import CSV</span><span class="chip" data-j="clear">Clear all</span><span class="st">${esc(JR.msg)}</span></div><div class="mk7">${kc("Trades", L.length, "")}${kc("Net PnL", usdS(tot), "after fees", cls(tot))}${kc("Win rate", L.length ? (win.length / L.length * 100).toFixed(0) + "%" : "-", win.length + "W / " + los.length + "L")}${kc("Profit factor", pf == null ? "-" : pf.toFixed(2), "gross win / gross loss")}${kc("Avg win / loss", win.length || los.length ? `${big(win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0)} / ${big(los.length ? Math.abs(los.reduce((a, b) => a + b, 0) / los.length) : 0)}` : "-", "")}${kc("Max drawdown", big(Math.abs(dd)), "on closed trades", dd < 0 ? "dn" : "")}</div>${curve.length > 1 ? `<svg viewBox="0 0 300 40" preserveAspectRatio="none" style="width:100%;height:70px;margin-top:8px"><polyline fill="none" stroke="#ff9f1a" stroke-width="1.5" points="${pts}"/></svg><div class="st" style="font-size:10px">equity curve (closed trades)</div>` : ""}<div class="tw" style="margin-top:8px;max-height:50vh"><table><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Size</th><th>PnL</th><th style="text-align:left">Note</th><th></th></tr></thead><tbody>${L.slice().reverse().map((t) => `<tr><td class="st" style="text-align:left">${new Date(t.ts).toISOString().slice(0, 10)}</td><td style="text-align:left"><b>${esc(t.sym)}</b></td><td class="${t.side === "LONG" ? "up" : "dn"}">${t.side}</td><td>${px(t.entry)}</td><td>${px(t.exit)}</td><td>${big(t.size)}</td><td class="${cls(jpnl(t))}">${usdS(jpnl(t))}</td><td class="st" style="text-align:left">${esc(t.note || "")}</td><td><span class="chip" data-jd="${t.id}">✕</span></td></tr>`).join("") || '<tr><td colspan="9" class="st">no trades yet</td></tr>'}</tbody></table></div>`);
  }
  $("s-jrn").onclick = (e) => {
    const j = e.target.dataset?.j, jd = e.target.dataset?.jd, v = (id) => $(id)?.value.trim() || "";
    if (jd) { JR.list = JR.list.filter((t) => String(t.id) !== jd); jsave(); rJrn(); return; }
    if (j === "add") {
      const t = { id: Date.now() + Math.random(), ts: Date.now(), sym: v("jsym").toUpperCase(), side: $("jside").value, entry: +v("jen"), exit: +v("jex"), size: +v("jsz"), fee: +v("jfee") || 0, note: v("jnote") };
      if (!t.sym || !(t.entry > 0) || !(t.exit > 0) || !(t.size > 0)) { JR.msg = "Fill symbol, entry, exit and size."; rJrn(); return; }
      JR.list.push(t); JR.msg = ""; jsave(); rJrn();
    } else if (j === "csv") {
      let n = 0;
      for (const ln of v("jcsv").split("\n")) { const c = ln.split(",").map((x) => x.trim()); const t = { id: Date.now() + Math.random(), ts: Date.now() + n, sym: (c[0] || "").toUpperCase(), side: /s/i.test(c[1] || "") ? "SHORT" : "LONG", entry: +c[2], exit: +c[3], size: +c[4], fee: +c[5] || 0, note: c[6] || "" }; if (t.sym && t.entry > 0 && t.exit > 0 && t.size > 0) { JR.list.push(t); n++; } }
      JR.msg = n + " trades imported"; jsave(); rJrn();
    } else if (j === "clear" && confirm("Delete all journal trades?")) { JR.list = []; jsave(); rJrn(); }
  };

  // ---------- Ask (rule-based questions over the screener data, no external AI) ----------
  const AK = { q: "" };
  const ASKS = ["Top gainers", "Biggest losers", "Negative funding", "Top volume", "Most volatile", "Cheap coins", "Funding arbitrage", "Highest open interest", "Strong buy", "Stocks"];
  function askRows(q) {
    const t = q.toLowerCase(), R = HL.rows.filter((r) => !r.dex && r.vol > 2e5), top = (a, f, n = 15) => a.slice().sort(f).slice(0, n);
    if (/stock|equit|commodit|forex|fx|hip/.test(t)) return ["HIP-3 markets by volume", top(HL.rows.filter((r) => r.dex), (a, b) => b.vol - a.vol)];
    if (/negative funding/.test(t)) return ["Most negative funding (shorts pay longs)", top(R.filter((r) => r.fa < 0), (a, b) => a.fa - b.fa)];
    if (/arbitrage/.test(t)) return ["Largest funding gaps (cash-and-carry candidates)", top(R.filter((r) => r.vol > 1e6), (a, b) => Math.abs(b.fa) - Math.abs(a.fa))];
    if (/funding/.test(t)) return ["Highest funding (crowded longs)", top(R, (a, b) => b.fa - a.fa)];
    if (/gain|pump|up/.test(t)) return ["Top gainers 24h", top(R, (a, b) => b.chg - a.chg)];
    if (/lose|dump|down/.test(t)) return ["Biggest losers 24h", top(R, (a, b) => a.chg - b.chg)];
    if (/volat/.test(t)) return ["Most volatile (24h move, vol > $1M)", top(R.filter((r) => r.vol > 1e6), (a, b) => Math.abs(b.chg) - Math.abs(a.chg))];
    if (/cheap|low price/.test(t)) return ["Cheap coins (price under $0.10, by volume)", top(R.filter((r) => r.p < 0.1), (a, b) => b.vol - a.vol)];
    if (/open interest|\boi\b/.test(t)) return ["Highest open interest", top(R, (a, b) => b.oi - a.oi)];
    if (/strong|buy|bull/.test(t)) return ["Buy signals (screener score)", top(R.filter((r) => r.sig.includes("BUY")), (a, b) => b.score - a.score)];
    if (/sell|bear/.test(t)) return ["Sell signals (screener score)", top(R.filter((r) => r.sig.includes("SELL")), (a, b) => a.score - b.score)];
    if (/volume|liquid/.test(t)) return ["Top volume", top(R, (a, b) => b.vol - a.vol)];
    const w = q.toUpperCase().split(/[^A-Z0-9:]+/).find((x) => x && HL.rows.some((r) => r.s === x));
    if (w) return ["Summary for " + w, HL.rows.filter((r) => r.s === w)];
    return null;
  }
  function rAsk() {
    const res = AK.q ? askRows(AK.q) : null;
    let out = '<div class="st" style="padding:10px">Pick a question above or type a coin / question (e.g. "BTC", "negative funding", "top gainers").</div>';
    if (AK.q && !res) out = '<div class="dn" style="padding:10px">Could not understand that. Try one of the chips or a coin symbol.</div>';
    if (res) out = `<div class="wh2" style="margin-top:0">${esc(res[0])}</div><div class="tw"><table><thead><tr><th style="text-align:left">Pair</th><th>Signal</th><th>Price</th><th>24h</th><th>Vol 24h</th><th>OI</th><th>Funding ann.</th><th style="text-align:left">Flags</th></tr></thead><tbody>${res[1].map((r) => `<tr class="cr"${M.px[r.s] ? ` data-sym="${esc(r.s)}"` : ""}><td style="text-align:left"><b>${esc(r.s)}</b></td><td class="${sigc(r.sig)}">${r.sig}</td><td>${px(r.p)}</td><td>${ps(r.chg)}</td><td>${big(r.vol)}</td><td>${big(r.oi)}</td><td>${r.fa >= 0 ? "+" : ""}${r.fa.toFixed(1)}%</td><td class="st" style="text-align:left">${esc(r.tags.join(" · "))}</td></tr>`).join("") || '<tr><td colspan="8" class="st">nothing matches right now</td></tr>'}</tbody></table></div>`;
    const api = [["/api/options?c=BTC", "Deribit option chain summary (BTC or ETH)"], ["/api/macro", "Polymarket top events and odds"], ["/api/etf", "Spot BTC ETF holdings by issuer"], ["/api/sol-whales", "Recent large Jupiter swaps on Solana"], ["/hl-snap.json", "Hyperliquid top accounts, traders, vaults, DeFi (refreshed every 30 min)"]];
    $("s-ask").innerHTML = panel("Ask the terminal", "rule-based answers from live Hyperliquid data · not an AI model", `<div class="bar">${ASKS.map((a) => `<span class="chip" data-ak="${esc(a)}">${a}</span>`).join("")}</div><div class="bar"><input id="akq" value="${esc(AK.q)}" placeholder="Ask: top gainers, negative funding, BTC …  then Enter" autocomplete="off" spellcheck="false" style="${inp};width:min(520px,100%)"></div>${out}`) + panel("Open data endpoints", "free JSON, no key, cached: use them in your own tools", `<div class="tw"><table><tbody>${api.map(([u, d]) => `<tr><td style="text-align:left"><a href="${u}" target="_blank" rel="noopener"><b>${u}</b></a></td><td class="st" style="text-align:left">${d}</td></tr>`).join("")}</tbody></table></div>`, "margin-top:12px");
  }
  $("s-ask").onclick = (e) => { const a = e.target.dataset?.ak; if (a) { AK.q = a; rAsk(); } };
  $("s-ask").addEventListener("keydown", (e) => { if (e.target.id === "akq" && e.key === "Enter") { AK.q = e.target.value.trim(); rAsk(); } });

  // ---------- lazy loaders for the extra tabs ----------
  const LAZY = {
    hlw: () => { lazy("snap", () => getSnap().then(getWhalePos), 6e5); lazy("wpos", getWhalePos, 6e4); },
    opt: () => lazy("opt", getOpt, 12e4),
    cyc: () => lazy("cyc", getCyc, 36e5),
    mac: () => lazy("mac", getMac, 3e5),
    liq: () => { lazy("snap", () => getSnap().then(getWhalePos), 6e5); lazy("wpos", getWhalePos, 6e4); },
    hype: () => { lazy("snap", () => getSnap().then(getWhalePos), 6e5); lazy("hype", getHype, 12e4); },
    onc: () => lazy("onc", getOn, 36e5),
  };
  setInterval(() => { if (document.body.dataset.v === "mkt") LAZY[sub]?.(); }, 15000);

  // ---------- boot ----------
  getStbl(); setInterval(getStbl, 3600000);
  getFund(); setInterval(getFund, 20000);
  connectL();
  const waitPx = setInterval(() => { if (Object.keys(M.px).length > 50) { clearInterval(waitPx); getOI(); getMov(); setInterval(getOI, 120000); setInterval(() => getMov().then(checkMovers), 45000); } }, 1000);
  getChains(); setInterval(getChains, 900000); getEtf(); setInterval(getEtf, 900000); getSol(); setInterval(getSol, 10000);
  setInterval(() => { checkAlerts(); if (document.body.dataset.v === "mkt" && (sub === "deriv" || sub === "watch")) renderSub(); }, 1000);
  setInterval(checkSectors, 30000);
})();
