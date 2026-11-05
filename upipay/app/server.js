// Dev backend: serves the apps, stores the merchant UPI id off-chain, and acts as the MOCK attestor.
// In production the attestor is replaced by real proof of the UPI payout (e.g. zkTLS / bank attestation).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const { getRate } = require('./rate');
const providers = require('./providers');

const ESCROW_ABI = [
  'function orders(uint256) view returns (address payer,address lp,uint256 amount,uint256 inrPaise,bytes32 upiHash,uint64 acceptedAt,uint8 status,uint64 provenAt,bytes32 utrHash,uint256 lockedStake)',
  'function nextId() view returns (uint256)',
  'function resolve(uint256 id, bool payLp)',
];

// Wallet-signed requests: `upipay:<action>:<id>:<ts>` signed by the order's payer or LP, valid for 5 minutes.
function signedBy(action, id, ts, sig, expected) {
  try {
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    return ethers.verifyMessage(`upipay:${action}:${id}:${ts}`, String(sig)).toLowerCase() === expected.toLowerCase();
  } catch { return false; }
}

const IST = 5.5 * 3600;
const istDay = (ts) => Math.floor((ts + IST) / 86400);
function streak(days) {
  const today = istDay(Math.floor(Date.now() / 1000));
  let run = 0;
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) run++;
  // Week is Mon..Sun; day 0 (1970-01-01) was a Thursday.
  const dow = (today + 3) % 7; // 0 = Monday
  const week = [];
  for (let i = 0; i < 7; i++) { const d = today - dow + i; week.push(d > today ? 'future' : days.has(d) ? 'paid' : 'missed'); }
  const weeksCompleted = Math.floor(run / 7);
  return { current: run, week, today: dow, points: weeksCompleted * 10, paidToday: days.has(today) };
}

