// Meme token scanner (all chains). Public APIs only, no keys: DexScreener for new/boosted tokens + pairs, GoPlus for rug checks.
// Alerts to Telegram if TG_TOKEN / TG_CHAT are set. Scanner only: never buys anything.
import fs from "node:fs";
import { n, getJson, rugCheck } from "./lib.js";

const cfg = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url)));
const STATE = new URL("./state.json", import.meta.url), DRY = process.argv.includes("--dry");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : { seen: {} };
const j = getJson;
const usd = (x) => (x >= 1e6 ? (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : x.toFixed(0));
const esc = (s) => String(s).replace(/[<>&]/g, "");

async function candidates() {
  const out = new Map();
  for (const u of ["https://api.dexscreener.com/token-profiles/latest/v1", "https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-boosts/top/v1"]) {
    try { for (const t of await j(u)) out.set(`${t.chainId}:${t.tokenAddress}`, t); } catch (e) { console.log("source failed", e.message); }
  }
  return [...out.values()];
}

// DexScreener returns every pair of a token; keep the most liquid pair per token.
async function pairsFor(cands) {
  const best = new Map();
  for (let i = 0; i < cands.length; i += 30) {
    const chunk = cands.slice(i, i + 30);
    try {
      const res = await j("https://api.dexscreener.com/latest/dex/tokens/" + chunk.map((c) => c.tokenAddress).join(","));
      for (const p of res.pairs || []) {
        const k = `${p.chainId}:${p.baseToken.address}`;
        if (chunk.some((c) => `${c.chainId}:${c.tokenAddress}`.toLowerCase() === k.toLowerCase()) && (!best.has(k) || n(p.liquidity?.usd) > n(best.get(k).liquidity?.usd))) best.set(k, p);
      }
    } catch (e) { console.log("pairs failed", e.message); }
  }
  return [...best.values()];
}

function market(p) {
  const why = [], age = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 6e4 : null, liq = n(p.liquidity?.usd), v1 = n(p.volume?.h1), fdv = n(p.fdv);
  const b5 = n(p.txns?.m5?.buys), s5 = n(p.txns?.m5?.sells), ratio = s5 ? b5 / s5 : b5 ? 9 : 0;
  if (age === null || age < cfg.minAgeMinutes || age > cfg.maxAgeHours * 60) return null;
  if (liq < cfg.minLiquidityUsd || v1 < cfg.minVolume1hUsd) return null;
  if (b5 + s5 > 0 && ratio < cfg.minBuySellRatio5m) return null;
  if (fdv && liq / fdv < cfg.maxLiqToFdvMin) return null; // liquidity tiny vs market cap: easy to dump
  if (v1 > liq * 0.5) why.push("volume strong vs liquidity");
  if (n(p.priceChange?.h1) > 5) why.push(`+${n(p.priceChange.h1).toFixed(0)}% 1h`);
  if (ratio > 1.3) why.push("more buys than sells");
  return { age, liq, v1, fdv, ratio, why };
}

async function tg(text) {
  console.log(text.replace(/<[^>]+>/g, "") + "\n");
  if (DRY || !process.env.TG_TOKEN || !process.env.TG_CHAT) return;
  try { await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TG_CHAT, parse_mode: "HTML", text, disable_web_page_preview: true }) }); } catch (e) { console.log("telegram failed", e.message); }
}

const cands = await candidates(), pairs = await pairsFor(cands);
console.log(`candidates ${cands.length}, with pairs ${pairs.length}`);
let sent = 0, passedMarket = 0;
for (const p of pairs.sort((a, b) => n(b.volume?.h1) - n(a.volume?.h1))) {
  if (sent >= cfg.maxAlertsPerRun) break;
  const key = `${p.chainId}:${p.baseToken.address}`;
  if (state.seen[key] && Date.now() - state.seen[key] < cfg.alertCooldownHours * 36e5) continue;
  const m = market(p); if (!m) continue;
  passedMarket++;
  const rc = await rugCheck(p.chainId, p.baseToken.address, cfg);
  if (!rc.ok) { console.log(`skip ${p.baseToken.symbol} (${p.chainId}): ${rc.flags.join(", ")}`); continue; }
  state.seen[key] = Date.now(); sent++;
  const chg = p.priceChange || {};
  await tg([
    `🪙 <b>${esc(p.baseToken.symbol)}</b> (${esc(p.baseToken.name)})  |  ${p.chainId.toUpperCase()}`,
    `Age ${m.age < 120 ? m.age.toFixed(0) + "m" : (m.age / 60).toFixed(1) + "h"}  |  Liq $${usd(m.liq)}  |  Vol 1h $${usd(m.v1)}${m.fdv ? `  |  MC $${usd(m.fdv)}` : ""}`,
    `Price ${n(chg.m5).toFixed(1)}% 5m  ${n(chg.h1).toFixed(1)}% 1h  ${n(chg.h24).toFixed(1)}% 24h`,
    `Buys/Sells 5m: ${n(p.txns?.m5?.buys)}/${n(p.txns?.m5?.sells)}  |  1h: ${n(p.txns?.h1?.buys)}/${n(p.txns?.h1?.sells)}`,
    m.why.length ? `📈 ${m.why.join(", ")}` : "",
    `🛡 Rug check passed${rc.notes.length ? ": " + rc.notes.join(", ") : ""}`,
    `<code>${p.baseToken.address}</code>`,
    `<a href="${p.url}">Chart</a>` + (p.chainId === "solana" ? ` | <a href="https://rugcheck.xyz/tokens/${p.baseToken.address}">RugCheck</a>` : ""),
    "<i>Scanner only, not financial advice. Passing checks does not make a meme coin safe. Never risk money you can't lose.</i>",
  ].filter(Boolean).join("\n"));
}
for (const k of Object.keys(state.seen)) if (Date.now() - state.seen[k] > 7 * 864e5) delete state.seen[k];
if (!DRY) fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
console.log(`done: passed market filter ${passedMarket}, alerts ${sent}`);
