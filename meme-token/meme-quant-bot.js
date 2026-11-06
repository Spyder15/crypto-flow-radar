// Meme quant bot (PAPER ONLY, fake money). Runs every ~5 min from GitHub Actions.
// Universe: tokens from the live whale feed (site/data.json) + DexScreener boosted tokens, prices/momentum from DexScreener,
// GoPlus rug check before any entry. State lives in Cloudflare KV key "mq" (binding PUSH) and is served at /api/mq.
// It never buys anything with real money.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { n, getJson, rugCheck } from "./lib.js";

const SITE = "https://meme-trench.spyder-radar.workers.dev";
const LOCAL = process.env.MQ_FILE || (process.argv.includes("--local") ? "/tmp/mq.json" : "");
const rc = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url)));
const C = {
  start: 1000, sizePct: 4, maxOpen: 8, maxLiqPct: 1, dailyStopPct: 5, fee: 0.003, slipBase: 0.015,
  minLiq: 25000, minVol1h: 15000, minAgeMin: 30, minTx1h: 40, cooldownH: 12,
  strat: {
    brk: { sl: 0.15, tp1: 0.30, trail: 0.15, holdH: 6 },
    whale: { sl: 0.15, tp1: 0.30, trail: 0.15, holdH: 6 },
    rec: { sl: 0.12, tp1: 0.25, trail: 0.12, holdH: 12 },
  },
};
// DexScreener chain id -> GeckoTerminal network id (used by the website charts)
const CHAINS = { solana: "solana", ethereum: "eth", base: "base", bsc: "bsc", arbitrum: "arbitrum", polygon: "polygon_pos", avalanche: "avax" };
const GT2DS = Object.fromEntries(Object.entries(CHAINS).map(([d, g]) => [g, d]));

