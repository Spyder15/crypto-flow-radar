import list from "../smc-screener/whales.json";

const MIN_USD = 250000, MIN_CHANGE = 0.25, MAX_WALLETS = 20, MAX_LINES = 12;
const SITE = "https://crypto-flow-radar.live-scanner.workers.dev/radar.html";
const fmt = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1e3) + "K");
const who = (w) => (w.name ? w.name : w.a.slice(0, 6) + "…" + w.a.slice(-4));
const link = (w) => `<a href="https://hypurrscan.io/address/${w.a}">${who(w)}</a>`;

async function positions(addr) {
  const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "clearinghouseState", user: addr }) });
  if (!r.ok) return null;
  const out = {};
  for (const { position: p } of (await r.json()).assetPositions || []) {
    const usd = +p.positionValue;
    if (usd >= 1e5) out[p.coin] = { usd, long: +p.szi > 0, entry: +p.entryPx };
  }
  return out;
}

// Diffs top-wallet positions against the last snapshot in KV and posts opens, closes, flips and big size changes.
export async function whaleWatch(env, send) {
  const prev = await env.TRADES.get("whales", "json");
  const wallets = list.wallets.slice(0, MAX_WALLETS);
  const res = await Promise.allSettled(wallets.map((w) => positions(w.a)));
  const next = { ...(prev || {}) }, lines = [];
  res.forEach((r, i) => {
    const w = wallets[i];
    if (r.status !== "fulfilled" || !r.value) return; // keep old snapshot on failure
    const now = r.value, old = prev?.[w.a];
    next[w.a] = now;
    if (!old) return; // first sight of this wallet: snapshot only
    for (const [c, p] of Object.entries(now)) {
      const o = old[c], side = p.long ? "LONG" : "SHORT", e = `entry ${(+p.entry).toPrecision(5)}`;
      if (!o) { if (p.usd >= MIN_USD) lines.push(`🟢 ${link(w)} opened <b>${side} ${c}</b> ${fmt(p.usd)} · ${e}`); }
      else if (o.long !== p.long) { if (p.usd >= MIN_USD) lines.push(`🔄 ${link(w)} flipped to <b>${side} ${c}</b> ${fmt(p.usd)} · ${e}`); }
      else if (Math.abs(p.usd - o.usd) >= MIN_USD && Math.abs(p.usd / o.usd - 1) >= MIN_CHANGE)
        lines.push(`${p.usd > o.usd ? "➕" : "➖"} ${link(w)} ${p.usd > o.usd ? "added to" : "trimmed"} <b>${side} ${c}</b> ${fmt(o.usd)} → ${fmt(p.usd)}`);
    }
    for (const [c, o] of Object.entries(old)) if (!now[c] && o.usd >= MIN_USD) lines.push(`🔴 ${link(w)} closed <b>${o.long ? "LONG" : "SHORT"} ${c}</b> (${fmt(o.usd)})`);
  });
  await env.TRADES.put("whales", JSON.stringify(next));
  if (!lines.length) return { sent: 0 };
  const shown = lines.slice(0, MAX_LINES);
  await send(["<b>🐋 Whale wallet moves</b>", "", ...shown, lines.length > shown.length ? `…and ${lines.length - shown.length} more` : "", "", `<a href="${SITE}">Live radar</a> · <i>wallets can hedge elsewhere; not advice</i>`].filter((x, i, a) => x || a[i - 1]).join("\n"));
  return { sent: lines.length };
}
