// Automated liquidity provider: stakes, accepts open orders it can afford, pays the merchant via a payout
// adapter, then submits proof. The default adapter is a MOCK that invents a UTR; swap in a real bank/UPI payout.
const { ethers } = require('ethers');

const BASE = process.env.APP_URL || 'http://localhost:8788';
const POLL_MS = 3000;

const ESCROW_ABI = [
  'function orders(uint256) view returns (address payer,address lp,uint256 amount,uint256 inrPaise,bytes32 upiHash,uint64 acceptedAt,uint8 status,uint64 provenAt,bytes32 utrHash,uint256 lockedStake)',
  'function nextId() view returns (uint256)',
  'function stake(address) view returns (uint256)',
  'function stakeBps() view returns (uint256)',
  'function acceptOrder(uint256)',
  'function submitProof(uint256,bytes32,bytes)',
  'function depositStake(uint256)',
];

async function api(path, body) {
  const r = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
const auth = async (wallet, action, id) => {
  const ts = Math.floor(Date.now() / 1000);
  return { ts, sig: await wallet.signMessage(`upipay:${action}:${id}:${ts}`) };
};

// Replace with a real payout (bank API / UPI). Must return the UTR of a payment that actually happened.
async function payMerchant({ upi, inrPaise }) {
  console.log(`  [mock payout] ₹${Number(inrPaise) / 100} -> ${upi}`);
  return 'BOT' + Date.now().toString(36).toUpperCase();
}

async function main() {
  const cfg = await api('/api/config');
  const provider = new ethers.JsonRpcProvider(cfg.rpc, undefined, { cacheTimeout: -1 });
  const key = process.env.LP_KEY || ethers.Wallet.createRandom().privateKey;
  const wallet = new ethers.Wallet(key, provider);
  const escrow = new ethers.Contract(cfg.escrow, ESCROW_ABI, wallet);
  const usdc = new ethers.Contract(cfg.usdc, ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], wallet);
  console.log('LP bot', wallet.address);

  if (cfg.faucet && (await usdc.balanceOf(wallet.address)) === 0n) await api('/api/faucet', { address: wallet.address });
  const want = BigInt(process.env.STAKE_USDC || 20) * 1_000_000n;
  if ((await escrow.stake(wallet.address)) < want / 2n && (await usdc.balanceOf(wallet.address)) >= want) {
    await (await usdc.approve(cfg.escrow, want)).wait();
    await (await escrow.depositStake(want)).wait();
    console.log('  staked', Number(want) / 1e6, 'USDC');
  }
  const bps = await escrow.stakeBps();
  const inFlight = new Set();

  const step = async (id) => {
    const o = await escrow.orders(id);
    const status = Number(o.status);
    if (status === 1 && (await escrow.stake(wallet.address)) >= (o.amount * bps) / 10000n) {
      await (await escrow.acceptOrder(id)).wait();
      console.log(`accepted #${id}`);
    } else if (status === 2 && o.lp.toLowerCase() === wallet.address.toLowerCase()) {
      const a = await auth(wallet, 'meta', id);
      const m = await api(`/api/meta?id=${id}&ts=${a.ts}&sig=${a.sig}`);
      const utr = await payMerchant({ upi: m.upi, inrPaise: o.inrPaise });
      const p = await api('/api/proof', { id: String(id), utr, ...(await auth(wallet, 'proof', id)) });
      await (await escrow.submitProof(id, p.utrHash, p.sig)).wait();
      console.log(`proof submitted #${id} (${utr})`);
    }
  };

  setInterval(async () => {
    const n = Number(await escrow.nextId().catch(() => 1));
    for (let id = 1; id < n; id++) {
      if (inFlight.has(id)) continue;
      inFlight.add(id);
      step(id).catch((e) => console.error(`#${id}:`, e.shortMessage || e.message)).finally(() => inFlight.delete(id));
    }
  }, POLL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
