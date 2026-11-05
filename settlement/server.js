import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { createRequest, evaluate, expireIfDue, USDC_BASE } from './core.js';
import { getHead, transfersInTx } from './chain.js';
import { saveRequest, getRequest, listByMerchant, claimTransfer, transferOwner, ser } from './db.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const INDEX = new URL('./public/index.html', import.meta.url);

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(ser(body));
};
const readBody = (req) => new Promise((ok, fail) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 10_000) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
});

async function notify(r) {
  if (!WEBHOOK_URL) return;
  const body = ser(r);
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body }).catch(() => {});
}

// EIP-681 URI: wallets that support it prefill a USDC transfer on Base.
const payUri = (r) => `ethereum:${USDC_BASE}@8453/transfer?address=${r.merchant}&uint256=${r.amount}`;

// The payer posts a tx hash; we verify on-chain instead of trusting the claim.
// Re-running this for a still-confirming tx also catches reorgs (receipt disappears).
async function verify(r, txHash) {
  const head = await getHead();
  let transfers = [];
  try { transfers = await transfersInTx(txHash); } catch { /* receipt not found yet */ }
  const hit = transfers.find((t) => t.token.toLowerCase() === USDC_BASE.toLowerCase() && t.to.toLowerCase() === r.merchant);
  if (!hit) {
    if (r.status === 'confirming') return { ...r, status: 'pending', txHash: undefined, confirmations: undefined, settlement: null };
    return { ...r, txHash, status: 'rejected', reason: transfers.length ? 'wrong_token_or_recipient' : 'no_transfer_found' };
  }
  const key = `${hit.txHash}:${hit.logIndex}`;
  const owner = transferOwner(key);
  const usedTransfers = new Set(owner && owner !== r.id ? [key] : []);
  const next = { ...evaluate(r, hit, { head, usedTransfers }), txHash };
  if (next.settlement && !['confirming', 'rejected'].includes(next.status) && !claimTransfer(key, r.id) && transferOwner(key) !== r.id) {
    return { ...r, txHash, status: 'rejected', reason: 'transfer_already_used' };
  }
  return next;
}

async function refresh(r) {
  const before = r.status;
  r = expireIfDue(r);
  if (r.status === 'confirming' && r.txHash) r = await verify(r, r.txHash);
  if (r.status !== before) { saveRequest(r); await notify(r); }
  return r;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(INDEX));
    }
    if (req.method === 'GET' && url.pathname === '/requests') {
      const m = url.searchParams.get('merchant') || '';
      if (!/^0x[0-9a-fA-F]{40}$/.test(m)) return json(res, 400, { error: 'bad_merchant' });
      return json(res, 200, listByMerchant(m).map((r) => ({ ...r, payUri: payUri(r) })));
    }
    if (req.method === 'POST' && url.pathname === '/requests') {
      const b = await readBody(req);
      const r = createRequest({ id: crypto.randomUUID(), merchant: b.merchant, amountUsd: b.amountUsd, ttlSec: b.ttlSec });
      saveRequest(r);
      return json(res, 201, { ...r, payUri: payUri(r) });
    }
    const m = url.pathname.match(/^\/requests\/([\w-]+)(\/claim|\/qr\.svg)?$/);
    if (m) {
      let r = getRequest(m[1]);
      if (!r) return json(res, 404, { error: 'not_found' });
      if (req.method === 'GET' && m[2] === '/qr.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end(await QRCode.toString(payUri(r), { type: 'svg', margin: 1 }));
      }
      if (req.method === 'POST' && m[2] === '/claim') {
        const { txHash } = await readBody(req);
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) return json(res, 400, { error: 'bad_txHash' });
        const before = r.status;
        r = await verify(expireIfDue(r), txHash);
        saveRequest(r);
        if (r.status !== before) await notify(r);
        return json(res, 200, { ...r, payUri: payUri(r) });
      }
      if (req.method === 'GET' && !m[2]) {
        r = await refresh(r);
        return json(res, 200, { ...r, payUri: payUri(r) });
      }
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(process.env.PORT || 8787, () => console.log('settlement api up'));
