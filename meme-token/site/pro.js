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
  for (const id of ["scr", "deriv", "mov", "chain", "watch"]) { const d = document.createElement("div"); d.id = "s-" + id; d.hidden = true; wrap.appendChild(d); }
  function show(u) {
    sub = u;
    document.querySelectorAll("#subtabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.u === u));
    for (const id of ["over", "scr", "deriv", "mov", "chain", "watch"]) $("s-" + id).hidden = id !== u;
    renderSub();
  }
  $("subtabs").onclick = (e) => { const u = e.target.dataset?.u; if (u) show(u); };
  function renderSub() { ({ scr: rScr, deriv: rDeriv, mov: rMov, chain: rChain, watch: rWatch })[sub]?.(); }

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
    $("s-chain").innerHTML = panel("Spot Bitcoin ETF flows", "issuer holdings change · as-of dates differ per issuer · est. flow = BTC change × price", etf) + panel("Chain money flow", "TVL = capital parked on the chain · DEX volume = trading activity · DefiLlama", chains, "margin-top:12px") + solPanel();
  }

  // ---------- screener (Hyperliquid perps) ----------
  const HL = { rows: [], first: {}, cls: "all", sig: "all", q: "", sk: "vol", sd: -1, ts: 0 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const getHL = lg(async () => {
    const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
    if (!r.ok) throw new Error(r.status);
    const [meta, ctx] = await r.json(), out = [];
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
      out.push({ s: u.name, p, chg, vol, oi, fa, oid, vo: oi ? vol / oi : 0, tags, score: s, sig: s >= 2.5 ? "STRONG BUY" : s >= 1.2 ? "BUY" : s <= -2.5 ? "STRONG SELL" : s <= -1.2 ? "SELL" : "NEUTRAL", lev: u.maxLeverage });
    });
    HL.rows = out; HL.ts = Date.now();
  });
  const sigc = (g) => (g.includes("BUY") ? "up" : g.includes("SELL") ? "dn" : "st");
  function rScr() {
    const q = HL.q.toUpperCase(), liquid = HL.rows.slice().sort((a, b) => b.vol - a.vol).slice(0, 100);
    const hot = liquid.filter((r) => r.sig !== "NEUTRAL").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 6);
    const kpi = `<div class="mk7">${kc("Perp pairs", HL.rows.length, "Hyperliquid")}${kc("24h volume", big(HL.rows.reduce((a, r) => a + r.vol, 0)), "all pairs")}${kc("Open interest", big(HL.rows.reduce((a, r) => a + r.oi, 0)), "all pairs")}${kc("Active signals", liquid.filter((r) => r.sig !== "NEUTRAL").length, "top 100 by volume")}</div>`;
    const cards = hot.map((r) => `<div class="stile" data-sym="${esc(r.s)}" style="background:rgba(${r.score >= 0 ? "47,210,122" : "255,77,77"},.1)"><div class="n"><span>${esc(r.s)}</span><span class="${sigc(r.sig)}">${r.sig}</span></div><div class="a">${px(r.p)}</div><div class="d">${ps(r.chg)} · funding ${r.fa.toFixed(0)}% ann.<br>${esc(r.tags.join(" · ") || "momentum")}</div></div>`).join("") || '<span class="st">no strong setups right now</span>';
    const chip = (k, v, l) => `<span class="chip${HL[k] === v ? " on" : ""}" data-sf="${k}:${v}">${l}</span>`;
    let rows = HL.rows.filter((r) => (!q || r.s.toUpperCase().includes(q)) && (HL.sig === "all" || (HL.sig === "buy" && r.sig.includes("BUY")) || (HL.sig === "sell" && r.sig.includes("SELL")) || (HL.sig === "strong" && r.sig.startsWith("STRONG"))));
    const key = HL.sk, d = HL.sd; rows = rows.sort((a, b) => key === "s" ? d * a.s.localeCompare(b.s) : d * (a[key] - b[key]));
    const cols = [["s", "Pair"], ["score", "Signal"], [null, "Flags"], ["p", "Price"], ["chg", "24h"], ["vol", "Vol 24h"], ["oi", "OI"], ["oid", "OI Δ (session)"], ["fa", "Funding ann."], ["vo", "Vol/OI"]];
    const th = cols.map(([k, l]) => `<th ${k ? `data-ss="${k}"` : ""} class="${k === key ? "on" : ""}">${l}${k === key ? (d < 0 ? " ▼" : " ▲") : ""}</th>`).join("");
    const tr = rows.slice(0, 200).map((r) => `<tr class="cr"${M.px[r.s] ? ` data-sym="${esc(r.s)}"` : ""}><td><span class="star" data-star="${esc(r.s)}">${star(r.s)}</span> <b>${esc(r.s)}</b><span class="st">-PERP</span></td><td class="${sigc(r.sig)}"><b>${r.sig}</b></td><td class="st" style="text-align:left">${esc(r.tags.join(" · "))}</td><td>${px(r.p)}</td><td>${ps(r.chg)}</td><td>${big(r.vol)}</td><td>${big(r.oi)}</td><td>${ps(r.oid)}</td><td class="${r.fa > 40 ? "dn" : r.fa < -10 ? "up" : ""}">${r.fa >= 0 ? "+" : ""}${r.fa.toFixed(1)}%</td><td>${r.vo.toFixed(2)}</td></tr>`).join("");
    const keep = document.activeElement?.id === "scq", sc = $("s-scr").querySelector(".tw")?.scrollTop || 0;
    $("s-scr").innerHTML = panel("Hyperliquid perp screener", "live from Hyperliquid · refreshes every 5s · click a row for its chart (Binance-listed coins)", `${kpi}<div class="wh2">Hot right now</div><div class="tiles" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">${cards}</div><div class="bar" style="margin-top:12px">${chip("sig", "all", "All")}${chip("sig", "buy", "Buy")}${chip("sig", "sell", "Sell")}${chip("sig", "strong", "Strong only")}<input id="scq" value="${esc(HL.q)}" placeholder="Search pair…" autocomplete="off" spellcheck="false" style="background:#0b0b0b;border:1px solid var(--line);color:var(--fg);padding:6px 8px;font:inherit;width:160px"></div><div class="mlegend" style="margin:0 0 8px">Signal = rule-based score of 24h momentum, funding (crowded side fades), and session OI/price flow. It is a screening heuristic, not a prediction or advice. OI Δ counts only since you opened this page.</div><div class="tw" style="max-height:70vh"><table><thead><tr>${th}</tr></thead><tbody>${tr || '<tr><td colspan="10" class="st">'+(HL.rows.length ? "no pairs match this filter" : "loading Hyperliquid…")+'</td></tr>'}</tbody></table></div>`);
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

  // ---------- boot ----------
  getFund(); setInterval(getFund, 20000);
  connectL();
  const waitPx = setInterval(() => { if (Object.keys(M.px).length > 50) { clearInterval(waitPx); getOI(); getMov(); setInterval(getOI, 120000); setInterval(() => getMov().then(checkMovers), 45000); } }, 1000);
  getChains(); setInterval(getChains, 900000); getEtf(); setInterval(getEtf, 900000); getSol(); setInterval(getSol, 10000);
  setInterval(() => { checkAlerts(); if (document.body.dataset.v === "mkt" && (sub === "deriv" || sub === "watch")) renderSub(); }, 1000);
  setInterval(checkSectors, 30000);
})();
