// Paper trading account on top of the main strategy: fixed $ risk per trade, hard max drawdown kill switch. No real orders are ever placed.
const KEY = "paper:acct", FEE = 0.0011; // 0.055% taker per side, round trip on notional

const load = async (env) => (await env.TRADES.get(KEY, "json")) || { start: +env.PAPER_START || 100, equity: +env.PAPER_START || 100, peak: +env.PAPER_START || 100, open: {}, n: 0, wins: 0, halted: false, alerted: false };
const save = (env, a) => env.TRADES.put(KEY, JSON.stringify(a));
const floorOf = (env, a) => a.start * (1 - (+env.PAPER_MAX_DD || 3) / 100);

// Returns { riskUsd, qty, notional } if the trade fits the account, else null. Open risk can never exceed the room left before the drawdown limit.
export async function paperOpen(env, t) {
  if (env.PAPER !== "1") return null;
  const a = await load(env), risk = a.start * ((+env.PAPER_RISK || 1) / 100), dist = Math.abs(t.entry - t.sl);
  const p = { riskUsd: +risk.toFixed(2), qty: risk / dist, notional: (risk / dist) * t.entry };
  // worst case per trade = full stop loss plus fees, so the drawdown limit can never be exceeded
  const worst = (x) => x.riskUsd + x.notional * FEE, openRisk = Object.values(a.open).reduce((s, x) => s + worst(x), 0);
  if (a.halted || !(dist > 0) || openRisk + worst(p) > a.equity - floorOf(env, a)) return null;
  a.open[`${t.sym}:${t.tf}:${t.t0}`] = p;
  await save(env, a);
  return p;
}

export async function paperClose(env, t) {
  if (env.PAPER !== "1" || !t.paper) return;
  const a = await load(env), k = `${t.sym}:${t.tf}:${t.t0}`;
  if (!a.open[k]) return; // already booked
  const p = a.open[k], pnl = (t.r ?? 0) * p.riskUsd - p.notional * FEE;
  delete a.open[k];
  a.equity = +(a.equity + pnl).toFixed(4); a.peak = Math.max(a.peak, a.equity); a.n++; if (pnl > 0) a.wins++;
  if (a.equity <= floorOf(env, a)) a.halted = true;
  await save(env, a);
}

export async function paperStatus(env) {
  const a = await load(env), dd = ((a.peak - a.equity) / a.start) * 100;
  return { ...a, pnl: +(a.equity - a.start).toFixed(2), drawdownPct: +dd.toFixed(2), floor: floorOf(env, a), openCount: Object.keys(a.open).length };
}

export function paperText(a) {
  return [`📒 <b>PAPER ACCOUNT</b> (fake money, $${a.start} start)`, `Equity: <b>$${a.equity.toFixed(2)}</b>  (${a.pnl >= 0 ? "+" : ""}$${a.pnl})`, `Closed: ${a.n}  |  Wins: ${a.wins}  |  Open: ${a.openCount}`, `Drawdown from peak: ${a.drawdownPct}%  (limit stops at $${a.floor.toFixed(2)})`, a.halted ? "🛑 <b>HALTED: max drawdown hit. No new paper trades.</b>" : "🟢 Trading active"].join("\n");
}

export async function paperReset(env) { await env.TRADES.delete(KEY); }

// Called by the watchdog slot: one-time Telegram alert when the kill switch trips.
export async function paperWatch(env, send) {
  if (env.PAPER !== "1") return;
  const a = await load(env);
  if (a.halted && !a.alerted) { await send(paperText(await paperStatus(env))); a.alerted = true; await save(env, a); }
}
