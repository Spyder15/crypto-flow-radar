(async function () {
  const $ = (id) => document.getElementById(id), cards = $("tapeCards");
  const fmt = (x) => x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x.toPrecision(4);
  const pct = (x) => `<span class="${x >= 0 ? "good" : "bad"}" style="font-size:15px">${x >= 0 ? "+" : ""}${x.toFixed(2)}%</span>`;
  const card = (k, v, s) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const base = (s) => s.replace(/USDT$/, "").replace(/[^A-Za-z0-9]/g, "");
  try {
    const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"); if (!r.ok) throw 0;
    const all = (await r.json()).filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_")).sort((a, b) => b.quoteVolume - a.quoteVolume), top = all.slice(0, 100);
    const get = (s) => all.find((t) => t.symbol === s), btc = get("BTCUSDT"), eth = get("ETHUSDT");
    const up = top.filter((t) => +t.priceChangePercent > 0).length, gain = top.slice().sort((a, b) => b.priceChangePercent - a.priceChangePercent)[0], vol = top[0];
    cards.innerHTML = card("BTC", fmt(+btc.lastPrice), pct(+btc.priceChangePercent)) + card("ETH", fmt(+eth.lastPrice), pct(+eth.priceChangePercent)) +
      card("COINS UP (24H)", `${Math.round(up / top.length * 100)}%`, `of the top ${top.length} by volume`) +
      card("TOP GAINER", base(gain.symbol), pct(+gain.priceChangePercent)) + card("TOP VOLUME", base(vol.symbol), `$${(vol.quoteVolume / 1e9).toFixed(2)}B in 24h`);
    $("asof").textContent = "Updated " + new Date().toLocaleTimeString() + ".";
  } catch (e) {
    cards.innerHTML = '<div class="card"><div class="k">LIVE TAPE</div><div class="v dim">Unavailable</div><div class="s">Binance API unreachable (blocked region or rate limit). The dashboard needs it too — try a VPN.</div></div>';
  }
})();
