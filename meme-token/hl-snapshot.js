// Builds site/hl-snap.json: top Hyperliquid traders + vaults (the source files are 15-40 MB and have no CORS).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const S = "https://stats-data.hyperliquid.xyz/Mainnet/";
const win = (r, k) => (r.windowPerformances.find((w) => w[0] === k) || [0, {}])[1];

(async () => {
  const lb = (await (await fetch(S + "leaderboard")).json()).leaderboardRows;
  const traders = lb.map((r) => {
    const d = win(r, "day"), w = win(r, "week"), m = win(r, "month"), a = win(r, "allTime");
    return { a: r.ethAddress, n: r.displayName || null, av: +r.accountValue, pd: +d.pnl, pw: +w.pnl, pm: +m.pnl, pa: +a.pnl, rm: +m.roi, rw: +w.roi, vm: +m.vlm };
  });
  const byAv = traders.filter((t) => t.pw !== 0 || t.pm !== 0 || t.vm > 0).sort((a, b) => b.av - a.av).slice(0, 150);
  const byPm = traders.filter((t) => t.av > 50000 && t.vm > 1e6).sort((a, b) => b.pm - a.pm).slice(0, 100);
  const vaults = (await (await fetch(S + "vaults")).json())
    .filter((v) => !v.summary.isClosed)
    .map((v) => ({ n: v.summary.name, a: v.summary.vaultAddress, l: v.summary.leader, tvl: +v.summary.tvl, apr: v.apr, pm: +(v.pnls.find((p) => p[0] === "month")?.[1].at(-1) || 0), created: v.summary.createTimeMillis }))
    .sort((a, b) => b.tvl - a.tvl).slice(0, 100);
  fs.mkdirSync(dir + "/site", { recursive: true });
  fs.writeFileSync(dir + "/site/hl-snap.json", JSON.stringify({ ts: Date.now(), count: traders.length, whales: byAv, top: byPm, vaults }));
  console.log("hl-snap", byAv.length, byPm.length, vaults.length);
})();
