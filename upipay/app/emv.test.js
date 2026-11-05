const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmv, crc16 } = require('../public/emv.js');
const { streak, istDay } = require('./server.js');

// Builds a valid EMV QR from [tag, value] pairs.
const build = (fields) => {
  const body = fields.map(([t, v]) => t + String(v.length).padStart(2, '0') + v).join('') + '6304';
  return body + crc16(body);
};

test('parses a PIX QR', () => {
  const gui = '0014BR.GOV.BCB.PIX0114+5511999999999';
  const q = build([['00', '01'], ['26', gui], ['52', '0000'], ['53', '986'], ['54', '25.50'], ['58', 'BR'], ['59', 'LOJA TESTE'], ['60', 'SAO PAULO']]);
  const r = parseEmv(q);
  assert.equal(r.scheme, 'PIX'); assert.equal(r.currency, 'BRL'); assert.equal(r.amount, 25.5);
  assert.equal(r.name, 'LOJA TESTE'); assert.ok(r.crcOk);
});

test('parses a QRIS QR and flags a bad CRC', () => {
  const q = build([['00', '01'], ['26', '0014ID.CO.QRIS.WWW0118936009150000000001'], ['53', '360'], ['58', 'ID'], ['59', 'WARUNG']]);
  assert.equal(parseEmv(q).scheme, 'QRIS');
  assert.equal(parseEmv(q.slice(0, -1) + (q.endsWith('0') ? '1' : '0')).crcOk, false);
});

test('rejects non-EMV text', () => assert.equal(parseEmv('hello'), null));

test('streak counts consecutive IST days and the current week', () => {
  const today = istDay(Math.floor(Date.now() / 1000));
  const s = streak(new Set([today, today - 1, today - 2]));
  assert.equal(s.current, 3); assert.equal(s.paidToday, true);
  assert.equal(streak(new Set([today - 1])).current, 1);
  assert.equal(streak(new Set([today - 3])).current, 0);
});
