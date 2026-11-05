// Pure settlement logic: no network, fully testable.
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_DECIMALS = 6;
export const MIN_CONFIRMATIONS = 5;

export const toUnits = (usd) => BigInt(Math.round(Number(usd) * 10 ** USDC_DECIMALS));

export function createRequest({ id, merchant, amountUsd, ttlSec = 900, now = Date.now() }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(merchant)) throw new Error('bad merchant address');
  const amount = toUnits(amountUsd);
  if (amount <= 0n) throw new Error('amount must be > 0');
  return {
    id,
    merchant: merchant.toLowerCase(),
    amount,
    createdAt: now,
    expiresAt: now + ttlSec * 1000,
    status: 'pending',
    settlement: null,
  };
}

// transfer: { txHash, logIndex, token, to, from, value: bigint, blockNumber: bigint, blockTime: ms }
// usedTransfers: Set of `${txHash}:${logIndex}` already credited to a request (replay protection).
export function evaluate(req, transfer, { head, usedTransfers = new Set() }) {
  if (req.status === 'settled' || req.status === 'refund_due') return req;
  const key = `${transfer.txHash}:${transfer.logIndex}`;
  const reject = (reason) => ({ ...req, status: 'rejected', reason });

  if (usedTransfers.has(key)) return reject('transfer_already_used');
  if (transfer.token.toLowerCase() !== USDC_BASE.toLowerCase()) return reject('wrong_token');
  if (transfer.to.toLowerCase() !== req.merchant) return reject('wrong_recipient');
  if (transfer.blockTime > req.expiresAt) {
    return { ...req, status: 'refund_due', reason: 'paid_after_expiry', refund: transfer.value, payer: transfer.from, settlement: key };
  }
  if (transfer.value < req.amount) {
    return { ...req, status: 'underpaid', reason: 'short_by', shortBy: req.amount - transfer.value, payer: transfer.from, settlement: key };
  }
  const confirmations = head - transfer.blockNumber + 1n;
  if (confirmations < BigInt(MIN_CONFIRMATIONS)) {
    return { ...req, status: 'confirming', confirmations: Number(confirmations), payer: transfer.from, settlement: key };
  }
  const excess = transfer.value - req.amount;
  return { ...req, status: 'settled', payer: transfer.from, settlement: key, refund: excess };
}

export function expireIfDue(req, now = Date.now()) {
  return req.status === 'pending' && now > req.expiresAt ? { ...req, status: 'expired' } : req;
}
