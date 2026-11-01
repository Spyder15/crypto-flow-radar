// Refresh smc-screener/whales.json: node bot/whales-list.mjs
// Picks large, consistently profitable Hyperliquid wallets from the public leaderboard.
import { writeFileSync } from "node:fs";
const N = 25;
const lb = await (await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard")).json();
const perf = (r, w) => +(r.windowPerformances.find((x) => x[0] === w)?.[1].pnl || 0);
const cand = lb.leaderboardRows
  .filter((r) => +r.accountValue > 2e6 && perf(r, "week") > 0 && perf(r, "month") > 0 && perf(r, "allTime") > 1e6)
  .sort((a, b) => perf(b, "allTime") - perf(a, "allTime"))
  .slice(0, 120);
const out = [];
for (const r of cand) {
  const s = await (await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "clearinghouseState", user: r.ethAddress }) })).json();
  if (!s.assetPositions?.length) continue; // only wallets that trade perps with open positions today
  out.push({ a: r.ethAddress, name: r.displayName || null, month: Math.round(perf(r, "month")), all: Math.round(perf(r, "allTime")) });
  if (out.length >= N) break;
}
writeFileSync(new URL("../smc-screener/whales.json", import.meta.url), JSON.stringify({ updated: new Date().toISOString(), wallets: out }, null, 1));
console.log("wrote", out.length);