let faucetQueue = Promise.resolve();
async function start({ rpc, escrow, usdc, attestorKey, arbiterKey, rate: fallbackRate, spreadPct = 1, enableFaucet = true, fromBlock = 0, port = 8788, chainId }) {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  const attestor = new ethers.Wallet(attestorKey);
  const contract = new ethers.Contract(escrow, ESCROW_ABI, provider);
  const meta = new Map(); // orderId -> { upi, name }
  const utrs = new Map(); // orderId -> plain UTR, shown only to the payer
  const root = path.join(__dirname, '..');
  const files = {
    '/': ['public/payer.html', 'text/html'],
    '/lp': ['public/lp.html', 'text/html'],
    '/arbiter': ['public/arbiter.html', 'text/html'],
    '/receipt': ['public/receipt.html', 'text/html'],
    '/profile': ['public/profile.html', 'text/html'],
    '/emv.js': ['public/emv.js', 'text/javascript'],
    '/manifest.webmanifest': ['public/manifest.webmanifest', 'application/manifest+json'],
    '/sw.js': ['public/sw.js', 'text/javascript'],
    '/icon.svg': ['public/icon.svg', 'image/svg+xml'],
    '/common.js': ['public/common.js', 'text/javascript'],
    '/ethers.js': ['node_modules/ethers/dist/ethers.umd.min.js', 'text/javascript'],
    '/jsqr.js': ['node_modules/jsqr/dist/jsQR.js', 'text/javascript'],
  };
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const body = (req) => new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 10_000) req.destroy(); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (files[url.pathname] && req.method === 'GET') {
        res.writeHead(200, { 'content-type': files[url.pathname][1] });
        return res.end(fs.readFileSync(path.join(root, files[url.pathname][0])));
      }
      if (url.pathname === '/api/config') {
        const r = await getRate({ fallback: fallbackRate, spreadPct });
        return send(res, 200, { rpc, escrow, usdc, chainId, rate: r.rate, market: r.market, rateSource: r.source, spreadPct, faucet: enableFaucet, fromBlock, devArbiter: !!arbiterKey });
      }

      // Local-chain faucet only
      if (url.pathname === '/api/faucet' && req.method === 'POST' && enableFaucet) {
        const { address } = await body(req);
        if (!ethers.isAddress(address)) return send(res, 400, { error: 'bad_address' });
        const funder = new ethers.Wallet(process.env.FAUCET_KEY || attestorKey, provider);
        const token = new ethers.Contract(usdc, ['function mint(address,uint256)'], funder);
        // One faucet tx pair at a time so concurrent requests don't reuse a nonce.
        faucetQueue = faucetQueue.catch(() => {}).then(async () => {
          await (await token.mint(address, 50_000_000n)).wait();
          await (await funder.sendTransaction({ to: address, value: ethers.parseEther('0.05') })).wait();
        });
        await faucetQueue;
        return send(res, 200, { ok: true });
      }

      // Payer registers the plain UPI id; it must hash to what the order committed on-chain.
      if (url.pathname === '/api/meta' && req.method === 'POST') {
        const { id, upi, name } = await body(req);
        const o = await contract.orders(id);
        if (Number(o.status) === 0 || ethers.id(String(upi)) !== o.upiHash) return send(res, 400, { error: 'upi_mismatch' });
        meta.set(String(id), { upi: String(upi), name: String(name || '').slice(0, 80) });
        return send(res, 200, { ok: true });
      }

      // Only the LP that accepted the order may see where to pay.
      if (url.pathname === '/api/meta' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        const o = await contract.orders(id);
        if (Number(o.status) !== 2 || !signedBy('meta', id, url.searchParams.get('ts'), url.searchParams.get('sig'), o.lp)) return send(res, 403, { error: 'not_your_order' });
        return send(res, 200, meta.get(String(id)) || {});
      }

      // MOCK proof: trusts the LP's UTR. Replace with real verification before any real money.
      if (url.pathname === '/api/proof' && req.method === 'POST') {
        const { id, utr, ts, sig } = await body(req);
        const o = await contract.orders(id);
        if (Number(o.status) !== 2) return send(res, 400, { error: 'not_accepted' });
        if (!signedBy('proof', id, ts, sig, o.lp)) return send(res, 403, { error: 'not_your_order' });
        const v = await providers.verifyPayout({ upiId: meta.get(String(id))?.upi, inrPaise: o.inrPaise, utr });
        if (!v.ok) return send(res, 400, { error: v.reason || 'payout_not_verified' });
        const utrHash = ethers.id(String(utr));
        utrs.set(String(id), String(utr));
        const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'address', 'uint256', 'address', 'uint256', 'bytes32'],
          [chainId, escrow, id, o.lp, o.inrPaise, utrHash]));
        return send(res, 200, { utrHash, sig: await attestor.signMessage(ethers.getBytes(inner)) });
      }
      if (url.pathname === '/api/vpa' && req.method === 'GET') {
        const v = await providers.validateVpa(url.searchParams.get('upi') || '');
        return send(res, 200, v ? { verified: true, name: v.name } : { verified: false });
      }

      // Streak: consecutive IST days with a paid order, derived from on-chain proof times.
      if (url.pathname === '/api/streak' && req.method === 'GET') {
        const who = (url.searchParams.get('address') || '').toLowerCase();
        const n = Number(await contract.nextId());
        const days = new Set();
        for (let id = 1; id < n; id++) {
          const o = await contract.orders(id);
          if (o.payer.toLowerCase() === who && Number(o.status) === 3) days.add(istDay(Number(o.provenAt)));
        }
        return send(res, 200, streak(days));
      }

      // Payer-only receipt: UTR must hash to what the escrow recorded.
      if (url.pathname === '/api/receipt' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        const o = await contract.orders(id);
        const utr = utrs.get(String(id));
        if (!signedBy('receipt', id, url.searchParams.get('ts'), url.searchParams.get('sig'), o.payer) || !utr || ethers.id(utr) !== o.utrHash) return send(res, 403, { error: 'no_receipt' });
        return send(res, 200, { utr, merchant: meta.get(String(id)) || {} });
      }

      // DEV ONLY: the arbiter key lives in this process. Real deployments need an authenticated arbiter flow.
      if (url.pathname === '/api/resolve' && req.method === 'POST' && arbiterKey) {
        const { id, payLp } = await body(req);
        const c = new ethers.Contract(escrow, ESCROW_ABI, new ethers.Wallet(arbiterKey, provider));
        await (await c.resolve(id, !!payLp)).wait();
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      send(res, 500, { error: String(e.shortMessage || e.message || e) });
    }
  });
  await new Promise((ok) => server.listen(port, ok));
  return server;
}

module.exports = { start, streak, istDay };
