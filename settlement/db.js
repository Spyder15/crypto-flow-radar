import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH || 'settlement.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, merchant TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS requests_merchant ON requests(merchant);
  CREATE TABLE IF NOT EXISTS used_transfers (key TEXT PRIMARY KEY, request_id TEXT NOT NULL);
`);

// bigint-safe JSON
const ser = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? { $b: v.toString() } : v));
const de = (s) => JSON.parse(s, (_, v) => (v && typeof v === 'object' && '$b' in v ? BigInt(v.$b) : v));

const put = db.prepare('INSERT INTO requests (id, merchant, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
const get = db.prepare('SELECT data FROM requests WHERE id = ?');
const list = db.prepare('SELECT data FROM requests WHERE merchant = ? ORDER BY rowid DESC LIMIT 50');
const markUsed = db.prepare('INSERT OR IGNORE INTO used_transfers (key, request_id) VALUES (?, ?)');
const usedBy = db.prepare('SELECT request_id FROM used_transfers WHERE key = ?');

export const saveRequest = (r) => put.run(r.id, r.merchant, ser(r));
export const getRequest = (id) => { const row = get.get(id); return row ? de(row.data) : null; };
export const listByMerchant = (m) => list.all(m.toLowerCase()).map((row) => de(row.data));
// Returns true only for the first request to claim this transfer.
export const claimTransfer = (key, id) => markUsed.run(key, id).changes === 1;
export const transferOwner = (key) => usedBy.get(key)?.request_id ?? null;
export { ser };
