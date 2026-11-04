// Live big-buy feed for the website (all chains). Reads hot pools from GeckoTerminal (free API, no key), keeps each wallet's buys
// above minBuyUsd, adds a GoPlus safety check per token and writes site/data.json. Known wallets can be named in wallets.json:
// { "address": "@handle" }. Tracker only: never buys anything.
import fs from "node:fs";
import { n, rugCheck } from "./lib.js";

const cfg = JSON.parse(fs.readFileSync(new URL("./whale-config.json", import.meta.url)));
const STATE = new URL("./whale-state.json", import.meta.url), OUT = new URL("./site/data.json", import.meta.url);
const read = (u, d) => (fs.existsSync(u) ? JSON.parse(fs.readFileSync(u)) : d);
const state = read(STATE, { feed: [], tokens: {} }), labels = read(new URL("./wallets.json", import.meta.url), {});
const lbl = Object.fromEntries(Object.entries(labels).filter(([k]) => k !== "ADDRESS_HERE").map(([k, v]) => [k.toLowerCase(), v]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now(), KEEP = 24 * 36e5;

// One call at a time: the free plan allows about 30 requests/minute. Waits longer after a 429.
async function g(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await sleep(i ? 20000 : 3500);
    const r = await fetch("https://api.geckoterminal.com/api/v2" + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429) continue;
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  }
  throw new Error(`429 ${path}`);
}

async function hotPools() {
  const pools = new Map();
  for (const path of ["/networks/trending_pools", ...cfg.networks.map((x) => `/networks/${x}/trending_pools`)]) {
    try { for (const p of (await g(path)).data) pools.set(p.id, p); } catch (e) { console.log("pools failed", e.message); }
  }
  return [...pools.values()].filter((p) => n(p.attributes.reserve_in_usd) >= cfg.minPoolLiquidityUsd && cfg.networks.includes(p.id.split("_")[0])).sort((a, b) => n(b.attributes.volume_usd?.h1) - n(a.attributes.volume_usd?.h1)).filter((p, _, all) => all.filter((q) => q.id.split("_")[0] === p.id.split("_")[0]).indexOf(p) < (cfg.poolsPerNetwork[p.id.split("_")[0]] ?? cfg.poolsPerNetwork.default));
}

const pools = await hotPools(), seen = new Set(state.feed.map((x) => x.id));
console.log(`watching ${pools.length} pools`);
for (const p of pools) {
  const a = p.attributes, net = p.id.split("_")[0], tokenAddr = p.relationships.base_token.data.id.split(/_(.+)/)[1], tkey = `${net}:${tokenAddr}`.toLowerCase();
  state.tokens[tkey] = { ...state.tokens[tkey], net, addr: tokenAddr, sym: a.name.split(" / ")[0], pool: a.address, dex: p.relationships.dex?.data?.id || "", mc: n(a.market_cap_usd) || n(a.fdv_usd), vol24: n(a.volume_usd?.h24), liq: n(a.reserve_in_usd), chg24: n(a.price_change_percentage?.h24), created: Date.parse(a.pool_created_at) || null, upd: now };
  let trades; try { trades = (await g(`/networks/${net}/pools/${a.address}/trades`)).data; } catch (e) { console.log("trades failed", e.message); continue; }
  for (const { attributes: t } of trades) {
    const usd = n(t.volume_in_usd), id = `${net}:${t.tx_hash}`;
    if (t.kind !== "buy" || t.is_anomalous || usd < cfg.minBuyUsd || seen.has(id) || now - Date.parse(t.block_timestamp) > KEEP) continue;
    seen.add(id); state.feed.push({ id, tkey, wallet: t.tx_from_address, usd, ts: Date.parse(t.block_timestamp) });
  }
}
state.feed = state.feed.filter((x) => now - x.ts <= KEEP).sort((x, y) => y.ts - x.ts).slice(0, 1500);

// Safety check for tokens that appear in the feed (cached 6h, capped per run).
const need = [...new Set(state.feed.map((x) => x.tkey))].filter((k) => !state.tokens[k]?.sec || now - state.tokens[k].sec.at > 6 * 36e5).slice(0, 15);
for (const k of need) {
  const t = state.tokens[k]; if (!t) continue;
  const rc = await rugCheck(t.net === "eth" ? "ethereum" : t.net, t.addr, cfg).catch(() => null);
  t.sec = rc ? { at: now, level: rc.level, flags: rc.flags, top10: rc.top10, holders: rc.holders } : { at: now, level: "unknown", flags: [] };
}
for (const k of Object.keys(state.tokens)) if (now - state.tokens[k].upd > 3 * 864e5) delete state.tokens[k];

const W = (x) => ({ w: x.wallet, name: lbl[x.wallet.toLowerCase()] || null, usd: Math.round(x.usd), ts: x.ts });
const feed = state.feed.slice(0, 400).map((x) => ({ ...W(x), token: x.tkey }));
const heat = {};
for (const x of state.feed) { const h = (heat[x.tkey] ||= { token: x.tkey, buys: [] }); h.buys.push(W(x)); }
const heating = Object.values(heat).map((h) => ({ token: h.token, buys: h.buys.slice(0, 40), buyers: new Set(h.buys.map((b) => b.w)).size })).sort((a, b) => b.buyers - a.buyers || b.buys.reduce((s, x) => s + x.usd, 0) - a.buys.reduce((s, x) => s + x.usd, 0)).slice(0, 40);
const used = new Set([...feed.map((f) => f.token), ...heating.map((h) => h.token)]);
const tokens = Object.fromEntries([...used].map((k) => [k, state.tokens[k]]));
fs.writeFileSync(OUT, JSON.stringify({ updated: now, minBuyUsd: cfg.minBuyUsd, feed, heating, tokens }));
fs.writeFileSync(STATE, JSON.stringify(state));
console.log(`done: feed ${feed.length}, heating ${heating.length}, tokens ${used.size}`);
