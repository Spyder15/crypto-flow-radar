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
  for (const id of ["scr", "deriv", "mov", "chain", "hlw", "liq", "hype", "opt", "onc", "cyc", "mac", "jrn", "ask", "map", "soc", "flow", "lmap", "cmp", "gas", "pf", "fmap", "bas", "sm", "bt", "rules", "multi", "views", "brief", "watch"]) { const d = document.createElement("div"); d.id = "s-" + id; d.hidden = true; wrap.appendChild(d); }
  function show(u) {
    if (u === "views") window.__ls = sub;
    sub = u;
    document.querySelectorAll("#subtabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.u === u));
    for (const id of ["over", "scr", "deriv", "mov", "chain", "hlw", "liq", "hype", "opt", "onc", "cyc", "mac", "jrn", "ask", "map", "soc", "flow", "lmap", "cmp", "gas", "pf", "fmap", "bas", "sm", "bt", "rules", "multi", "views", "brief", "watch"]) $("s-" + id).hidden = id !== u;
    LAZY[u]?.();
    renderSub();
    setHash();
  }
  $("subtabs").onclick = (e) => { const u = e.target.dataset?.u; if (u) show(u); };
  function renderSub() { if ((sub === "jrn" || sub === "ask") && $("s-" + sub).innerHTML) return; ({ scr: rScr, hlw: rHlw, liq: rLiq, hype: rHype, onc: rOn, jrn: rJrn, ask: rAsk, map: rMap, soc: rSoc, flow: rFlow, lmap: rLmap, cmp: rCmp, gas: rGas, pf: rPf, fmap: rFmap, bas: rBas, sm: rSm, bt: rBt, rules: rRules, multi: rMulti, views: rViews, brief: rBrief, opt: rOpt, cyc: rCyc, mac: rMac, deriv: rDeriv, mov: rMov, chain: rChain, watch: rWatch })[sub]?.(); }

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

  const OKX = { ct: {} };
  function connectO() {
    let ws; try { ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public"); } catch (e) { return; }
    jget("/api/okx-inst").then((o) => { for (const k in o) OKX.ct[k] = { v: o[k][0], usd: !!o[k][1] }; }).catch(() => {});
    ws.onopen = () => ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "liquidation-orders", instType: "SWAP" }] }));
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data); if (!d.data) return;
        for (const r of d.data) { const c = OKX.ct[r.instId]; if (!c) continue; for (const x of r.details) LQ.unshift({ s: r.instFamily.split("-")[0], long: x.posSide === "long", u: c.usd ? +x.sz * c.v : +x.sz * c.v * +x.bkPx, ts: +x.ts }); }
        if (LQ.length > 1500) LQ.length = 1500;
      } catch (e) { /* ignore frame */ }
    };
    ws.onclose = () => setTimeout(connectO, 5000); ws.onerror = () => ws.close();
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
      ${panel("Liquidation tape", "live, Binance + OKX futures", `<div class="mlegend" style="margin:6px 0">Last 15 min by coin: ${liqTop.length ? liqTop.map(([s, v]) => `<b>${esc(s)}</b> ${big(v)}`).join(" · ") : "-"}</div><div class="tw" style="max-height:640px">${tape || '<div class="st">waiting for liquidations…</div>'}</div>`)}
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
    $("s-scr").innerHTML = panel("Hyperliquid perp screener", "live from Hyperliquid · refreshes every 5s · click a row for its chart (Binance-listed coins)", `${kpi}<div class="wh2">Hot right now</div><div class="tiles" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">${cards}</div><div class="bar" style="margin-top:12px">${chip("sig", "all", "All")}${chip("sig", "buy", "Buy")}${chip("sig", "sell", "Sell")}${chip("sig", "strong", "Strong only")}<span class="st">|</span>${chip("cls", "all", "All markets")}${chip("cls", "crypto", "Crypto perps")}${chip("cls", "dex", "HIP-3 (stocks, commodities, FX)")}<input id="scq" value="${esc(HL.q)}" placeholder="Search pair…" autocomplete="off" spellcheck="false" style="background:#fff;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 8px;font:inherit;width:160px"></div><div class="mlegend" style="margin:0 0 8px">Signal = rule-based score of 24h momentum, funding (crowded side fades), and session OI/price flow. It is a screening heuristic, not a prediction or advice. OI Δ counts only since you opened this page.</div><div class="tw" style="max-height:70vh"><table><thead><tr>${th}</tr></thead><tbody>${tr || '<tr><td colspan="10" class="st">'+(HL.rows.length ? "no pairs match this filter" : "loading Hyperliquid…")+'</td></tr>'}</tbody></table></div>`);
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
    $("s-watch").innerHTML = panel("My watchlist ★", "saved in this browser · click ★ on any coin to add / remove", `<div class="bar"><input id="wadd" placeholder="Add symbol, e.g. PEPE then Enter" autocomplete="off" spellcheck="false" style="background:var(--panel2);border:1px solid var(--line);color:var(--txt);font:inherit;padding:6px 10px;width:260px"><span class="chip on" data-go="wadd">Search</span></div><div class="tw"><table><thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>5m</th><th>Live net buying</th><th>Whales 30m</th><th>Funding</th><th>OI</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="st">Nothing here yet. Tap ☆ next to a coin.</td></tr>'}</tbody></table></div>`);
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
    g.clearRect(0, 0, w, h); g.font = "10px ui-monospace,Menlo,monospace"; g.fillStyle = "#7b8497"; g.strokeStyle = "#e3e7ee";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, yy = y(v); g.beginPath(); g.moveTo(pad, yy); g.lineTo(w, yy); g.stroke(); g.fillText(px(v).replace("$", ""), 2, yy + 3); }
    const zero = fTop + fH / 2; g.beginPath(); g.moveTo(pad, zero); g.lineTo(w, zero); g.stroke(); g.fillText("net taker flow", 2, fTop + 8);
    k.forEach((x, i) => {
      const xx = pad + i * bw + bw / 2, up = x.c >= x.o, col = up ? "#2fd27a" : "#ff4d4d";
      g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(xx, y(x.h)); g.lineTo(xx, y(x.l)); g.stroke();
      g.fillRect(xx - Math.max(1, bw * 0.35), Math.min(y(x.o), y(x.c)), Math.max(2, bw * 0.7), Math.max(1, Math.abs(y(x.o) - y(x.c))));
      const bh = Math.abs(x.net) / mxn * (fH / 2); g.fillStyle = x.net >= 0 ? "rgba(47,210,122,.7)" : "rgba(255,77,77,.7)"; g.fillRect(xx - Math.max(1, bw * 0.35), x.net >= 0 ? zero - bh : zero, Math.max(2, bw * 0.7), Math.max(1, bh));
    });
    g.fillStyle = "#7b8497"; for (const i of [0, Math.floor(k.length / 2), k.length - 1]) { const d = new Date(k[i].t); g.fillText(d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), Math.min(w - 90, pad + i * bw), h - 3); }
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
    if (AL.notify && window.Notification && Notification.permission === "granted") { try { navigator.serviceWorker?.ready.then((r) => r.showNotification("SPYDER", { body: msg, tag: "spyder" })).catch(() => new Notification("SPYDER", { body: msg })); if (!navigator.serviceWorker) new Notification("SPYDER", { body: msg }); } catch (e) { /* ignore */ } }
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
  const inp = "background:#fff;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 8px;font:inherit";

  // ---------- Hyperliquid whales, top traders, vaults, wallet explorer ----------
  const HW = { snap: null, pos: {}, view: "whales", ex: null, exAddr: "", exErr: "" };
  const getSnap = lg(async () => { HW.snap = await jget("/hl-snap.json"); });
  const parsePos = (st) => ({ av: +st.marginSummary.accountValue, ntl: +st.marginSummary.totalNtlPos, wd: +st.withdrawable, list: st.assetPositions.map(({ position: p }) => ({ c: p.coin, sz: +p.szi, entry: +p.entryPx, val: +p.positionValue, upnl: +p.unrealizedPnl, lev: p.leverage?.value, liq: p.liquidationPx ? +p.liquidationPx : null, roe: +p.returnOnEquity })).filter((x) => x.val > 0) });
  const getWhalePos = lg(async () => {
    if (!HW.snap) return;
    for (const w of HW.snap.whales.slice(0, 40)) { try { HW.pos[w.a] = parsePos(await hlPost({ type: "clearinghouseState", user: w.a })); if (sub === "hlw" || sub === "liq") renderSub(); } catch (e) { /* skip */ } await sleep(120); }
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
    $("s-hlw").innerHTML = panel("Hyperliquid whale tracker", S ? "snapshot " + ago(S.ts) + " old · positions live from Hyperliquid · " + S.count.toLocaleString() + " ranked accounts" : "", `<div class="bar"><input id="wx" value="${esc(HW.exAddr)}" placeholder="Wallet explorer: paste 0x… address then Enter" autocomplete="off" spellcheck="false" style="${inp};width:min(440px,100%)"><span class="chip on" data-go="wx">Search</span></div>${ex}`) + panel("Traders & vaults", "public Hyperliquid leaderboard", `<div class="bar">${chip("whales", "Whales")}${chip("top", "Top traders")}${chip("vaults", "Vaults")}</div>${body}`, "margin-top:12px");
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
    $("s-cyc").innerHTML = panel("Cycle models (BTC)", "Binance daily closes since 2017 · models are fitted to that history", `<div class="mk7">${kc("BTC price", px(price), "daily close")}${kc("Rainbow band", `<span style="color:${band[1]}">${band[0]}</span>`, "model fair ≈ " + px(fairR))}${kc("Mayer multiple", mayer ? mayer.toFixed(2) : "-", "price / 200-day MA" + (mayer ? (mayer > 2.4 ? " · overheated" : mayer < 0.8 ? " · deep value" : "") : ""), mayer > 2.4 ? "dn" : mayer < 0.8 ? "up" : "")}${kc("200-week MA", m.ma1400 ? px(m.ma1400) : "-", m.ma1400 ? ps((price / m.ma1400 - 1) * 100, 0) + " above" : "")}${kc("Stock-to-flow model", px(fairS), "price / model " + (price / fairS).toFixed(2) + "x")}${kc("From ATH", ps((price / m.ath - 1) * 100, 1), "ATH " + px(m.ath))}</div><canvas id="cycc" style="width:100%;height:340px;margin-top:10px;background:var(--panel);border:1px solid var(--line)"></canvas><div class="bar" style="font-size:11px"><span><b style="color:#fff">▬</b> price</span><span><b style="color:#4aa3ff">▬</b> rainbow fair value</span><span><b style="color:#b36cff">▬</b> stock-to-flow model</span><span class="st">log scale</span></div><div class="mlegend">Rainbow = log-regression of price vs time with ±σ bands (our own fit, so band edges differ from other sites). S2F is shown for reference: it badly over-predicted after 2021 and is widely criticised. SOPR / NVT / NUPL need paid on-chain data and are not included. Educational only, not advice.</div>`);
    drawCyc();
  }
  function drawCyc() {
    const cv = $("cycc"), m = CY.m; if (!cv || !m) return;
    const ctx = cv.getContext?.("2d"); if (!ctx) return;
    const r = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = cv.clientHeight; cv.width = W * r; cv.height = Hh * r; ctx.scale(r, r);
    const n = CY.p.length, lo = Math.min(...CY.p.map(Math.log10), ...m.rain) - 0.1, hi = Math.max(...CY.p.map(Math.log10), ...m.rain, ...m.s2f) + 0.1;
    const X = (i) => 38 + i / (n - 1) * (W - 46), Y = (v) => Hh - 18 - (v - lo) / (hi - lo) * (Hh - 28);
    const dk = document.documentElement.dataset.theme === "dark"; ctx.font = "10px monospace"; ctx.fillStyle = "#888"; ctx.strokeStyle = dk ? "#222" : "#e3e6ec";
    for (let v = Math.ceil(lo); v <= hi; v++) { ctx.beginPath(); ctx.moveTo(38, Y(v)); ctx.lineTo(W - 8, Y(v)); ctx.stroke(); ctx.fillText("$" + (10 ** v).toLocaleString(), 2, Y(v) - 2); }
    for (let b = 0; b < 9; b++) { ctx.strokeStyle = BANDS[b][1] + "88"; ctx.beginPath(); m.rain.forEach((v, i) => { const y = Y(v + (b - 4) * 0.5 * m.R.sd); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke(); }
    const line = (arr, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); arr.forEach((v, i) => { const y = Y(v); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }); ctx.stroke(); ctx.lineWidth = 1; };
    line(m.s2f, "#b36cff", 1); line(m.rain, "#4aa3ff", 1.5); line(CY.p.map(Math.log10), dk ? "#e8e8e8" : "#1e2330", 1.6);
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
  const HY = { flow: null, bal: null, circ: null, hist: LS.get("hypefund", []) };
  const getHype = lg(async () => {
    const st = await hlPost({ type: "spotClearinghouseState", user: "0xfefefefefefefefefefefefefefefefefefefefe" });
    HY.bal = +(st.balances.find((b) => b.coin === "HYPE")?.total || 0);
    try { const d = await hlPost({ type: "tokenDetails", tokenId: "0x0d01dc56dcaaca66ad901c959b4011ec" }); HY.circ = +d.circulatingSupply; } catch (e) { /* optional */ }
    try {
      const t = (await (await fetch("https://api.llama.fi/protocol/hyperliquid-bridge")).json()).tvl.slice(-31);
      HY.flow = t.slice(1).map((x, i) => [x.date * 1e3, x.totalLiquidityUSD - t[i].totalLiquidityUSD]);
    } catch (e) { /* optional */ }
    const h = HY.hist, now = Date.now();
    if (!h.length || now - h.at(-1)[0] > 6e5) { h.push([now, HY.bal]); if (h.length > 600) h.shift(); LS.set("hypefund", h); }
  });
  function bflow() {
    const f = HY.flow;
    if (!f) return '<div class="st" style="padding:10px">loading…</div>';
    const mx = Math.max(...f.map((x) => Math.abs(x[1])), 1), sum = (n) => f.slice(-n).reduce((a, x) => a + x[1], 0), sg = (v) => (v >= 0 ? "+" : "-") + big(Math.abs(v));
    return `<div class="mk7">${kc("Net 1d", sg(sum(1)), "latest day", cls(sum(1)))}${kc("Net 7d", sg(sum(7)), "inflow − outflow", cls(sum(7)))}${kc("Net 30d", sg(sum(30)), "inflow − outflow", cls(sum(30)))}</div><div style="display:flex;align-items:center;gap:2px;height:70px;margin-top:8px">${f.map((x) => `<div title="${new Date(x[0]).toLocaleDateString()} ${sg(x[1])}" style="flex:1;height:${Math.max(2, Math.abs(x[1]) / mx * 100)}%;background:${x[1] >= 0 ? "var(--up,#2ecc71)" : "var(--dn,#e74c3c)"};opacity:.85"></div>`).join("")}</div>`;
  }
  function rHype() {
    const S = HW.snap, p = priceOf("HYPE") || 0, b = HY.bal, h = HY.hist, d0 = h.length > 1 ? b - h[0][1] : null;
    const fund = b == null ? '<div class="st" style="padding:10px">loading…</div>' : `<div class="mk7">${kc("Assistance Fund HYPE", b.toLocaleString(undefined, { maximumFractionDigits: 0 }), "protocol buyback wallet")}${kc("Value", p ? big(b * p) : "-", "HYPE " + (p ? px(p) : "-"))}${kc("% of circulating", HY.circ ? (b / HY.circ * 100).toFixed(2) + "%" : "-", "")}${kc("Added since first seen", d0 == null ? "-" : (d0 >= 0 ? "+" : "") + d0.toLocaleString(undefined, { maximumFractionDigits: 0 }), d0 == null ? "keep the page open / revisit" : "in " + ago(h[0][0]), d0 > 0 ? "up" : "")}</div>`;
    const bridge = S?.defi?.find((x) => x.cat === "Bridge" && /Hyperliquid/.test(x.n));
    const defi = S?.defi ? `<div class="mk7">${kc("DeFi TVL on Hyperliquid", big(S.defi.reduce((a, x) => a + x.tvl, 0)), "top " + S.defi.length + " protocols")}${bridge ? kc("USDC bridge TVL", big(bridge.tvl), "1d " + (bridge.d1 >= 0 ? "+" : "") + bridge.d1.toFixed(2) + "% · 7d " + (bridge.d7 >= 0 ? "+" : "") + bridge.d7.toFixed(2) + "% (capital flow in/out)", cls(bridge.d1)) : ""}</div><div class="tw" style="margin-top:8px;max-height:60vh"><table><thead><tr><th style="text-align:left">Protocol</th><th>Category</th><th>TVL</th><th>1d</th><th>7d</th></tr></thead><tbody>${S.defi.map((x) => `<tr><td style="text-align:left"><a href="${esc(x.url || "#")}" target="_blank" rel="noopener"><b>${esc(x.n)}</b></a></td><td class="st">${esc(x.cat || "")}</td><td>${big(x.tvl)}</td><td>${ps(x.d1)}</td><td>${ps(x.d7)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">loading…</div>';
    $("s-hype").innerHTML = panel("HYPE buyback (Assistance Fund)", "Hyperliquid fees buy HYPE into this wallet · balance read live on-chain", fund + '<div class="mlegend" style="margin-top:8px">The fund wallet\'s HYPE balance only grows from buybacks, so its growth is the buyback pace. "Added since first seen" is measured from when this browser first opened the tab.</div>') + panel("Bridge flow (Hyperliquid USDC bridge)", "daily net change in bridge TVL ≈ deposits minus withdrawals, last 30 days", bflow()) + panel("HyperEVM / Hyperliquid DeFi & bridge flow", "DefiLlama TVL by protocol · snapshot " + (S ? ago(S.ts) + " old" : ""), defi, "margin-top:12px");
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
    const part = q.toUpperCase().split(/[^A-Z0-9]+/).filter((x) => x.length >= 2);
    const m = HL.rows.filter((r) => part.some((x) => r.s.toUpperCase().includes(x) || (r.tags || []).some((g) => g.toUpperCase().includes(x))));
    if (m.length) return ['Coins matching "' + q + '"', m.sort((a, b) => b.vol - a.vol).slice(0, 15)];
    if (/ai|agent|meme|l2|defi|gaming|rwa/i.test(q)) return ["Top volume (no category data; showing the most traded perps)", top(R, (a, b) => b.vol - a.vol)];
    return null;
  }
  function rAsk() {
    const res = AK.q ? askRows(AK.q) : null;
    let out = '<div class="st" style="padding:10px">Pick a question above or type a coin / question (e.g. "BTC", "negative funding", "top gainers").</div>';
    if (AK.q && !res) out = '<div class="dn" style="padding:10px">Could not understand that. Try one of the chips or a coin symbol.</div>';
    if (res) out = `<div class="wh2" style="margin-top:0">${esc(res[0])}</div><div class="tw"><table><thead><tr><th style="text-align:left">Pair</th><th>Signal</th><th>Price</th><th>24h</th><th>Vol 24h</th><th>OI</th><th>Funding ann.</th><th style="text-align:left">Flags</th></tr></thead><tbody>${res[1].map((r) => `<tr class="cr"${M.px[r.s] ? ` data-sym="${esc(r.s)}"` : ""}><td style="text-align:left"><b>${esc(r.s)}</b></td><td class="${sigc(r.sig)}">${r.sig}</td><td>${px(r.p)}</td><td>${ps(r.chg)}</td><td>${big(r.vol)}</td><td>${big(r.oi)}</td><td>${r.fa >= 0 ? "+" : ""}${r.fa.toFixed(1)}%</td><td class="st" style="text-align:left">${esc(r.tags.join(" · "))}</td></tr>`).join("") || '<tr><td colspan="8" class="st">nothing matches right now</td></tr>'}</tbody></table></div>`;
    const api = [["/api/options?c=BTC", "Deribit option chain summary (BTC or ETH)"], ["/api/macro", "Polymarket top events and odds"], ["/api/etf", "Spot BTC ETF holdings by issuer"], ["/api/sol-whales", "Recent large Jupiter swaps on Solana"], ["/hl-snap.json", "Hyperliquid top accounts, traders, vaults, DeFi (refreshed every 30 min)"]];
    $("s-ask").innerHTML = panel("Ask the terminal", "rule-based answers from live Hyperliquid data · not an AI model", `<div class="bar">${ASKS.map((a) => `<span class="chip" data-ak="${esc(a)}">${a}</span>`).join("")}</div><div class="bar"><input id="akq" value="${esc(AK.q)}" placeholder="Ask: top gainers, negative funding, BTC …  then Enter" autocomplete="off" spellcheck="false" style="${inp};width:min(520px,100%)"><span class="chip on" data-go="akq">Search</span></div>${out}`) + panel("Open data endpoints", "free JSON, no key, cached: use them in your own tools", `<div class="tw"><table><tbody>${api.map(([u, d]) => `<tr><td style="text-align:left"><a href="${u}" target="_blank" rel="noopener"><b>${u}</b></a></td><td class="st" style="text-align:left">${d}</td></tr>`).join("")}</tbody></table></div>`, "margin-top:12px") + panel("Embed widgets", "put a live table on any site with an iframe (w = gainers | losers | volume | funding)", `<pre class="mlegend" style="white-space:pre-wrap;user-select:all">${esc('<iframe src="' + location.origin + '/embed.html?w=gainers&n=10" width="360" height="380" style="border:0"></iframe>')}</pre><iframe src="/embed.html?w=gainers&n=6" width="360" height="260" style="border:1px solid #e3e7ee;max-width:100%"></iframe>`, "margin-top:12px");
  }
  $("s-ask").onclick = (e) => { const a = e.target.dataset?.ak; if (a) { AK.q = a; rAsk(); } };
  $("s-ask").addEventListener("keydown", (e) => { if (e.target.id === "akq" && e.key === "Enter") { AK.q = e.target.value.trim(); rAsk(); } });

  // ---------- Treemap + chart (Santiment-style) ----------
  const TM = { mode: "c24", n: 50, hide: true, sym: "BTC", rng: 180, k: null, kSym: null };
  const tmCol = (v) => {
    if (v == null || !isFinite(v)) return "#e3e7ee";
    const a = Math.min(1, Math.abs(v) / 10), t = Math.abs(v) < 0.05 ? 0 : 0.18 + a * 0.62;
    return v >= 0 ? `rgba(20,167,108,${t})` : `rgba(229,72,77,${t})`;
  };
  function squarify(items, x, y, w, h, out) {
    if (!items.length) return;
    if (items.length === 1) { out.push({ it: items[0], x, y, w, h }); return; }
    const tot = items.reduce((a, i) => a + i.v, 0), horiz = w >= h, side = horiz ? h : w;
    let row = [], rs = 0, best = Infinity, i = 0;
    for (; i < items.length; i++) {
      const r2 = row.concat(items[i]), s2 = rs + items[i].v, len = s2 / tot * (horiz ? w : h);
      const worst = Math.max(...r2.map((q) => { const l2 = q.v / s2 * side; return Math.max(len / l2, l2 / len); }));
      if (worst > best && row.length) break;
      row = r2; rs = s2; best = worst;
    }
    const len = rs / tot * (horiz ? w : h);
    let o = 0;
    for (const q of row) { const l2 = q.v / rs * side; out.push({ it: q, x: horiz ? x : x + o, y: horiz ? y + o : y, w: horiz ? len : l2, h: horiz ? l2 : len }); o += l2; }
    if (horiz) squarify(items.slice(i), x + len, y, w - len, h, out); else squarify(items.slice(i), x, y + len, w, h - len, out);
  }
  const MODES = { c24: "Price change 24h", c7: "Price change 7d", c1: "Price change 1h", vol: "Volume / market cap" };
  function tmVal(c) { return TM.mode === "c24" ? c.c24 : TM.mode === "c7" ? c.c7 : TM.mode === "c1" ? c.c1 : (c.mc ? c.vol / c.mc * 100 : null); }
  function rMap() {
    const coins = (M.coins || []).filter((c) => c.mc > 0 && (!TM.hide || !STB.test(c.sym))).slice(0, TM.n);
    let tree = '<div class="st" style="padding:14px">loading market caps…</div>';
    if (coins.length) {
      const out = []; squarify(coins.map((c) => ({ c, v: c.mc })), 0, 0, 100, 100, out);
      tree = `<div class="tmap">${out.map(({ it, x, y, w, h }) => { const c = it.c, v = tmVal(c), big_ = w * h > 40, mid = w * h > 8; return `<div class="tmc" data-tm="${esc(c.sym)}" title="${esc(c.name)} · mcap ${big(c.mc)}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;background:${TM.mode === "vol" ? `rgba(86,156,255,${Math.min(0.8, 0.12 + (v || 0) / 40)})` : tmCol(v)}"><b style="font-size:${big_ ? 15 : mid ? 11 : 8}px">${esc(c.sym)}</b>${mid && v != null ? `<span>${TM.mode === "vol" ? v.toFixed(1) : (v >= 0 ? "+" : "") + v.toFixed(2)}%</span>` : ""}</div>`; }).join("")}</div>`;
    }
    const bar = `<div class="bar">${Object.entries(MODES).map(([k, l]) => `<span class="chip${TM.mode === k ? " on" : ""}" data-tmm="${k}">${l}</span>`).join("")}${[30, 50, 100].map((n) => `<span class="chip${TM.n === n ? " on" : ""}" data-tmn="${n}">top ${n}</span>`).join("")}<span class="chip${TM.hide ? " on" : ""}" data-tmh="1">hide stables</span></div>`;
    const legend = '<div class="mlegend">Colour = performance, size = market cap. Click a tile to chart it below. Source: CoinGecko.</div>';
    const c = coins.find((x) => x.sym === TM.sym) || (M.coins || []).find((x) => x.sym === TM.sym);
    const hdr = c ? `<div class="mk7">${kc(esc(c.name) + " (" + esc(c.sym) + ")", "$" + (c.p >= 1 ? c.p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : c.p), "price")}${kc("24h", ps(c.c24), "")}${kc("Market cap", big(c.mc), "rank #" + (c.rank ?? "-"))}${kc("Volume 24h", big(c.vol), "")}</div>` : "";
    const rb = `<div class="bar">${[[30, "30d"], [90, "90d"], [180, "180d"], [365, "1y"]].map(([d, l]) => `<span class="chip${TM.rng === d ? " on" : ""}" data-tmr="${d}">${l}</span>`).join("")}</div>`;
    $("s-map").innerHTML = panel("Market overview · treemap", "top " + TM.n + " by market cap", bar + tree + legend) + panel("Chart · " + esc(TM.sym), "price + volume · Binance daily", hdr + rb + `<div id="tmch">${chartSvg()}</div>`, "margin-top:12px");
  }
  function chartSvg() {
    const k = TM.k;
    if (!k || TM.kSym !== TM.sym + TM.rng) return '<div class="st" style="padding:14px">loading chart…</div>';
    if (!k.length) return '<div class="st" style="padding:14px">no Binance USDT pair for this coin</div>';
    const W_ = 900, H_ = 300, pb = 70, cl = k.map((x) => +x[4]), vo = k.map((x) => +x[7]);
    const lo = Math.min(...cl), hi = Math.max(...cl), vm = Math.max(...vo), n = k.length, bw = W_ / n;
    const X = (i) => (i + 0.5) * bw, Y = (v) => (H_ - pb - 10) - (v - lo) / (hi - lo || 1) * (H_ - pb - 30) + 10;
    const line = cl.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    const area = line + `L${X(n - 1).toFixed(1)} ${H_ - pb}L${X(0).toFixed(1)} ${H_ - pb}Z`;
    const up = cl[n - 1] >= cl[0], col = up ? "#2ecc71" : "#e74c3c";
    const bars = vo.map((v, i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(H_ - v / vm * (pb - 8)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(v / vm * (pb - 8)).toFixed(1)}" fill="${+k[i][4] >= +k[i][1] ? "rgba(20,167,108,.4)" : "rgba(229,72,77,.4)"}"/>`).join("");
    const f = (v) => (v >= 1 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toPrecision(3));
    const d0 = new Date(k[0][0]).toLocaleDateString(), d1 = new Date(k[n - 1][0]).toLocaleDateString();
    return `<svg viewBox="0 0 ${W_} ${H_}" style="width:100%;height:auto;max-height:340px"><path d="${area}" fill="${col}" opacity=".08"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.6"/>${bars}<text x="4" y="12" fill="#8a97a8" font-size="11">${f(hi)}</text><text x="4" y="${H_ - pb - 2}" fill="#8a97a8" font-size="11">${f(lo)}</text><text x="${W_ - 4}" y="${H_ - 2}" fill="#8a97a8" font-size="10" text-anchor="end">${d1}</text><text x="4" y="${H_ - 2}" fill="#8a97a8" font-size="10">${d0}</text></svg>`;
  }
  const getTmK = async () => {
    const key = TM.sym + TM.rng;
    try { TM.k = await jget(`${BA}/api/v3/klines?symbol=${encodeURIComponent(TM.sym)}USDT&interval=1d&limit=${TM.rng}`); } catch (e) { TM.k = []; }
    TM.kSym = key; if (sub === "map") { const e = $("tmch"); if (e) e.innerHTML = chartSvg(); }
  };
  const tmReload = () => { TM.kSym = null; rMap(); getTmK(); };
  $("s-map").onclick = (e) => {
    const t = e.target.closest("[data-tm],[data-tmm],[data-tmn],[data-tmh],[data-tmr]"); if (!t) return;
    const d = t.dataset;
    if (d.tm) { TM.sym = d.tm; tmReload(); $("tmch")?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (d.tmm) TM.mode = d.tmm; if (d.tmn) TM.n = +d.tmn; if (d.tmh) TM.hide = !TM.hide;
    if (d.tmr) { TM.rng = +d.tmr; tmReload(); return; }
    rMap();
  };

  // ---------- Social / trends (free proxies, no Twitter data) ----------
  const SO = { tr: null, cats: null, fh: null };
  const getSoc = lg(async () => {
    const [t, f] = await Promise.allSettled([jget("https://api.coingecko.com/api/v3/search/trending"), jget("https://api.alternative.me/fng/?limit=30")]);
    if (t.status === "fulfilled") { SO.tr = (t.value.coins || []).map((x) => x.item); SO.cats = t.value.categories || []; SO.nft = t.value.nfts || []; }
    if (f.status === "fulfilled") SO.fh = f.value.data.map((x) => +x.value).reverse();
  });
  function rSoc() {
    const f = SO.fh, g = M.g;
    const fng = f ? `<div class="mk7">${kc("Fear & Greed", f.at(-1), f.at(-1) < 25 ? "extreme fear" : f.at(-1) < 45 ? "fear" : f.at(-1) < 55 ? "neutral" : f.at(-1) < 75 ? "greed" : "extreme greed")}${kc("7d ago", f.at(-8) ?? "-", "")}${kc("30d ago", f[0], "")}${g ? kc("BTC dominance", g.market_cap_percentage.btc.toFixed(1) + "%", "ETH " + g.market_cap_percentage.eth.toFixed(1) + "%") : ""}</div><div style="display:flex;align-items:flex-end;gap:2px;height:60px;margin-top:8px">${f.map((v) => `<div title="${v}" style="flex:1;height:${v}%;background:${v < 25 ? "#e74c3c" : v < 45 ? "#e67e22" : v < 55 ? "#8a97a8" : v < 75 ? "#7bd88f" : "#2ecc71"};opacity:.85"></div>`).join("")}</div>` : '<div class="st" style="padding:10px">loading…</div>';
    const tr = SO.tr ? `<div class="tw"><table><thead><tr><th>#</th><th>Coin</th><th>Mcap rank</th><th>Price</th><th>24h</th></tr></thead><tbody>${SO.tr.map((x, i) => { const p = x.data?.price_change_percentage_24h?.usd; return `<tr><td>${i + 1}</td><td style="text-align:left"><img src="${esc(x.thumb)}" width="16" height="16" style="vertical-align:middle;margin-right:6px" alt=""><b>${esc(x.symbol)}</b> <span class="st">${esc(x.name)}</span></td><td>${x.market_cap_rank ?? "-"}</td><td>${typeof x.data?.price === "number" ? "$" + (x.data.price >= 1 ? x.data.price.toFixed(2) : x.data.price.toPrecision(3)) : "-"}</td><td>${ps(p)}</td></tr>`; }).join("")}</tbody></table></div>` : '<div class="st" style="padding:10px">loading…</div>';
    const words = SO.tr ? [...SO.cats.map((c) => [c.name, c.market_cap_1h_change]), ...SO.tr.map((x) => [x.symbol, x.data?.price_change_percentage_24h?.usd])] : [];
    const cloud = words.length ? `<div class="wcl">${words.map(([w, v], i) => `<span style="font-size:${Math.max(11, 22 - i * 0.7)}px;color:${v == null ? "var(--mut)" : v >= 0 ? "#2ecc71" : "#e74c3c"}">${esc(w)}</span>`).join("")}</div>` : "";
    const cats = SO.cats?.length ? `<div class="tw"><table><thead><tr><th>Trending category</th><th>Mcap 1h</th><th>Coins</th></tr></thead><tbody>${SO.cats.map((c) => `<tr><td style="text-align:left"><b>${esc(c.name)}</b></td><td>${ps(c.market_cap_1h_change)}</td><td>${c.coins_count}</td></tr>`).join("")}</tbody></table></div>` : "";
    $("s-soc").innerHTML = panel("Sentiment", "alternative.me Fear & Greed · last 30 days", fng) + panel("Hot trends, 24h", "what people search most on CoinGecko (our free proxy for social buzz)", cloud + '<div class="mlegend">Word size = trend rank, colour = 24h price move. No Twitter/Reddit/AI summary: those need paid APIs.</div>', "margin-top:12px") + panel("Trending coins", "CoinGecko search trending", tr, "margin-top:12px") + (cats ? panel("Trending categories", "narratives getting attention", cats, "margin-top:12px") : "");
  }
  // ---------- shared helpers for the pro tabs ----------
  const pxOf = (s) => M.px[s]?.p ?? priceOf(s) ?? null;
  const fnum = (v, d = 2) => (v == null || !isFinite(v) ? "-" : Math.abs(v) >= 1 ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : v.toPrecision(3));
  const rpc = async (url, method, params = []) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
  const ETH_RPC = "https://ethereum-rpc.publicnode.com", SOL_RPC = "https://solana-rpc.publicnode.com";
  const kl = (s, iv, n) => jget(`${BA}/api/v3/klines?symbol=${encodeURIComponent(s)}USDT&interval=${iv}&limit=${n}`);
  const COLS6 = ["#4aa3ff", "#f59a23", "#b36cff", "#14a76c", "#e5484d", "#00b8d9"];
  const inpS = "background:var(--panel);border:1px solid var(--line);color:var(--txt);padding:6px 10px;font:inherit;border-radius:8px;outline:none";

  // ---------- Orderflow: order book imbalance + CVD ----------
  const FL = { sym: "BTC", book: null, k: null, at: 0 };
  const getFlow = lg(async () => {
    const s = FL.sym;
    const [b, k] = await Promise.all([jget(`${BA}/api/v3/depth?symbol=${encodeURIComponent(s)}USDT&limit=500`), kl(s, "5m", 288)]);
    if (s !== FL.sym) return;
    FL.book = { bids: b.bids.map((x) => [+x[0], +x[1]]), asks: b.asks.map((x) => [+x[0], +x[1]]) };
    FL.k = k.map((x) => ({ t: x[0], o: +x[1], c: +x[4], v: +x[5], tb: +x[9] })); FL.at = Date.now();
  });
  function lineSvg(vals, col, h = 120, zero = false) {
    const W_ = 900, lo = Math.min(...vals), hi = Math.max(...vals), n = vals.length, Y = (v) => h - 8 - (v - lo) / (hi - lo || 1) * (h - 16), X = (i) => i / (n - 1) * W_;
    const d = vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    return `<svg viewBox="0 0 ${W_} ${h}" style="width:100%;height:${h}px"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.6"/>${zero && lo < 0 && hi > 0 ? `<line x1="0" x2="${W_}" y1="${Y(0)}" y2="${Y(0)}" stroke="#9aa3b5" stroke-dasharray="3 3" stroke-width="1"/>` : ""}</svg>`;
  }
  function rFlow() {
    if (document.activeElement?.id === "flq") return;
    const chips = topByVol(12).map((s) => `<span class="chip${FL.sym === s ? " on" : ""}" data-fl="${esc(s)}">${esc(s)}</span>`).join("");
    const bar = `<div class="bar">${chips}<input id="flq" placeholder="any Binance coin + Enter" autocomplete="off" spellcheck="false" style="${inpS};width:190px"><span class="chip on" data-go="flq">Search</span></div>`;
    let body = '<div class="st" style="padding:14px">loading order book…</div>';
    if (FL.book && FL.k) {
      const { bids, asks } = FL.book, mid = (bids[0][0] + asks[0][0]) / 2;
      const within = (arr, p) => arr.filter((x) => Math.abs(x[0] / mid - 1) <= p).reduce((a, x) => a + x[0] * x[1], 0);
      const lv = [0.005, 0.01, 0.02].map((p) => { const b = within(bids, p), a = within(asks, p); return { p, b, a, i: b + a ? (b - a) / (b + a) * 100 : 0 }; });
      const main = lv[1], cum = []; let c = 0; for (const x of FL.k) { c += (2 * x.tb - x.v) * x.c; cum.push(c); }
      const last = FL.k.length - 1, n4 = Math.min(48, last), dP = (FL.k[last].c / FL.k[last - n4].c - 1) * 100, dC = cum[last] - cum[last - n4];
      const sig = dP < -0.2 && dC > 0 ? ["Bullish divergence", "price down but buyers absorbing (CVD up)", "up"] : dP > 0.2 && dC < 0 ? ["Bearish divergence", "price up but sellers dominate (CVD down)", "dn"] : dC > 0 ? ["Buyers in control", "CVD rising with price", "up"] : ["Sellers in control", "CVD falling", "dn"];
      const walls = (arr, col) => arr.slice().sort((a, b) => b[0] * b[1] - a[0] * a[1]).slice(0, 4).map((x) => `<div class="wr"><b style="color:${col}">${fnum(x[0])}</b><span class="st">${((x[0] / mid - 1) * 100).toFixed(2)}%</span><span class="sp">${big(x[0] * x[1])}</span></div>`).join("");
      body = `<div class="mk7">${kc("Mid price", "$" + fnum(mid), "Binance spot")}${kc("Book imbalance ±1%", (main.i >= 0 ? "+" : "") + main.i.toFixed(1) + "%", main.i >= 0 ? "bid-heavy (buy pressure)" : "ask-heavy (sell pressure)", cls(main.i))}${kc("CVD 4h", (dC >= 0 ? "+" : "-") + big(Math.abs(dC)), "taker buy − sell volume", cls(dC))}${kc("Signal", sig[0], sig[1], sig[2])}</div>
      <div class="tw" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Depth</th><th>Bids</th><th>Asks</th><th>Imbalance</th></tr></thead><tbody>${lv.map((x) => `<tr><td style="text-align:left">±${x.p * 100}%</td><td class="up">${big(x.b)}</td><td class="dn">${big(x.a)}</td><td>${ps(x.i, 1)}</td></tr>`).join("")}</tbody></table></div>
      <div class="two" style="margin-top:10px"><div><div class="st">Largest bid walls</div>${walls(bids, "#14a76c")}</div><div><div class="st">Largest ask walls</div>${walls(asks, "#e5484d")}</div></div>
      <div class="st" style="margin-top:12px">Price · last 24h (5m)</div>${lineSvg(FL.k.map((x) => x.c), "#4aa3ff")}<div class="st">Cumulative volume delta · last 24h</div>${lineSvg(cum, dC >= 0 ? "#14a76c" : "#e5484d", 120, true)}`;
    }
    $("s-flow").innerHTML = panel("Orderflow · " + esc(FL.sym), "order-book imbalance + CVD · Binance spot · refreshes every 5s", bar + body + '<div class="mlegend">Imbalance = (bid $ − ask $) / total within the band. CVD = cumulative (taker-buy − taker-sell) volume from 5m candles. A heuristic read, not advice.</div>');
  }
  const setFl = (s) => { FL.sym = s.toUpperCase().replace(/USDT$/, ""); FL.book = FL.k = null; rFlow(); getFlow(); setHash(); };
  $("s-flow").onclick = (e) => { const t = e.target.closest("[data-fl]"); if (t) setFl(t.dataset.fl); };
  $("s-flow").onkeydown = (e) => { if (e.target.id === "flq" && e.key === "Enter" && e.target.value.trim()) setFl(e.target.value.trim()); };

  // ---------- Liquidation heatmap (live Binance futures liquidations) ----------
  const LH = { win: 36e5 };
  function rLmap() {
    const now = Date.now(), L = LQ.filter((x) => now - x.ts < LH.win), N = 12, bw = LH.win / N;
    const tot = {}; for (const x of L) tot[x.s] = (tot[x.s] || 0) + x.u;
    const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 14).map((e) => e[0]);
    const cell = {}; let mx = 1;
    for (const x of L) { const i = Math.min(N - 1, Math.floor((now - x.ts) / bw)), k = x.s + "|" + i, c = cell[k] || (cell[k] = { l: 0, s: 0 }); x.long ? (c.l += x.u) : (c.s += x.u); mx = Math.max(mx, c.l + c.s); }
    const lab = (i) => { const m = Math.round((i + 1) * bw / 6e4); return m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0) + "h" : m + "m"; };
    const head = `<tr><th style="text-align:left">Coin</th>${Array.from({ length: N }, (_, j) => `<th>${lab(N - 1 - j)}</th>`).join("")}<th>Total</th></tr>`;
    const body = rows.map((s) => `<tr><td style="text-align:left"><b>${esc(s)}</b></td>${Array.from({ length: N }, (_, j) => { const c = cell[s + "|" + (N - 1 - j)]; if (!c) return '<td class="lmc"></td>'; const t = c.l + c.s, a = (0.15 + 0.8 * Math.sqrt(t / mx)).toFixed(2); return `<td class="lmc" title="${big(c.l)} long · ${big(c.s)} short liquidated" style="background:${c.l >= c.s ? `rgba(229,72,77,${a})` : `rgba(20,167,108,${a})`}"></td>`; }).join("")}<td>${big(tot[s])}</td></tr>`).join("");
    const lg_ = L.filter((x) => x.long).reduce((a, x) => a + x.u, 0), sh = L.filter((x) => !x.long).reduce((a, x) => a + x.u, 0);
    const wb = `<div class="bar">${[[9e5, "15m"], [36e5, "1h"], [144e5, "4h"]].map(([v, l]) => `<span class="chip${LH.win === v ? " on" : ""}" data-lw="${v}">${l}</span>`).join("")}</div>`;
    $("s-lmap").innerHTML = panel("Liquidation heatmap", "live Binance futures liquidations · columns = minutes ago (right = now)", wb + `<div class="mk7">${kc("Long liquidations", big(lg_), "longs wiped (red)", "dn")}${kc("Short liquidations", big(sh), "shorts wiped (green)", "up")}${kc("Events", L.length, "in window")}</div>` + (rows.length ? `<div class="tw" style="margin-top:8px"><table class="lmt"><thead>${head}</thead><tbody>${body}</tbody></table></div>` : '<div class="st" style="padding:14px">waiting for liquidations…</div>') + '<div class="mlegend">Red cell = mostly longs liquidated, green = mostly shorts. Brighter = bigger. Data starts when you open the page (the exchange stream has no history), so the heatmap fills up over time.</div>');
  }
  $("s-lmap").onclick = (e) => { const t = e.target.closest("[data-lw]"); if (t) { LH.win = +t.dataset.lw; rLmap(); } };

  // ---------- Compare coins + correlation ----------
  const CP = { syms: LS.get("cmp", ["BTC", "ETH", "SOL"]), rng: 90, k: {}, corr: null };
  const getCmp = lg(async () => {
    for (const s of CP.syms) { const key = s + CP.rng; if (!CP.k[key]) { try { CP.k[key] = (await kl(s, "1d", CP.rng)).map((x) => +x[4]); } catch (e) { CP.k[key] = []; } } }
  });
  const getCorr = lg(async () => {
    const syms = topByVol(16), ret = {};
    if (syms.length < 8) { lazyAt.corr = 0; return; }
    await Promise.all(syms.map(async (s) => { try { const c = (await kl(s, "1d", 91)).map((x) => +x[4]); ret[s] = c.slice(1).map((v, i) => Math.log(v / c[i])); } catch (e) { /* skip */ } }));
    const ss = syms.filter((s) => ret[s]?.length > 30), m = {};
    const cor = (a, b) => { const n = Math.min(a.length, b.length), x = a.slice(-n), y = b.slice(-n), mx = x.reduce((p, q) => p + q, 0) / n, my = y.reduce((p, q) => p + q, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy || 1); };
    for (const a of ss) for (const b of ss) m[a + b] = cor(ret[a], ret[b]);
    CP.corr = { ss, m };
  });
  function rCmp() {
    if (document.activeElement?.id === "cmq") return;
    const chips = CP.syms.map((s, i) => `<span class="chip on" data-cx="${esc(s)}" style="background:${COLS6[i % 6]};border-color:${COLS6[i % 6]}">${esc(s)} ✕</span>`).join("");
    const bar = `<div class="bar">${chips}<input id="cmq" placeholder="add coin + Enter (max 6)" autocomplete="off" spellcheck="false" style="${inpS};width:190px"><span class="chip on" data-go="cmq">Search</span>${[[30, "30d"], [90, "90d"], [180, "180d"], [365, "1y"]].map(([d, l]) => `<span class="chip${CP.rng === d ? " on" : ""}" data-cr="${d}">${l}</span>`).join("")}</div>`;
    const ser = CP.syms.map((s, i) => ({ s, c: CP.k[s + CP.rng], col: COLS6[i % 6] })).filter((x) => x.c?.length > 1);
    let chart = '<div class="st" style="padding:14px">loading…</div>';
    if (ser.length) {
      const W_ = 900, H_ = 300, pr = ser.map((x) => x.c.map((v) => (v / x.c[0] - 1) * 100)), lo = Math.min(0, ...pr.flat()), hi = Math.max(0, ...pr.flat()), Y = (v) => H_ - 18 - (v - lo) / (hi - lo || 1) * (H_ - 36) + 6;
      chart = `<svg viewBox="0 0 ${W_} ${H_}" style="width:100%;height:auto;max-height:340px"><line x1="0" x2="${W_}" y1="${Y(0)}" y2="${Y(0)}" stroke="#9aa3b5" stroke-dasharray="3 3"/>${pr.map((p, k) => `<path d="${p.map((v, i) => (i ? "L" : "M") + (i / (p.length - 1) * W_).toFixed(1) + " " + Y(v).toFixed(1)).join("")}" fill="none" stroke="${ser[k].col}" stroke-width="1.8"/>`).join("")}<text x="4" y="12" fill="#7b8497" font-size="11">+${hi.toFixed(0)}%</text><text x="4" y="${H_ - 4}" fill="#7b8497" font-size="11">${lo.toFixed(0)}%</text></svg><div class="mk7">${ser.map((x, k) => kc(esc(x.s), ps(pr[k].at(-1)), "since " + CP.rng + "d start")).join("")}</div>`;
    }
    let hm = '<div class="st" style="padding:14px">loading correlations…</div>';
    if (CP.corr) { const { ss, m } = CP.corr; hm = `<div class="tw"><table class="lmt"><thead><tr><th></th>${ss.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${ss.map((a) => `<tr><td style="text-align:left"><b>${esc(a)}</b></td>${ss.map((b) => { const v = m[a + b]; return `<td class="lmc" style="text-align:center;font-size:10.5px;background:${v >= 0 ? `rgba(20,167,108,${(Math.abs(v) * 0.75).toFixed(2)})` : `rgba(229,72,77,${(Math.abs(v) * 0.75).toFixed(2)})`}">${v.toFixed(2)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`; }
    $("s-cmp").innerHTML = panel("Compare coins", "% change from the start of the period · Binance daily closes", bar + chart) + panel("Correlation heatmap", "daily log-returns, last 90 days, top 16 coins by volume · 1 = move together, −1 = opposite", hm + '<div class="mlegend">Low correlation with BTC = a coin trading on its own story; near 1 = just follows the market.</div>', "margin-top:12px");
  }
  $("s-cmp").onclick = (e) => {
    const t = e.target.closest("[data-cx],[data-cr]"); if (!t) return;
    if (t.dataset.cx) { CP.syms = CP.syms.filter((s) => s !== t.dataset.cx); LS.set("cmp", CP.syms); } else CP.rng = +t.dataset.cr;
    rCmp(); getCmp();
  };
  $("s-cmp").onkeydown = (e) => { if (e.target.id !== "cmq" || e.key !== "Enter") return; const s = e.target.value.trim().toUpperCase().replace(/USDT$/, ""); if (s && !CP.syms.includes(s) && CP.syms.length < 6) { CP.syms.push(s); LS.set("cmp", CP.syms); e.target.value = ""; rCmp(); getCmp(); } };

  // ---------- Network: gas + fees ----------
  const GS = { eth: null, hist: [], btc: null, mp: null, sol: null, h: null, at: 0 };
  const getGas = lg(async () => {
    const [e, b, m, s] = await Promise.allSettled([rpc(ETH_RPC, "eth_gasPrice"), jget("https://mempool.space/api/v1/fees/recommended"), jget("https://mempool.space/api/mempool"), rpc(SOL_RPC, "getRecentPrioritizationFees")]);
    if (e.status === "fulfilled") { GS.eth = parseInt(e.value, 16) / 1e9; GS.hist.push(GS.eth); if (GS.hist.length > 120) GS.hist.shift(); }
    if (b.status === "fulfilled") GS.btc = b.value;
    if (m.status === "fulfilled") GS.mp = m.value;
    if (s.status === "fulfilled") { const f = s.value.map((x) => x.prioritizationFee).sort((a, c) => a - c); GS.sol = { med: f[Math.floor(f.length / 2)] || 0, max: f.at(-1) || 0 }; }
    GS.at = Date.now();
  });
  function rGas() {
    const ep = pxOf("ETH") || 0, sp = pxOf("SOL") || 0, g = GS.eth;
    const eth = g == null ? '<div class="st" style="padding:10px">loading…</div>' : `<div class="mk7">${kc("ETH gas", (g < 1 ? g.toFixed(3) : g.toFixed(2)) + " gwei", g < 5 ? "very cheap" : g < 20 ? "normal" : "busy")}${ep ? kc("ETH transfer", "$" + (21000 * g * 1e-9 * ep).toFixed(3), "21k gas") : ""}${ep ? kc("Uniswap swap", "$" + (150000 * g * 1e-9 * ep).toFixed(2), "~150k gas") : ""}${kc("ETH price", "$" + fnum(ep), "")}</div>${GS.hist.length > 2 ? `<div class="st" style="margin-top:8px">gas this session</div>${lineSvg(GS.hist, "#4aa3ff", 70)}` : ""}`;
    const bt = GS.btc ? `<div class="mk7">${kc("Fastest", GS.btc.fastestFee + " sat/vB", "next block")}${kc("30 min", GS.btc.halfHourFee + " sat/vB", "")}${kc("1 hour", GS.btc.hourFee + " sat/vB", "")}${kc("Economy", GS.btc.economyFee + " sat/vB", "")}${GS.mp ? kc("Mempool", GS.mp.count.toLocaleString() + " tx", (GS.mp.vsize / 1e6).toFixed(1) + " MvB waiting") : ""}</div>` : '<div class="st" style="padding:10px">loading…</div>';
    const so = GS.sol ? `<div class="mk7">${kc("Priority fee (median)", GS.sol.med + " µlamports/CU", "recent slots")}${kc("Priority fee (max)", GS.sol.max.toLocaleString() + " µlamports/CU", "")}${sp ? kc("SOL price", "$" + fnum(sp), "") : ""}</div>` : '<div class="st" style="padding:10px">loading…</div>';
    $("s-gas").innerHTML = panel("Ethereum gas", "public RPC · refreshes every 15s", eth) + panel("Bitcoin fees", "mempool.space", bt, "margin-top:12px") + panel("Solana fees", "public RPC · priority fee over the last slots", so, "margin-top:12px");
  }

  // ---------- Portfolio tracker ----------
  const PF = { h: LS.get("pf", []), w: null, err: "" };
  const pfSave = () => LS.set("pf", PF.h);
  async function pfWallet(a) {
    PF.w = null; PF.err = "";
    try {
      if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
        const [eb, cs, sp] = await Promise.all([rpc(ETH_RPC, "eth_getBalance", [a, "latest"]), hlPost({ type: "clearinghouseState", user: a }).catch(() => null), hlPost({ type: "spotClearinghouseState", user: a }).catch(() => null)]);
        PF.w = { a, kind: "EVM", bal: [{ s: "ETH", n: parseInt(eb, 16) / 1e18 }, ...((sp?.balances || []).map((b) => ({ s: b.coin, n: +b.total })).filter((b) => b.n > 0))], hl: cs ? { av: +cs.marginSummary.accountValue, pos: parsePos(cs).list } : null };
      } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
        const r = await rpc(SOL_RPC, "getBalance", [a]); PF.w = { a, kind: "Solana", bal: [{ s: "SOL", n: r.value / 1e9 }] };
      } else PF.err = "paste an EVM (0x…) or Solana address";
    } catch (e) { PF.err = "lookup failed: " + e.message; }
    rPf();
  }
  function rPf() {
    if (["pfa", "pfn", "pfc", "pfs", "pfw"].includes(document.activeElement?.id)) return;
    const rows = PF.h.map((h, i) => { const p = pxOf(h.s), v = p != null ? p * h.n : null, pnl = v != null && h.cost > 0 ? v - h.cost * h.n : null; return { ...h, i, p, v, pnl }; });
    const tot = rows.reduce((a, r) => a + (r.v || 0), 0), cost = rows.reduce((a, r) => a + (r.cost > 0 && r.v != null ? r.cost * r.n : 0), 0), pnl = rows.reduce((a, r) => a + (r.pnl || 0), 0);
    const form = `<div class="bar"><input id="pfs" placeholder="coin (BTC)" style="${inpS};width:110px"><input id="pfn" placeholder="amount" style="${inpS};width:110px"><input id="pfc" placeholder="avg buy price (optional)" style="${inpS};width:180px"><span class="chip on" data-pf="add">Add holding</span></div>`;
    const tbl = rows.length ? `<div class="tw"><table><thead><tr><th style="text-align:left">Coin</th><th>Amount</th><th>Price</th><th>Value</th><th>Alloc</th><th>PnL</th><th></th></tr></thead><tbody>${rows.sort((a, b) => (b.v || 0) - (a.v || 0)).map((r) => `<tr><td style="text-align:left"><b>${esc(r.s)}</b></td><td>${fnum(r.n, 4)}</td><td>${r.p != null ? "$" + fnum(r.p) : '<span class="st">n/a</span>'}</td><td>${r.v != null ? big(r.v) : "-"}</td><td><div style="display:inline-block;width:60px;height:6px;background:#e8ecf1;border-radius:3px;vertical-align:middle;margin-right:6px"><i style="display:block;height:100%;width:${tot ? (r.v || 0) / tot * 100 : 0}%;background:var(--acc);border-radius:3px"></i></div>${tot ? ((r.v || 0) / tot * 100).toFixed(1) : 0}%</td><td>${r.pnl != null ? `<span class="${cls(r.pnl)}">${r.pnl >= 0 ? "+" : "-"}${big(Math.abs(r.pnl))} (${(r.pnl / (r.cost * r.n) * 100).toFixed(1)}%)</span>` : '<span class="st">-</span>'}</td><td><span class="st" data-pf="del" data-i="${r.i}" style="cursor:pointer">✕</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:12px">No holdings yet: add one above or import from a wallet below.</div>';
    const kp = `<div class="mk7">${kc("Portfolio value", big(tot), rows.length + " holdings")}${kc("Unrealised PnL", cost ? (pnl >= 0 ? "+" : "-") + big(Math.abs(pnl)) : "-", cost ? "on holdings with a buy price" : "add buy prices", cost ? cls(pnl) : "")}${kc("Biggest holding", rows.length ? esc(rows.slice().sort((a, b) => (b.v || 0) - (a.v || 0))[0].s) : "-", "")}</div>`;
    let w = "";
    if (PF.w) { const x = PF.w; w = `<div class="st" style="margin:8px 0">${x.kind} wallet ${esc(x.a.slice(0, 6))}…${esc(x.a.slice(-4))}</div><div class="tw"><table><thead><tr><th style="text-align:left">Token</th><th>Balance</th><th>Value</th></tr></thead><tbody>${x.bal.map((b) => `<tr><td style="text-align:left"><b>${esc(b.s)}</b></td><td>${fnum(b.n, 4)}</td><td>${pxOf(b.s) != null ? big(pxOf(b.s) * b.n) : "-"}</td></tr>`).join("")}</tbody></table></div>${x.hl ? `<div class="mlegend">Hyperliquid perp account: ${big(x.hl.av)} · ${x.hl.pos.length} open positions</div>` : ""}<div class="bar"><span class="chip on" data-pf="imp">Import balances to portfolio</span></div>`; }
    $("s-pf").innerHTML = panel("Portfolio", "saved only in this browser · live prices from Binance", kp + form + tbl) + panel("Wallet lookup", "read-only: paste a public address (EVM incl. Hyperliquid, or Solana). Never enter a seed phrase.", `<div class="bar"><input id="pfw" placeholder="0x… or Solana address" autocomplete="off" spellcheck="false" style="${inpS};width:min(460px,100%)"><span class="chip on" data-pf="look">Look up</span></div>${PF.err ? `<div class="dn">${esc(PF.err)}</div>` : ""}${w}`, "margin-top:12px");
  }
  $("s-pf").onclick = (e) => {
    const t = e.target.closest("[data-pf]"); if (!t) return; const a = t.dataset.pf;
    if (a === "add") { const s = $("pfs").value.trim().toUpperCase(), n = parseFloat($("pfn").value), c = parseFloat($("pfc").value) || 0; if (s && n > 0) { PF.h.push({ s, n, cost: c }); pfSave(); rPf(); } }
    else if (a === "del") { PF.h.splice(+t.dataset.i, 1); pfSave(); rPf(); }
    else if (a === "look") { const v = $("pfw").value.trim(); if (v) pfWallet(v); }
    else if (a === "imp" && PF.w) { for (const b of PF.w.bal) { if (STB.test(b.s) || !(b.n > 0)) continue; const h = PF.h.find((x) => x.s === b.s); h ? (h.n = b.n) : PF.h.push({ s: b.s, n: b.n, cost: 0 }); } pfSave(); rPf(); }
  };

  // ---------- theme, shareable links, notifications ----------
  const setTheme = (t) => { document.documentElement.dataset.theme = t; LS.set("theme", t); const b = $("thm"); if (b) b.textContent = t === "dark" ? "☀ Light" : "☾ Dark"; };
  setTheme(LS.get("theme", "light"));
  $("thm").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  function setHash() { const x = sub === "map" ? TM.sym : sub === "flow" ? FL.sym : ""; try { history.replaceState(null, "", "#" + sub + (x ? "/" + x : "")); } catch (e) { /* file:// etc */ } }
  function fromHash() {
    const hv = location.hash.slice(1);
    if (hv.startsWith("v=")) { try { applyView(JSON.parse(decodeURIComponent(escape(atob(hv.slice(2)))))); } catch (e) { /* bad link */ } return; }
    const [u, s] = decodeURIComponent(hv).split("/");
    if (!u || !$("s-" + u) || !document.querySelector(`#subtabs [data-u="${u}"]`)) return;
    if (s) { const S_ = s.toUpperCase(); if (u === "map") { TM.sym = S_; TM.kSym = null; } if (u === "flow") { FL.sym = S_; FL.book = FL.k = null; } }
    document.body.dataset.v = "mkt"; document.querySelectorAll(".nv").forEach((n) => n.classList.toggle("on", n.dataset.v === "mkt"));
    show(u);
  }
  window.addEventListener("hashchange", fromHash);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/sw.js").catch(() => { /* optional */ });
  setInterval(() => {
    if (document.body.dataset.v !== "mkt" || document.hidden) return;
    if (sub === "flow") { lazy("flow", getFlow, 5e3); }
    else if (sub === "lmap") rLmap();
    else if (sub === "gas") lazy("gas", getGas, 15e3);
    else if (sub === "cmp" && !CP.corr) lazy("corr", getCorr, 3e3);
    else if (sub === "fmap") rFmap();
    else if (sub === "bas") { lazy("bas", getBasis, 6e4); lazy("ls", getLS, 3e5); }
    else if (sub === "sm") { lazy("sm", getSM, 6e4); rSm(); }
    else if (sub === "multi") lazy("mu", getMulti, 3e4);
    else if (sub === "pf") rPf();
  }, 2000);

  // ---------- helpers for the next group of tabs ----------
  const ago_ = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : s < 172800 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
  const sgn = (v) => (v >= 0 ? "+" : "-") + big(Math.abs(v));
  function candles(k, w = 600, h = 240) {
    if (!k?.length) return '<div class="st" style="padding:14px">no data</div>';
    const lo = Math.min(...k.map((x) => +x[3])), hi = Math.max(...k.map((x) => +x[2])), n = k.length, bw = w / n, Y = (v) => 8 + (hi - v) / (hi - lo || 1) * (h - 16);
    const body = k.map((x, i) => { const o = +x[1], c = +x[4], up = c >= o, col = up ? "#14a76c" : "#e5484d", cx = (i + 0.5) * bw; return `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${Y(+x[2]).toFixed(1)}" y2="${Y(+x[3]).toFixed(1)}" stroke="${col}"/><rect x="${(cx - bw * 0.35).toFixed(1)}" y="${Y(Math.max(o, c)).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(1, Math.abs(Y(o) - Y(c))).toFixed(1)}" fill="${col}"/>`; }).join("");
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto"><text x="3" y="11" fill="#7b8497" font-size="10">${fnum(hi)}</text><text x="3" y="${h - 3}" fill="#7b8497" font-size="10">${fnum(lo)}</text>${body}</svg>`;
  }

  // ---------- Funding / OI / change heatmap ----------
  const FM = { m: "fa" };
  function rFmap() {
    const rows = HL.rows.filter((r) => !r.dex && r.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 80);
    const M_ = { fa: ["Funding (annualised)", (r) => r.fa, (v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "%", 60], chg: ["24h change", (r) => r.chg, (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%", 10], oid: ["OI change (session)", (r) => r.oid, (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%", 5], vo: ["Volume / OI", (r) => r.vo * 25, (v) => (v / 25).toFixed(1) + "x", 100] }[FM.m];
    const col = (v) => { const a = Math.min(1, Math.abs(v) / M_[3]), t = (0.12 + a * 0.7).toFixed(2); return FM.m === "fa" ? (v >= 0 ? `rgba(229,72,77,${t})` : `rgba(74,163,255,${t})`) : FM.m === "vo" ? `rgba(245,154,35,${t})` : v >= 0 ? `rgba(20,167,108,${t})` : `rgba(229,72,77,${t})`; };
    const bar = `<div class="bar">${[["fa", "Funding"], ["chg", "24h change"], ["oid", "OI change"], ["vo", "Volume / OI"]].map(([k, l]) => `<span class="chip${FM.m === k ? " on" : ""}" data-fm="${k}">${l}</span>`).join("")}</div>`;
    const grid = rows.length ? `<div class="fgrid">${rows.map((r) => { const v = M_[1](r); return `<div class="fc" data-fs="${esc(r.s)}" title="${esc(r.s)} · OI ${big(r.oi)} · ${r.tags.join(", ")}" style="background:${col(v)}"><b>${esc(r.s)}</b><span>${M_[2](v)}</span><i>${big(r.oi)}</i></div>`; }).join("")}</div>` : '<div class="st" style="padding:14px">loading Hyperliquid data…</div>';
    const ex = rows.slice().sort((a, b) => b.fa - a.fa), lst = (a) => a.slice(0, 5).map((r) => `<div class="wr"><b>${esc(r.s)}</b><span class="${cls(r.fa)}">${r.fa.toFixed(0)}%</span><span class="sp st">OI ${big(r.oi)}</span></div>`).join("");
    $("s-fmap").innerHTML = panel("Funding / OI heatmap", "top 80 Hyperliquid perps by open interest · tile size is equal, click a tile for orderflow · " + M_[0], bar + grid + (FM.m === "fa" && rows.length ? `<div class="two" style="margin-top:10px"><div><div class="st">Most crowded longs (pay funding)</div>${lst(ex)}</div><div><div class="st">Most crowded shorts (get paid)</div>${lst(ex.slice().reverse())}</div></div>` : "") + '<div class="mlegend">Red = longs paying shorts (crowded long, squeeze-down risk). Blue = shorts paying longs (crowded short, squeeze-up risk). Extreme funding is a contrarian warning, not a signal on its own.</div>');
  }
  $("s-fmap").onclick = (e) => { const m = e.target.closest("[data-fm]"); if (m) { FM.m = m.dataset.fm; rFmap(); return; } const t = e.target.closest("[data-fs]"); if (t) { location.hash = "flow/" + t.dataset.fs; } };

  // ---------- Basis, long/short ratios, spot vs perp ----------
  const BS = { fut: null, ls: null, vol: null };
  const getBasis = lg(async () => {
    const [d, t] = await Promise.allSettled([jget("https://dapi.binance.com/dapi/v1/premiumIndex"), jget(FA + "/fapi/v1/ticker/24hr")]);
    if (d.status === "fulfilled") BS.fut = d.value.filter((x) => /_\d{6}$/.test(x.symbol) && /^(BTC|ETH)USD_/.test(x.symbol)).map((x) => { const e = x.symbol.slice(-6), exp = Date.UTC(2000 + +e.slice(0, 2), +e.slice(2, 4) - 1, +e.slice(4, 6), 8), days = (exp - Date.now()) / 864e5, prem = +x.markPrice / +x.indexPrice - 1; return { s: x.symbol, c: x.pair.slice(0, 3), days, prem: prem * 100, apr: days > 0.5 ? prem * 365 / days * 100 : null, mark: +x.markPrice, idx: +x.indexPrice }; }).sort((a, b) => a.c.localeCompare(b.c) || a.days - b.days);
    if (t.status === "fulfilled") BS.vol = t.value.filter((x) => x.symbol.endsWith("USDT") && !x.symbol.includes("_")).map((x) => ({ s: x.symbol.slice(0, -4), pv: +x.quoteVolume })).filter((x) => M.px[x.s]?.q > 0 && !STB.test(x.s)).map((x) => ({ ...x, sv: M.px[x.s].q, r: x.pv / M.px[x.s].q })).sort((a, b) => b.pv - a.pv).slice(0, 25);
  });
  const getLS = lg(async () => {
    const syms = topByVol(12, perps()); if (syms.length < 5) { lazyAt.ls = 0; return; }
    BS.ls = (await Promise.all(syms.map(async (s) => { try { const [a, b] = await Promise.all([jget(`${FA}/futures/data/topLongShortPositionRatio?symbol=${s}USDT&period=1h&limit=24`), jget(`${FA}/futures/data/globalLongShortAccountRatio?symbol=${s}USDT&period=1h&limit=24`)]); return { s, top: +a.at(-1).longAccount * 100, all: +b.at(-1).longAccount * 100, hist: b.map((x) => +x.longShortRatio) }; } catch (e) { return null; } }))).filter(Boolean);
  });
  function rBas() {
    const bt = BS.fut?.length ? `<div class="tw"><table><thead><tr><th style="text-align:left">Contract</th><th>Days left</th><th>Mark</th><th>Index</th><th>Premium</th><th>Annualised basis</th></tr></thead><tbody>${BS.fut.map((x) => `<tr><td style="text-align:left"><b>${esc(x.s)}</b></td><td>${x.days.toFixed(0)}</td><td>${fnum(x.mark)}</td><td>${fnum(x.idx)}</td><td>${ps(x.prem, 2)}</td><td>${x.apr == null ? "-" : ps(x.apr, 1)}</td></tr>`).join("")}</tbody></table></div><div class="mlegend">Basis = futures price above spot, annualised. High basis = leveraged demand (and the cash-and-carry yield); near zero or negative = fear.</div>` : '<div class="st" style="padding:10px">loading…</div>';
    const ls = BS.ls ? `<div class="tw"><table><thead><tr><th style="text-align:left">Coin</th><th>Top traders long</th><th>All accounts long</th><th>Retail vs top</th><th>24h trend (all accts L/S)</th></tr></thead><tbody>${BS.ls.map((x) => { const d = x.all - x.top; return `<tr><td style="text-align:left"><b>${esc(x.s)}</b></td><td>${x.top.toFixed(1)}%</td><td>${x.all.toFixed(1)}%</td><td class="${d >= 0 ? "dn" : "up"}">${d >= 0 ? "retail more long" : "retail more short"} (${d >= 0 ? "+" : ""}${d.toFixed(1)})</td><td style="width:140px">${lineSvg(x.hist, "#4aa3ff", 26)}</td></tr>`; }).join("")}</tbody></table></div><div class="mlegend">Source: Binance futures. Top traders = largest accounts by position size. When retail is far more long than the top traders, the move is often late.</div>` : '<div class="st" style="padding:10px">loading…</div>';
    const sv = BS.vol ? `<div class="tw"><table><thead><tr><th style="text-align:left">Coin</th><th>Perp volume</th><th>Spot volume</th><th>Perp / spot</th><th>Read</th></tr></thead><tbody>${BS.vol.map((x) => `<tr><td style="text-align:left"><b>${esc(x.s)}</b></td><td>${big(x.pv)}</td><td>${big(x.sv)}</td><td>${x.r.toFixed(1)}x</td><td class="${x.r > 6 ? "dn" : x.r < 2 ? "up" : "st"}">${x.r > 6 ? "leverage-driven" : x.r < 2 ? "spot-driven" : "mixed"}</td></tr>`).join("")}</tbody></table></div><div class="mlegend">Binance perp vs spot 24h volume, top 25 perps. Very high perp/spot means price is moved by leverage, so it is fragile.</div>` : '<div class="st" style="padding:10px">loading…</div>';
    $("s-bas").innerHTML = panel("Futures basis", "Binance coin-margined quarterly futures vs index", bt) + panel("Long / short ratio", "Binance top traders vs all accounts, top 12 by volume", ls, "margin-top:12px") + panel("Spot vs perp volume", "who is driving the market", sv, "margin-top:12px");
  }

  // ---------- Smart-money feed (Hyperliquid whale fills) ----------
  const SM = { fills: [], at: 0, min: 25e3 };
  const getSM = lg(async () => {
    if (!HW.snap) await getSnap();
    const ws = (HW.snap?.whales || []).slice(0, 25), out = [];
    await Promise.all(ws.map(async (w, i) => { try { for (const f of (await hlPost({ type: "userFills", user: w.a })).slice(0, 40)) out.push({ a: w.a, rank: i + 1, c: f.coin, d: f.dir, px: +f.px, u: +f.px * +f.sz, t: f.time, pnl: +f.closedPnl }); } catch (e) { /* skip wallet */ } }));
    SM.fills = out.sort((a, b) => b.t - a.t).slice(0, 600); SM.at = Date.now();
  });
  function rSm() {
    const f = SM.fills.filter((x) => x.u >= SM.min), h = f.filter((x) => Date.now() - x.t < 36e5), net = {};
    for (const x of h) { if (/Open Long|Close Short/.test(x.d)) net[x.c] = (net[x.c] || 0) + x.u; else if (/Open Short|Close Long/.test(x.d)) net[x.c] = (net[x.c] || 0) - x.u; }
    const top = Object.entries(net).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    const bar = `<div class="bar">${[1e4, 25e3, 1e5, 5e5].map((v) => `<span class="chip${SM.min === v ? " on" : ""}" data-sm="${v}">≥ ${big(v)}</span>`).join("")}</div>`;
    const kp = `<div class="mk7">${kc("Fills shown", f.length, "top 25 whales, recent")}${kc("Last hour", h.length, "fills ≥ threshold")}${top.slice(0, 2).map(([c, v]) => kc("Net flow " + esc(c), sgn(v), v >= 0 ? "net buying (1h)" : "net selling (1h)", cls(v))).join("")}</div>`;
    const tb = f.length ? `<div class="tw" style="max-height:60vh"><table><thead><tr><th style="text-align:left">When</th><th>Whale</th><th>Coin</th><th>Action</th><th>Size</th><th>Price</th><th>Closed PnL</th></tr></thead><tbody>${f.slice(0, 120).map((x) => `<tr><td style="text-align:left">${ago_(x.t)}</td><td><a href="https://app.hyperliquid.xyz/explorer/address/${esc(x.a)}" target="_blank" rel="noopener">#${x.rank} ${esc(x.a.slice(0, 6))}…</a></td><td><b>${esc(x.c)}</b></td><td class="${/Long/.test(x.d) === /Open/.test(x.d) ? "up" : "dn"}">${esc(x.d)}</td><td>${big(x.u)}</td><td>${fnum(x.px)}</td><td>${x.pnl ? `<span class="${cls(x.pnl)}">${sgn(x.pnl)}</span>` : '<span class="st">-</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<div class="st" style="padding:14px">${SM.at ? "no fills above the threshold" : "loading whale fills…"}</div>`;
    $("s-sm").innerHTML = panel("Smart-money tracker", "live fills of the top Hyperliquid whales · refreshes every minute", bar + kp + tb + '<div class="mlegend">Open Long / Close Short = buying pressure, Open Short / Close Long = selling pressure. Whales hedge and run vaults, so one fill is not a signal; look for several whales on the same side.</div>');
  }
  $("s-sm").onclick = (e) => { const t = e.target.closest("[data-sm]"); if (t) { SM.min = +t.dataset.sm; rSm(); } };

  // ---------- Backtester ----------
  const BT = { s: "BTC", st: "sma", a: 20, b: 50, rng: 730, fee: 0.1, res: null, busy: false };
  const smaA = (c, n) => c.map((_, i) => (i + 1 < n ? null : c.slice(i + 1 - n, i + 1).reduce((a, v) => a + v, 0) / n));
  const rsiA = (c, n = 14) => { const r = c.map(() => null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === n) r[i] = 100 - 100 / (1 + g / (l || 1e-9)); } else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; r[i] = 100 - 100 / (1 + g / (l || 1e-9)); } } return r; };
  const STRATS = { sma: ["SMA cross (fast above slow)", "fast", "slow", 20, 50], rsi: ["RSI dip buy (buy < A, sell > B)", "buy below", "sell above", 30, 55], dch: ["Breakout (N-day high, exit M-day low)", "entry N", "exit M", 20, 10], dip: ["Buy the dip (drop A% in a day, hold B days)", "drop %", "hold days", 5, 5] };
  function runBt(k) {
    const c = k.map((x) => +x[4]), h = k.map((x) => +x[2]), l = k.map((x) => +x[3]), n = c.length, fee = BT.fee / 100, a = BT.a, b = BT.b;
    let pos = false, entry = 0, eq = 1, hold = 0; const curve = [1], trades = [];
    const f1 = smaA(c, a), f2 = smaA(c, b), r = rsiA(c);
    for (let i = 1; i < n; i++) {
      const ret = c[i] / c[i - 1] - 1; if (pos) eq *= 1 + ret;
      let sig = pos;
      if (BT.st === "sma") sig = f1[i - 1] != null && f2[i - 1] != null && f1[i - 1] > f2[i - 1];
      else if (BT.st === "rsi") { if (!pos && r[i - 1] != null && r[i - 1] < a) sig = true; else if (pos && r[i - 1] > b) sig = false; }
      else if (BT.st === "dch") { const hi = i - 1 >= a ? Math.max(...h.slice(i - 1 - a, i - 1)) : Infinity, lo = i - 1 >= b ? Math.min(...l.slice(i - 1 - b, i - 1)) : -Infinity; if (!pos && c[i - 1] > hi) sig = true; else if (pos && c[i - 1] < lo) sig = false; }
      else if (BT.st === "dip") { if (!pos && c[i - 1] / c[i - 2] - 1 < -a / 100) { sig = true; hold = 0; } else if (pos && ++hold >= b) sig = false; }
      if (sig && !pos) { pos = true; entry = eq; eq *= 1 - fee; }
      else if (!sig && pos) { eq *= 1 - fee; trades.push({ t: k[i][0], r: eq / entry - 1 }); pos = false; }
      curve.push(eq);
    }
    if (pos) trades.push({ t: k[n - 1][0], r: eq / entry - 1, open: true });
    let pk = 1, dd = 0; for (const v of curve) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); }
    const dr = curve.slice(1).map((v, i) => v / curve[i] - 1), mu = dr.reduce((p, q) => p + q, 0) / dr.length, sd = Math.sqrt(dr.reduce((p, q) => p + (q - mu) ** 2, 0) / dr.length) || 1e-9;
    const bh = c.map((v) => v / c[0]), wins = trades.filter((t) => t.r > 0);
    return { curve, bh, trades, ret: (eq - 1) * 100, bhRet: (bh.at(-1) - 1) * 100, dd: dd * 100, sharpe: mu / sd * Math.sqrt(365), win: trades.length ? wins.length / trades.length * 100 : 0, avg: trades.length ? trades.reduce((p, q) => p + q.r, 0) / trades.length * 100 : 0, days: n, inMkt: curve.length ? 0 : 0 };
  }
  async function doBt() {
    BT.busy = true; BT.res = null; rBt();
    try {
      let k = await jget(`${BA}/api/v3/klines?symbol=${encodeURIComponent(BT.s)}USDT&interval=1d&limit=1000`); k = k.slice(-BT.rng);
      BT.res = k.length < 60 ? { err: "not enough history for this coin" } : runBt(k);
    } catch (e) { BT.res = { err: "no Binance USDT data for " + BT.s }; }
    BT.busy = false; rBt();
  }
  function rBt() {
    if (["btS", "btA", "btB", "btF"].includes(document.activeElement?.id)) return;
    const st = STRATS[BT.st], r = BT.res;
    const form = `<div class="bar"><input id="btS" value="${esc(BT.s)}" style="${inpS};width:90px"><select id="btT" style="${inpS}">${Object.entries(STRATS).map(([k, v]) => `<option value="${k}"${BT.st === k ? " selected" : ""}>${v[0]}</option>`).join("")}</select><label class="st">${st[1]} <input id="btA" type="number" value="${BT.a}" style="${inpS};width:70px"></label><label class="st">${st[2]} <input id="btB" type="number" value="${BT.b}" style="${inpS};width:70px"></label><select id="btR" style="${inpS}">${[[365, "1 year"], [730, "2 years"], [1000, "~2.7 years (max)"]].map(([v, l]) => `<option value="${v}"${BT.rng === v ? " selected" : ""}>${l}</option>`).join("")}</select><label class="st">fee % <input id="btF" type="number" step="0.01" value="${BT.fee}" style="${inpS};width:70px"></label><span class="chip on" data-bt="run">${BT.busy ? "running…" : "Run backtest"}</span></div>`;
    let out = '<div class="st" style="padding:14px">Pick a coin and a rule, then run. Long-only, daily candles, trades at the next day\'s open-equivalent, fee charged each side.</div>';
    if (r?.err) out = `<div class="dn" style="padding:10px">${esc(r.err)}</div>`;
    else if (r) {
      const W_ = 900, H_ = 240, all = [...r.curve, ...r.bh], lo = Math.min(...all), hi = Math.max(...all), Y = (v) => H_ - 10 - (v - lo) / (hi - lo || 1) * (H_ - 20), P = (a) => a.map((v, i) => (i ? "L" : "M") + (i / (a.length - 1) * W_).toFixed(1) + " " + Y(v).toFixed(1)).join("");
      out = `<div class="mk7">${kc("Strategy return", ps(r.ret, 1), "after fees", "")}${kc("Buy & hold", ps(r.bhRet, 1), "same period")}${kc("Max drawdown", r.dd.toFixed(1) + "%", "strategy", "dn")}${kc("Trades", r.trades.length, "win rate " + r.win.toFixed(0) + "%")}${kc("Avg trade", ps(r.avg, 2), "")}${kc("Sharpe (rough)", r.sharpe.toFixed(2), "annualised")}</div><svg viewBox="0 0 ${W_} ${H_}" style="width:100%;height:auto;margin-top:8px"><path d="${P(r.bh)}" fill="none" stroke="#9aa3b5" stroke-width="1.4"/><path d="${P(r.curve)}" fill="none" stroke="#f59a23" stroke-width="2"/></svg><div class="mlegend"><b style="color:#f59a23">━ strategy</b> &nbsp; <b style="color:#9aa3b5">━ buy &amp; hold</b></div>${r.trades.length ? `<div class="tw" style="max-height:30vh;margin-top:8px"><table><thead><tr><th style="text-align:left">Exit date</th><th>Result</th></tr></thead><tbody>${r.trades.slice(-15).reverse().map((t) => `<tr><td style="text-align:left">${new Date(t.t).toLocaleDateString()}${t.open ? " (open)" : ""}</td><td>${ps(t.r * 100, 1)}</td></tr>`).join("")}</tbody></table></div>` : ""}<div class="mlegend">${r.ret > r.bhRet ? "Beat buy &amp; hold on this sample." : "Did not beat simply holding."} Past results on one coin are not proof: tweaking parameters until it looks good is overfitting. Try other coins and periods before trusting any rule. The Screener signal itself can't be backtested because it needs live Hyperliquid snapshots that have no free history.</div>`;
    }
    $("s-bt").innerHTML = panel("Strategy backtester", "test simple rules on Binance daily history", form + out);
  }
  $("s-bt").onclick = (e) => { if (e.target.closest("[data-bt=run]") && !BT.busy) { BT.s = ($("btS").value.trim().toUpperCase().replace(/USDT$/, "")) || "BTC"; BT.a = +$("btA").value; BT.b = +$("btB").value; BT.rng = +$("btR").value; BT.fee = +$("btF").value || 0; doBt(); } };
  $("s-bt").onchange = (e) => { if (e.target.id === "btT") { BT.st = e.target.value; BT.a = STRATS[BT.st][3]; BT.b = STRATS[BT.st][4]; BT.res = null; rBt(); } };

  // ---------- Custom alert rules ----------
  const RL = { list: LS.get("rules", []), draft: { s: "BTC", m: "price", op: ">", v: "" } };
  const RMET = { price: "Price ($)", chg24: "24h change (%)", c5m: "5m move (%)", fund: "Funding (annualised %)" };
  const rlVal = (r) => { const s = r.s; if (r.m === "price") return pxOf(s); if (r.m === "chg24") return M.px[s]?.ch; if (r.m === "c5m") return MV[s]?.c5m; if (r.m === "fund") { const h = HL.rows.find((x) => x.s === s && !x.dex); if (h) return h.fa; const f = DV.fund.find((x) => x.s === s); return f ? f.fr * 3 * 365 : null; } return null; };
  function evalRules() { for (const r of RL.list) { if (!r.on) continue; const v = rlVal(r); if (v == null || !isFinite(v)) continue; if (r.op === ">" ? v > r.v : v < r.v) { fire(`🔔 ${r.s} ${RMET[r.m].split(" (")[0]} ${r.op} ${r.v} (now ${fnum(v)})`, "rule" + r.id, 18e5, true); if (r.once) r.on = false, LS.set("rules", RL.list); } } }
  function rRules() {
    if (["rls", "rlv"].includes(document.activeElement?.id)) return;
    const d = RL.draft, bar = `<div class="bar"><input id="rls" value="${esc(d.s)}" style="${inpS};width:90px"><select id="rlm" style="${inpS}">${Object.entries(RMET).map(([k, l]) => `<option value="${k}"${d.m === k ? " selected" : ""}>${l}</option>`).join("")}</select><select id="rlo" style="${inpS}"><option${d.op === ">" ? " selected" : ""}>&gt;</option><option${d.op === "<" ? " selected" : ""}>&lt;</option></select><input id="rlv" type="number" step="any" value="${esc(d.v)}" placeholder="value" style="${inpS};width:110px"><label class="st"><input type="checkbox" id="rlon"> once</label><span class="chip on" data-rl="add">Add rule</span></div>`;
    const tb = RL.list.length ? `<div class="tw"><table><thead><tr><th style="text-align:left">Rule</th><th>Now</th><th>Status</th><th></th></tr></thead><tbody>${RL.list.map((r, i) => { const v = rlVal(r); return `<tr><td style="text-align:left"><b>${esc(r.s)}</b> ${esc(RMET[r.m])} ${r.op === ">" ? "&gt;" : "&lt;"} ${r.v}${r.once ? ' <span class="st">(once)</span>' : ""}</td><td>${fnum(v)}</td><td><span class="chip${r.on ? " on" : ""}" data-rl="tg" data-i="${i}">${r.on ? "armed" : "off"}</span></td><td><span class="st" data-rl="del" data-i="${i}" style="cursor:pointer">✕</span></td></tr>`; }).join("")}</tbody></table></div>` : '<div class="st" style="padding:12px">No rules yet. Example: BTC price &gt; 90000, or SOL funding &lt; -30.</div>';
    $("s-rules").innerHTML = panel("Custom alert rules", "checked every 5s while this page is open · fires a toast + browser notification (needs the 🔔 permission)", bar + tb + '<div class="mlegend">Each rule re-fires at most once per 30 minutes. Armed rules are saved in this browser. Browser-closed alerts: see Push below.</div>' + `<div id="pushbox"></div>`);
    pushUi();
  }
  $("s-rules").onclick = (e) => {
    const t = e.target.closest("[data-rl]"); if (!t) return; const a = t.dataset.rl;
    if (a === "add") { const s = $("rls").value.trim().toUpperCase().replace(/USDT$/, ""), v = parseFloat($("rlv").value); if (!s || !isFinite(v)) return; RL.draft = { s, m: $("rlm").value, op: $("rlo").value, v: "" }; RL.list.push({ id: Date.now(), s, m: $("rlm").value, op: $("rlo").value, v, once: $("rlon").checked, on: true }); LS.set("rules", RL.list); rRules(); pushSync(); }
    else if (a === "tg") { const r = RL.list[+t.dataset.i]; r.on = !r.on; LS.set("rules", RL.list); rRules(); pushSync(); }
    else if (a === "del") { RL.list.splice(+t.dataset.i, 1); LS.set("rules", RL.list); rRules(); pushSync(); }
    else if (a === "push") pushToggle();
  };
  setInterval(evalRules, 5000);

  // ---------- Multi-chart ----------
  const MU = { cells: LS.get("multi", [{ s: "BTC", iv: "1h" }, { s: "ETH", iv: "1h" }, { s: "SOL", iv: "4h" }, { s: "BNB", iv: "1d" }]), k: {} };
  const getMulti = lg(async () => { await Promise.all(MU.cells.map(async (c, i) => { try { MU.k[i] = { key: c.s + c.iv, d: await kl(c.s, c.iv, 90) }; } catch (e) { MU.k[i] = { key: c.s + c.iv, d: [] }; } })); });
  function rMulti() {
    if (document.activeElement?.dataset?.mc != null) return;
    $("s-multi").innerHTML = `<div class="mgrid">${MU.cells.map((c, i) => { const k = MU.k[i]?.d, last = k?.at(-1), chg = k?.length ? (+last[4] / +k[0][1] - 1) * 100 : null; return `<section class="panel"><div class="bar" style="padding:0 0 6px"><input data-mc="${i}" value="${esc(c.s)}" style="${inpS};width:80px;font-weight:700"><select data-mi="${i}" style="${inpS}">${["5m", "15m", "1h", "4h", "1d"].map((v) => `<option${c.iv === v ? " selected" : ""}>${v}</option>`).join("")}</select><span class="sp" style="margin-left:auto">${last ? "$" + fnum(+last[4]) + " " : ""}${ps(chg)}</span></div>${k ? candles(k, 600, 230) : '<div class="st" style="padding:14px">loading…</div>'}</section>`; }).join("")}</div><div class="mlegend" style="margin-top:8px">Edit a coin (Binance symbol) and press Enter, or change the interval. Layout is saved in this browser. Last 90 candles each.</div>`;
  }
  $("s-multi").onchange = (e) => { const i = e.target.dataset.mi; if (i != null) { MU.cells[i].iv = e.target.value; LS.set("multi", MU.cells); getMulti(); } };
  $("s-multi").onkeydown = (e) => { const i = e.target.dataset?.mc; if (i != null && e.key === "Enter") { MU.cells[i].s = e.target.value.trim().toUpperCase().replace(/USDT$/, "") || "BTC"; LS.set("multi", MU.cells); e.target.blur(); getMulti(); } };

  // ---------- Saved views ----------
  const VW = { list: LS.get("views", []) };
  const curView = () => ({ sub: sub === "views" ? "over" : sub, tm: TM.sym, fl: FL.sym, cp: CP.syms, mu: MU.cells });
  const viewLink = (v) => location.origin + "/#v=" + btoa(unescape(encodeURIComponent(JSON.stringify(v))));
  function applyView(v) { if (v.tm) { TM.sym = v.tm; TM.kSym = null; } if (v.fl) { FL.sym = v.fl; FL.book = FL.k = null; } if (v.cp) { CP.syms = v.cp; LS.set("cmp", v.cp); } if (v.mu) { MU.cells = v.mu; LS.set("multi", v.mu); MU.k = {}; getMulti(); } show(v.sub || "over"); }
  function rViews() {
    if (document.activeElement?.id === "vwn") return;
    const bar = `<div class="bar"><input id="vwn" placeholder="name this layout" style="${inpS};width:200px" autocomplete="off"><span class="chip on" data-vw="save">Save current tab + coins</span></div>`;
    const tb = VW.list.length ? `<div class="tw"><table><thead><tr><th style="text-align:left">Name</th><th>Opens</th><th></th></tr></thead><tbody>${VW.list.map((x, i) => `<tr><td style="text-align:left"><b>${esc(x.n)}</b></td><td class="st">${esc(x.v.sub)}</td><td><span class="chip on" data-vw="open" data-i="${i}">Open</span> <span class="chip" data-vw="copy" data-i="${i}">Copy link</span> <span class="st" data-vw="del" data-i="${i}" style="cursor:pointer">✕</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="st" style="padding:12px">No saved views. Go to any tab, set up coins, then come back here and save.</div>';
    $("s-views").innerHTML = panel("Saved views", "layouts live in this browser · links carry the layout so you can share them", bar + tb + '<div class="mlegend">A view stores the tab you were on plus the selected coins for Treemap, Orderflow, Compare and Multi-chart. A copied link opens exactly that layout for anyone.</div>');
  }
  $("s-views").onclick = (e) => {
    const t = e.target.closest("[data-vw]"); if (!t) return; const a = t.dataset.vw, i = +t.dataset.i;
    if (a === "save") { const n = $("vwn").value.trim() || "View " + (VW.list.length + 1); VW.list.push({ n, v: { ...curView(), sub: window.__ls || "over" } }); LS.set("views", VW.list); rViews(); }
    else if (a === "open") applyView(VW.list[i].v);
    else if (a === "copy") { const l = viewLink(VW.list[i].v); (navigator.clipboard?.writeText(l) || Promise.reject()).then(() => { t.textContent = "Copied ✓"; }, () => prompt("Copy this link", l)); }
    else if (a === "del") { VW.list.splice(i, 1); LS.set("views", VW.list); rViews(); }
  };

  // ---------- Daily market brief ----------
  function briefText() {
    const g = M.g, fng = M.fng?.[0], now = Date.now(), L = LQ.filter((x) => now - x.ts < 864e5), ll = L.filter((x) => x.long).reduce((a, x) => a + x.u, 0), ls = L.filter((x) => !x.long).reduce((a, x) => a + x.u, 0);
    const co = (M.coins || []).filter((c) => !STB.test(c.sym) && c.mc > 5e9), up = co.slice().sort((a, b) => b.c24 - a.c24).slice(0, 3), dn = co.slice().sort((a, b) => a.c24 - b.c24).slice(0, 3);
    const hl = HL.rows.filter((r) => !r.dex && r.oi > 2e6), cr = hl.slice().sort((a, b) => b.fa - a.fa)[0], sh = hl.slice().sort((a, b) => a.fa - b.fa)[0];
    const f = (c) => `${c.sym} ${(c.c24 >= 0 ? "+" : "") + c.c24.toFixed(1)}%`, L_ = [];
    L_.push("SPYDER daily brief · " + new Date().toLocaleString());
    if (g) L_.push(`Market: ${big(g.total_market_cap.usd)} (${g.market_cap_change_percentage_24h_usd >= 0 ? "+" : ""}${g.market_cap_change_percentage_24h_usd.toFixed(2)}% 24h) · BTC dominance ${g.market_cap_percentage.btc.toFixed(1)}%`);
    if (M.px.BTC) L_.push(`BTC $${fnum(M.px.BTC.p)} (${M.px.BTC.ch >= 0 ? "+" : ""}${M.px.BTC.ch.toFixed(1)}%) · ETH $${fnum(M.px.ETH?.p)} (${(M.px.ETH?.ch >= 0 ? "+" : "") + (M.px.ETH?.ch || 0).toFixed(1)}%)`);
    if (fng) L_.push(`Fear & Greed: ${fng.value} (${fng.value_classification})`);
    if (up.length) L_.push("Top gainers (>$5B cap): " + up.map(f).join(", ") + " · Top losers: " + dn.map(f).join(", "));
    if (cr && sh) L_.push(`Funding extremes: ${cr.s} ${cr.fa.toFixed(0)}% (crowded long), ${sh.s} ${sh.fa.toFixed(0)}% (crowded short)`);
    L_.push(`Liquidations seen this session: ${big(ll)} longs, ${big(ls)} shorts`);
    if (GS.eth != null) L_.push(`ETH gas ${GS.eth.toFixed(2)} gwei` + (GS.btc ? ` · BTC fastest fee ${GS.btc.fastestFee} sat/vB` : ""));
    if (SM.fills.length) { const h = SM.fills.filter((x) => now - x.t < 36e5 && x.u >= 25e3); const net = {}; for (const x of h) { if (/Open Long|Close Short/.test(x.d)) net[x.c] = (net[x.c] || 0) + x.u; else if (/Open Short|Close Long/.test(x.d)) net[x.c] = (net[x.c] || 0) - x.u; } const t = Object.entries(net).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]; if (t) L_.push(`Whales (1h): biggest net flow ${t[0]} ${sgn(t[1])}`); }
    return L_;
  }
  function rBrief() {
    const L = briefText();
    $("s-brief").innerHTML = panel("Daily market brief", "auto-generated from the live data on this page", `<div class="bar"><span class="chip on" data-bf="copy">Copy text</span><span class="chip" data-bf="print">Print / PDF</span></div><div class="brief">${L.map((l, i) => i ? `<p>${esc(l)}</p>` : `<h3>${esc(l)}</h3>`).join("")}</div><div class="mlegend">Facts only: no prediction. Open Network, Smart-money and Liq Heatmap first so the brief includes whale, gas and liquidation lines.</div>`);
  }
  $("s-brief").onclick = (e) => { const t = e.target.closest("[data-bf]"); if (!t) return; if (t.dataset.bf === "print") window.print(); else { const txt = briefText().join("\n"); (navigator.clipboard?.writeText(txt) || Promise.reject()).then(() => { t.textContent = "Copied ✓"; }, () => prompt("Copy", txt)); } };

  // ---------- Browser-closed push (Web Push via the worker) ----------
  const PS = { sub: null, on: false, msg: "", key: null };
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
  async function pushState() { try { const r = await navigator.serviceWorker.ready; PS.sub = await r.pushManager.getSubscription(); PS.on = !!PS.sub; } catch (e) { PS.on = false; } }
  async function pushSync() {
    if (!PS.sub) return;
    try { await fetch("/api/push/sub", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: PS.sub.toJSON(), rules: RL.list.filter((r) => r.on).map(({ id, s, m, op, v, once }) => ({ id, s, m, op, v, once })) }) }); } catch (e) { /* retried on next change */ }
  }
  async function pushToggle() {
    PS.msg = "";
    try {
      if (!("PushManager" in window) || !navigator.serviceWorker) throw new Error("this browser does not support push (on iPhone: add the site to Home Screen first)");
      const r = await navigator.serviceWorker.ready;
      if (PS.on) { await fetch("/api/push/unsub", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: PS.sub.endpoint }) }); await PS.sub.unsubscribe(); PS.sub = null; PS.on = false; }
      else {
        if ((await Notification.requestPermission()) !== "granted") throw new Error("notification permission denied");
        const { key } = await (await fetch("/api/push/key")).json(); if (!key) throw new Error("push is not configured on the server yet");
        PS.sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }); PS.on = true; await pushSync();
      }
    } catch (e) { PS.msg = e.message; }
    pushUi();
  }
  async function pushUi() {
    const b = $("pushbox"); if (!b) return; await pushState();
    b.innerHTML = `<div style="margin-top:12px"><div class="st" style="margin-bottom:6px">PUSH · alerts even when the browser is closed</div><span class="chip${PS.on ? " on" : ""}" data-rl="push">${PS.on ? "Push ON · click to turn off" : "Turn on push alerts"}</span> ${PS.msg ? `<span class="dn">${esc(PS.msg)}</span>` : ""}<div class="mlegend">Your armed rules above are sent to the server, which checks them every ~5 min against Hyperliquid prices/funding and sends a push to this device. Needs a browser with notification permission.</div></div>`;
  }

  document.addEventListener("click", (e) => { const g = e.target.closest?.("[data-go]"); const i = g && $(g.dataset.go); if (i) i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });

  // ---------- lazy loaders for the extra tabs ----------
  const LAZY = {
    bas: () => { lazy("bas", getBasis, 6e4); lazy("ls", getLS, 3e5); },
    sm: () => lazy("sm", getSM, 6e4),
    multi: () => lazy("mu", getMulti, 3e4),
    brief: () => { lazy("gas", getGas, 15e3); lazy("sm", getSM, 6e4); },
    flow: () => getFlow(),
    cmp: () => { getCmp(); lazy("corr", getCorr, 6e5); },
    gas: () => lazy("gas", getGas, 15e3),
    map: () => { if (TM.kSym !== TM.sym + TM.rng) getTmK(); },
    soc: () => lazy("soc", getSoc, 3e5),
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
  connectL(); connectO();
  const waitPx = setInterval(() => { if (Object.keys(M.px).length > 50) { clearInterval(waitPx); getOI(); getMov(); setInterval(getOI, 120000); setInterval(() => getMov().then(checkMovers), 45000); } }, 1000);
  getChains(); setInterval(getChains, 900000); getEtf(); setInterval(getEtf, 900000); getSol(); setInterval(getSol, 10000);
  setInterval(() => { checkAlerts(); if (document.body.dataset.v === "mkt" && (sub === "deriv" || sub === "watch")) renderSub(); }, 1000);
  setInterval(checkSectors, 30000);
  fromHash();
})();
