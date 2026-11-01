const $ = (id) => document.getElementById(id);
const FAPI = "https://fapi.binance.com/fapi/v1";
const BURST_MIN = 2.5, FUND_MIN = 0.0005, LIQ_MIN = 50000, MAX_FEED = 200;
const TG_URL = ""; // set to your Telegram channel link to show the button
const WHALE_MIN = 1e6, WHALES = ["btcusdt", "ethusdt", "solusdt"];
let alertsOn = false;
let feed = [], filter = "all", liq = { n: 0, usd: 0 }, bursts = [], funds = [];

const fmtUsd = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "K" : "$" + n.toFixed(0);
const sym = (s) => s.replace(/USDT$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function push(type, html, key) {
  if (key && feed.some((e) => e.key === key)) return;
  feed.unshift({ type, html, key, t: Date.now() });
  feed = feed.slice(0, MAX_FEED);
  if (alertsOn && (type === "whale" || type === "liq" && /\$[\d.]+M/.test(html))) notify(type, html);
  renderFeed();
}

function renderFeed() {
  const rows = feed.filter((e) => filter === "all" || e.type === filter);
  const label = { whale: "WHALE", burst: "VOL BURST", liq: "LIQUIDATION", funding: "FUNDING" };
  $("feed").innerHTML = rows.length
    ? rows.map((e) => `<li><span class="t">${clock(e.t)}</span><span class="tag ${e.type}">${label[e.type]}</span><span class="m">${e.html}</span></li>`).join("")
    : '<li class="dim">Waiting for events…</li>';
  $("feedTag").textContent = rows.length + " events";
}

function renderKpis() {
  const top = bursts[0], fund = funds[0];
  const k = (a, v, s, c = "") => `<div class="kpi"><div class="k">${a}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
  $("kpis").innerHTML =
    k("Top burst", top ? sym(top.s) + " " + top.x.toFixed(1) + "×" : "—", "vs own 24h hourly avg", "or") +
    k("Most crowded funding", fund ? sym(fund.s) + " " + (fund.r * 100).toFixed(3) + "%" : "—", fund ? (fund.r > 0 ? "longs paying shorts" : "shorts paying longs") : "", fund && fund.r > 0 ? "good" : "bad") +
    k("Liquidations seen", liq.n, "this session, ≥ " + fmtUsd(LIQ_MIN)) +
    k("Liquidated volume", fmtUsd(liq.usd), "this session", "bad");
}

function renderTables() {
  $("fund").innerHTML = "<tr><th>COIN</th><th class='r'>RATE</th><th class='r'>MARK</th></tr>" +
    funds.slice(0, 12).map((f) => `<tr><td>${esc(sym(f.s))}</td><td class="r ${f.r > 0 ? "good" : "bad"}">${(f.r * 100).toFixed(3)}%</td><td class="r dim">${f.p}</td></tr>`).join("");
  $("burst").innerHTML = "<tr><th>COIN</th><th class='r'>BURST</th><th class='r'>1H CHG</th></tr>" +
    bursts.slice(0, 12).map((b) => `<tr><td>${esc(sym(b.s))}</td><td class="r or">${b.x.toFixed(1)}×</td><td class="r ${b.c >= 0 ? "good" : "bad"}">${b.c >= 0 ? "+" : ""}${b.c.toFixed(2)}%</td></tr>`).join("");
}

function notify(type, html) {
  const text = html.replace(/<[^>]+>/g, "");
  try { if (Notification.permission === "granted") new Notification("Radar · " + type, { body: text }); } catch {}
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); g.gain.value = 0.05; o.frequency.value = 880; o.start(); o.stop(a.currentTime + 0.15);
  } catch {}
}

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); }

async function scanFunding() {
  const d = await getJSON(FAPI + "/premiumIndex");
  funds = d.filter((x) => x.symbol.endsWith("USDT")).map((x) => ({ s: x.symbol, r: +x.lastFundingRate, p: (+x.markPrice).toPrecision(6) }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  funds.filter((f) => Math.abs(f.r) >= FUND_MIN).slice(0, 5).forEach((f) =>
    push("funding", `<b>${esc(sym(f.s))}</b> funding ${(f.r * 100).toFixed(3)}% — ${f.r > 0 ? "longs crowded" : "shorts crowded"}`, "f" + f.s + Math.floor(Date.now() / 36e5)));
}

async function scanBursts() {
  const t = await getJSON(FAPI + "/ticker/24hr");
  const top = t.filter((x) => x.symbol.endsWith("USDT")).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40);
  $("heat").innerHTML = top.map((x) => {
    const p = +x.priceChangePercent, a = Math.min(Math.abs(p) / 8, 1);
    return `<div style="background:rgba(${p >= 0 ? "47,210,122" : "255,77,77"},${0.18 + a * 0.6})"><b>${esc(sym(x.symbol))}</b>${p >= 0 ? "+" : ""}${p.toFixed(2)}%</div>`;
  }).join("");
  const res = await Promise.allSettled(top.map((x) => getJSON(`${FAPI}/klines?symbol=${x.symbol}&interval=1h&limit=26`)));
  bursts = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled" || r.value.length < 26) return;
    const k = r.value.slice(0, -1); // drop the forming candle
    const last = k[k.length - 1], hist = k.slice(0, -1);
    const avg = hist.reduce((a, c) => a + +c[7], 0) / hist.length;
    if (!avg) return;
    bursts.push({ s: top[i].symbol, x: +last[7] / avg, c: (+last[4] / +last[1] - 1) * 100, id: last[0] });
  });
  bursts.sort((a, b) => b.x - a.x);
  bursts.filter((b) => b.x >= BURST_MIN).forEach((b) =>
    push("burst", `<b>${esc(sym(b.s))}</b> ${b.x.toFixed(1)}× its normal hourly volume, price ${b.c >= 0 ? "+" : ""}${b.c.toFixed(2)}%`, "b" + b.s + b.id));
}

async function refresh() {
  try { await Promise.all([scanFunding(), scanBursts()]); $("status").textContent = "Live · updated " + clock(Date.now()); }
  catch { $("status").textContent = "Data source unavailable, retrying…"; }
  renderTables(); renderKpis();
}

function connectLiq() {
  const ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr");
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data).o;
    if (!o) return;
    const usd = +o.z * +o.ap;
    if (usd < LIQ_MIN) return;
    liq.n++; liq.usd += usd;
    const longLiq = o.S === "SELL"; // forced sell closes a long
    push("liq", `<b>${esc(sym(o.s))}</b> ${longLiq ? "long" : "short"} liquidated ${fmtUsd(usd)} @ ${(+o.ap).toPrecision(6)}`);
    renderKpis();
  };
  ws.onclose = () => setTimeout(connectLiq, 3000);
}

function connectWhales() {
  const ws = new WebSocket("wss://fstream.binance.com/stream?streams=" + WHALES.map((s) => s + "@aggTrade").join("/"));
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data).data;
    if (!o) return;
    const usd = +o.q * +o.p;
    if (usd < WHALE_MIN) return;
    const buy = !o.m; // m = buyer is maker, i.e. a market sell
    push("whale", `<b>${esc(sym(o.s))}</b> ${buy ? "market buy" : "market sell"} ${fmtUsd(usd)} @ ${(+o.p).toPrecision(6)}`);
  };
  ws.onclose = () => setTimeout(connectWhales, 3000);
}

$("alertBtn").addEventListener("click", async () => {
  alertsOn = !alertsOn;
  if (alertsOn && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  $("alertBtn").textContent = alertsOn ? "🔔 Alerts on" : "🔔 Alerts off";
});
if (TG_URL) { $("tgBtn").href = TG_URL; $("tgBtn").hidden = false; }

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll("#filters button").forEach((x) => x.classList.toggle("on", x === b));
  renderFeed();
});

renderFeed(); renderKpis(); refresh(); connectLiq(); connectWhales();
setInterval(refresh, 120000);
