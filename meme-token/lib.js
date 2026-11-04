// Shared helpers: JSON fetch and the GoPlus rug check used by the scanner and the website feed.
export const n = (x) => (Number.isFinite(+x) ? +x : 0);
const H = { "user-agent": "Mozilla/5.0", accept: "application/json" };
export const getJson = async (url) => { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
export const GOPLUS_EVM = { ethereum: 1, eth: 1, bsc: 56, base: 8453, arbitrum: 42161, polygon: 137, avalanche: 43114, optimism: 10, linea: 59144, blast: 81457, zksync: 324, scroll: 534352, mantle: 5000 };

// Returns { ok, flags[], notes[] }. A token with any critical flag is never alerted.
export async function rugCheck(chain, addr, cfg) {
  const j = getJson;
  const flags = [], notes = []; let top10v = null, holdersv = null;
  try {
    if (chain === "solana") {
      const t = (await j(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${addr}`)).result?.[addr];
      if (!t) return { ok: false, flags: ["no security data"], notes };
      if (t.mintable?.status === "1") flags.push("mint authority active");
      if (t.freezable?.status === "1") flags.push("freeze authority active");
      if (t.closable?.status === "1") flags.push("closable");
      if (t.balance_mutable_authority?.status === "1") flags.push("balances can be changed by authority");
      if (t.non_transferable === "1") flags.push("non-transferable");
      if (t.transfer_fee && Object.keys(t.transfer_fee).length && n(t.transfer_fee.current_fee_rate?.fee_rate) > 0) flags.push("transfer fee");
      const top10 = (t.holders || []).slice(0, 10).reduce((a, h) => a + n(h.percent) * 100, 0);
      if (top10 > cfg.maxTop10HolderPct && top10 <= 100) flags.push(`top10 holders ${top10.toFixed(0)}%`);
      else if (top10) notes.push(`top10 holders ${top10.toFixed(0)}%`);
      top10v = top10;
      if (t.holder_count) { notes.push(`${t.holder_count} holders`); holdersv = n(t.holder_count); }
    } else if (GOPLUS_EVM[chain]) {
      const t = (await j(`https://api.gopluslabs.io/api/v1/token_security/${GOPLUS_EVM[chain]}?contract_addresses=${addr}`)).result?.[addr.toLowerCase()];
      if (!t) return { ok: false, flags: ["no security data"], notes };
      if (t.is_honeypot === "1") flags.push("HONEYPOT");
      if (t.cannot_sell_all === "1") flags.push("cannot sell all");
      if (t.is_open_source === "0") flags.push("contract not verified");
      if (t.is_mintable === "1") flags.push("mintable");
      if (t.hidden_owner === "1" || t.can_take_back_ownership === "1") flags.push("hidden owner");
      if (t.transfer_pausable === "1") flags.push("transfer can be paused");
      if (t.is_blacklisted === "1") flags.push("blacklist function");
      if (n(t.sell_tax) * 100 > cfg.maxSellTaxPct) flags.push(`sell tax ${(n(t.sell_tax) * 100).toFixed(0)}%`);
      if (n(t.buy_tax) * 100 > cfg.maxBuyTaxPct) flags.push(`buy tax ${(n(t.buy_tax) * 100).toFixed(0)}%`);
      const top10 = (t.holders || []).slice(0, 10).filter((h) => h.is_contract !== 1 && !h.is_locked).reduce((a, h) => a + n(h.percent) * 100, 0);
      if (top10 > cfg.maxTop10HolderPct && top10 <= 100) flags.push(`top10 holders ${top10.toFixed(0)}%`);
      else if (top10) notes.push(`top10 holders ${top10.toFixed(0)}%`);
      top10v = top10;
      if (t.holder_count) { notes.push(`${t.holder_count} holders`); holdersv = n(t.holder_count); }
    } else return { ok: false, flags: ["chain not covered by rug check"], notes };
  } catch (e) { return { ok: false, flags: ["rug check failed: " + e.message], notes }; }
  if (top10v > 100) top10v = null; // bad holder data (e.g. pool contracts counted)
  return { ok: !flags.length, flags, notes, top10: top10v, holders: holdersv, level: !flags.length ? "good" : flags.some((f) => /HONEYPOT|mint|freeze|cannot sell|tax|non-transferable|closable|balances|hidden/i.test(f)) ? "risk" : "warn" };
}

