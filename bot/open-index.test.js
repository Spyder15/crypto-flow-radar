import test from "node:test";
import assert from "node:assert/strict";
import { addOpenKey, openKeys, removeOpenKey } from "./open-index.js";

function mockKV(initial = {}) {
  const values = new Map(Object.entries(initial));
  let listCalls = 0;
  return {
    values,
    get listCalls() { return listCalls; },
    async get(key, type) {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix, cursor }) {
      listCalls++;
      assert.equal(cursor, undefined);
      return {
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

test("backfills existing keys once, then serves the index without KV list", async () => {
  const env = { TRADES: mockKV({ "o:BTCUSDT:1h:1": "{}", "o:ETHUSDT:4h:2": "{}" }) };

  assert.deepEqual(await openKeys(env, "o:index", "o:"), ["o:BTCUSDT:1h:1", "o:ETHUSDT:4h:2"]);
  assert.deepEqual(await openKeys(env, "o:index", "o:"), ["o:BTCUSDT:1h:1", "o:ETHUSDT:4h:2"]);
  assert.equal(env.TRADES.listCalls, 1);
});

test("registers and removes keys without losing other open trades", async () => {
  const env = { TRADES: mockKV({ "o:index": JSON.stringify(["o:BTCUSDT:1h:1"]) }) };

  await addOpenKey(env, "o:index", "o:", "o:ETHUSDT:1h:2");
  await addOpenKey(env, "o:index", "o:", "o:ETHUSDT:1h:2");
  await removeOpenKey(env, "o:index", "o:", "o:BTCUSDT:1h:1");

  assert.deepEqual(await openKeys(env, "o:index", "o:"), ["o:ETHUSDT:1h:2"]);
  assert.equal(env.TRADES.listCalls, 0);
});
