import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequest, evaluate, expireIfDue, USDC_BASE } from './core.js';

const M = '0x' + '1'.repeat(40);
const mk = () => createRequest({ id: 'a', merchant: M, amountUsd: 10, now: 1000, ttlSec: 100 });
const tr = (o = {}) => ({ txHash: '0xabc', logIndex: 0, token: USDC_BASE, to: M, from: '0x' + '2'.repeat(40), value: 10_000_000n, blockNumber: 100n, blockTime: 2000, ...o });

test('settles with enough confirmations', () => {
  assert.equal(evaluate(mk(), tr(), { head: 110n }).status, 'settled');
});
test('waits for confirmations', () => {
  assert.equal(evaluate(mk(), tr(), { head: 101n }).status, 'confirming');
});
test('underpayment is not settled', () => {
  const r = evaluate(mk(), tr({ value: 9_000_000n }), { head: 110n });
  assert.equal(r.status, 'underpaid');
  assert.equal(r.shortBy, 1_000_000n);
});
test('overpayment settles and flags excess refund', () => {
  const r = evaluate(mk(), tr({ value: 12_000_000n }), { head: 110n });
  assert.equal(r.status, 'settled');
  assert.equal(r.refund, 2_000_000n);
});
test('wrong token rejected', () => {
  assert.equal(evaluate(mk(), tr({ token: '0x' + '9'.repeat(40) }), { head: 110n }).reason, 'wrong_token');
});
test('replayed transfer rejected', () => {
  assert.equal(evaluate(mk(), tr(), { head: 110n, usedTransfers: new Set(['0xabc:0']) }).reason, 'transfer_already_used');
});
test('late payment becomes refund_due', () => {
  assert.equal(evaluate(mk(), tr({ blockTime: 999999 }), { head: 110n }).status, 'refund_due');
});
test('pending request expires', () => {
  assert.equal(expireIfDue(mk(), 999999).status, 'expired');
});