const kv = (args) => execFileSync("npx", ["--yes", "wrangler@4", "kv", "key", ...args, "--binding", "PUSH", "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: new URL(".", import.meta.url).pathname });
const KEY = process.env.PUSH_RUN_KEY;
async function load() {
  if (KEY && !LOCAL) {
    // a failed read must abort, otherwise the bot would reset to a fresh $1000 and overwrite saved state
    const r = await fetch(`${SITE}/api/mq?t=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error("state load failed " + r.status);
    const j = await r.json(); return j.cfg ? j : null;
  }
  try {
    if (LOCAL) return fs.existsSync(LOCAL) ? JSON.parse(fs.readFileSync(LOCAL)) : null;
    const out = kv(["get", "mq"]); return JSON.parse(out);
  } catch { return null; }
}
async function save(s) {
  const body = JSON.stringify(s);
  if (LOCAL) { fs.writeFileSync(LOCAL, body); return; }
  if (KEY) {
    const r = await fetch(`${SITE}/api/mq/put`, { method: "POST", headers: { "x-run-key": KEY }, body });
    if (!r.ok) throw new Error("state save failed " + r.status); return;
  }
  const f = "/tmp/mq-out.json"; fs.writeFileSync(f, body); kv(["put", "mq", "--path", f]);
}

const now = Date.now();
const fp = (x) => JSON.stringify([x.open.map((o) => [o.id, o.tp1Hit, +o.sl.toFixed(12), +o.real.toFixed(4)]), x.closed.length, x.cash.toFixed(2)]);
const S = (await load()) || { cfg: C, cash: C.start, open: [], closed: [], curve: [], cool: {}, sec: {}, day: { d: "", pnl: 0 }, seq: 0 };
S.cfg = C; S.sec ||= {}; S.cool ||= {};
S._fp = fp(S);
const key = (ds, addr) => `${ds}:${addr}`.toLowerCase();

async function universe() {
  const m = new Map(), whales = {};
  try {
    const d = await getJson(`${SITE}/data.json?t=${now}`);
    for (const [k, t] of Object.entries(d.tokens || {})) if (GT2DS[t.net]) m.set(key(GT2DS[t.net], t.addr), { ds: GT2DS[t.net], addr: t.addr, sec: t.sec });
    for (const f of d.feed || []) {
      if (now - f.ts > 60 * 6e4) continue;
      const w = (whales[String(f.token).toLowerCase()] ||= { usd: 0, ws: new Set() }); w.usd += f.usd; w.ws.add(f.w);
    }
  } catch (e) { console.log("feed failed", e.message); }
  for (const u of ["https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-boosts/top/v1"]) {
    try { for (const t of await getJson(u)) if (CHAINS[t.chainId]) m.set(key(t.chainId, t.tokenAddress), { ds: t.chainId, addr: t.tokenAddress }); } catch (e) { console.log("boost failed", e.message); }
  }
  return { list: [...m.values()], whales };
}

// Best (most liquid) pair per token; also returns pairs by pair address.
async function pairs(addrs) {
  const best = new Map(), byPair = new Map();
  for (let i = 0; i < addrs.length; i += 30) {
    try {
      const r = await getJson("https://api.dexscreener.com/latest/dex/tokens/" + addrs.slice(i, i + 30).join(","));
      for (const p of r.pairs || []) {
        if (!CHAINS[p.chainId]) continue;
        const k = key(p.chainId, p.baseToken.address);
        byPair.set(`${p.chainId}:${p.pairAddress}`.toLowerCase(), p);
        if (!best.has(k) || n(p.liquidity?.usd) > n(best.get(k).liquidity?.usd)) best.set(k, p);
      }
    } catch (e) { console.log("pairs failed", e.message); }
  }
  return { best, byPair };
}

const day = new Date(now).toISOString().slice(0, 10);
if (S.day.d !== day) S.day = { d: day, pnl: 0 };
const slip = (size, liq) => C.slipBase + (size / Math.max(liq, 1)) * 2;
const equity = () => S.cash + S.open.reduce((s, t) => s + t.units * (t.px || t.entry), 0);

function sell(t, units, px, reason, final) {
  const proceeds = units * px * (1 - slip(units * px, t.liq || t.liq0)) * (1 - C.fee);
  S.cash += proceeds; t.real += proceeds; t.units -= units;
  if (!final) return;
  const pnl = t.real - t.size;
  S.day.pnl += pnl;
  S.closed.unshift({ id: t.id, sym: t.sym, net: t.net, ds: t.ds, addr: t.addr, pair: t.pair, url: t.url, strat: t.strat, entry: t.entry, exit: px, sl: t.sl0, tp: t.tp1, peak: t.peak, size: t.size, pnl, pct: pnl / t.size * 100, reason, t0: t.t0, t1: now, why: t.why });
  S.open = S.open.filter((o) => o.id !== t.id);
  S.cool[key(t.ds, t.addr)] = now;
  console.log(`CLOSE ${t.sym} ${reason} pnl ${pnl.toFixed(2)}`);
}

const { list, whales } = await universe();
const openAddrs = S.open.map((t) => t.addr), allAddrs = [...new Set([...openAddrs, ...list.map((u) => u.addr)])];
const { best, byPair } = await pairs(allAddrs);
console.log(`universe ${list.length}, pairs ${best.size}, open ${S.open.length}`);

// 1) manage open positions
for (const t of [...S.open]) {
  const p = byPair.get(`${t.ds}:${t.pair}`.toLowerCase()) || best.get(key(t.ds, t.addr));
  if (!p || !n(p.priceUsd)) { t.miss = (t.miss || 0) + 1; if (t.miss >= 6) sell(t, t.units, 0, "PAIR GONE", true); continue; }
  t.miss = 0;
  const px = n(p.priceUsd), liq = n(p.liquidity?.usd), cf = C.strat[t.strat];
  t.px = px; t.liq = liq; t.peak = Math.max(t.peak, px); t.chk = now;
  const ageH = (now - t.t0) / 36e5;
  if (liq < Math.max(8000, t.liq0 * 0.5)) { sell(t, t.units, px, "LIQUIDITY PULLED", true); continue; }
  if (px <= t.sl) { sell(t, t.units, px, t.tp1Hit ? "TRAIL" : "SL", true); continue; }
  if (!t.tp1Hit && px >= t.tp1) {
    sell(t, t.units / 2, px, "TP1", false);
    t.tp1Hit = true; t.sl = Math.max(t.sl, t.entry);
    console.log(`TP1 ${t.sym} at ${px}`);
  }
  if (t.tp1Hit) { t.sl = Math.max(t.sl, t.peak * (1 - cf.trail)); if (px <= t.sl) { sell(t, t.units, px, "TRAIL", true); continue; } }
  if (ageH >= cf.holdH) sell(t, t.units, px, "TIME", true);
}

// 2) entries
const dayStop = S.day.pnl <= -C.start * C.dailyStopPct / 100;
const cands = []; let basePass = 0;
for (const u of list) {
  const k = key(u.ds, u.addr), p = best.get(k); if (!p || !n(p.priceUsd)) continue;
  if (S.open.some((t) => key(t.ds, t.addr) === k) || (S.cool[k] && now - S.cool[k] < C.cooldownH * 36e5)) continue;
  const liq = n(p.liquidity?.usd), v1 = n(p.volume?.h1), v5 = n(p.volume?.m5), age = p.pairCreatedAt ? (now - p.pairCreatedAt) / 6e4 : 0;
  const b5 = n(p.txns?.m5?.buys), s5 = n(p.txns?.m5?.sells), b1 = n(p.txns?.h1?.buys), s1 = n(p.txns?.h1?.sells);
  const c5 = n(p.priceChange?.m5), c1 = n(p.priceChange?.h1), c24 = n(p.priceChange?.h24);
  if (liq < C.minLiq || v1 < C.minVol1h || age < C.minAgeMin || b1 + s1 < C.minTx1h) continue;
  basePass++;
  if (process.env.DEBUG) console.log(p.baseToken.symbol, `liq ${Math.round(liq)} age ${Math.round(age)}m pace ${(v1 ? v5 * 12 / v1 : 0).toFixed(1)} r5 ${(s5 ? b5 / s5 : 9).toFixed(1)} c5 ${c5} c1 ${c1} c24 ${c24} whales ${JSON.stringify(whales[`${CHAINS[u.ds]}:${u.addr}`.toLowerCase()]?.usd || 0)}`);
  const gtKey = `${CHAINS[u.ds]}:${u.addr}`.toLowerCase(), w = whales[gtKey];
  const pace = v1 ? (v5 * 12) / v1 : 0, r5 = s5 ? b5 / s5 : b5 ? 9 : 0, r1 = s1 ? b1 / s1 : 9;
  let strat = "", why = "", score = 0;
  if (w && ((w.ws.size >= 2 && w.usd >= 3000) || w.usd >= 8000) && c5 >= -3 && c1 <= 150 && r1 >= 0.85) { strat = "whale"; why = `${w.ws.size} whale wallet${w.ws.size > 1 ? "s" : ""} bought $${Math.round(w.usd)} in 1h`; score = w.usd / 1000; }
  else if (pace >= 1.5 && r5 >= 1.3 && c5 >= 1.5 && c5 < 25 && c1 >= 5 && c1 <= 120 && age <= 48 * 60) { strat = "brk"; why = `5m volume ${pace.toFixed(1)}x pace, buys/sells ${r5.toFixed(1)}`; score = pace * r5; }
  else if (c24 >= 60 && c1 <= -12 && c1 >= -40 && c5 >= 1.5 && b5 > s5 && liq >= 50000 && age >= 360) { strat = "rec"; why = `dip ${c1.toFixed(0)}% 1h after +${c24.toFixed(0)}% day, buyers back`; score = c5; }
  if (strat) cands.push({ u, p, strat, why, score, liq });
}
console.log(`passed base filters ${basePass}, signals ${cands.length}`);
cands.sort((a, b) => b.score - a.score);
let added = 0;
if (!dayStop) for (const c of cands) {
  if (added >= 2 || S.open.length >= C.maxOpen) break;
  const { u, p } = c, k = key(u.ds, u.addr);
  let ok = S.sec[k] && now - S.sec[k].at < 6 * 36e5 ? S.sec[k].ok : null;
  if (ok === null) {
    const r = await rugCheck(u.ds, u.addr, rc);
    ok = r.ok && r.level === "good"; S.sec[k] = { at: now, ok };
    if (!ok) console.log(`skip ${p.baseToken.symbol}: ${r.flags.join(", ")}`);
  }
  if (!ok) continue;
  const eq = equity(), size = Math.min(eq * C.sizePct / 100, c.liq * C.maxLiqPct / 100, S.cash * 0.98);
  if (size < 10) break;
  const cf = C.strat[c.strat], px0 = n(p.priceUsd), entry = px0 * (1 + slip(size, c.liq));
  const units = (size * (1 - C.fee)) / entry;
  S.cash -= size; S.seq++;
  S.open.push({ id: `${now.toString(36)}${S.seq}`, sym: p.baseToken.symbol, name: p.baseToken.name, ds: u.ds, net: CHAINS[u.ds], addr: u.addr, pair: p.pairAddress, url: p.url, strat: c.strat, t0: now,
    entry, size, units, sl: entry * (1 - cf.sl), sl0: entry * (1 - cf.sl), tp1: entry * (1 + cf.tp1), peak: entry, tp1Hit: false, real: 0, px: px0, liq0: c.liq, liq: c.liq, chk: now, miss: 0, why: c.why });
  added++;
  console.log(`OPEN ${p.baseToken.symbol} ${c.strat} size ${size.toFixed(0)}`);
}
if (dayStop) console.log("daily loss stop active, no new entries");

for (const k of Object.keys(S.cool)) if (now - S.cool[k] > 48 * 36e5) delete S.cool[k];
for (const k of Object.keys(S.sec)) if (now - S.sec[k].at > 24 * 36e5) delete S.sec[k];
S.closed = S.closed.slice(0, 300);
S.curve.push([now, +equity().toFixed(2)]); S.curve = S.curve.slice(-1200);
S.equity = +equity().toFixed(2);
// KV free tier = 1000 writes/day: write on trade changes, otherwise at most every 30 min
const changed = fp(S) !== S._fp || !S.upd || now - S.upd >= 30 * 6e4;
if (changed) { S.upd = now; delete S._fp; await save(S); } else console.log("no change, KV write skipped");
console.log(`equity ${S.equity} cash ${S.cash.toFixed(2)} open ${S.open.length} closed ${S.closed.length}`);
