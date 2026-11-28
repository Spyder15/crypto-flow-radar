export async function openKeys(env, indexKey, prefix) {
  let keys = await env.TRADES.get(indexKey, "json");
  if (!Array.isArray(keys)) {
    keys = [];
    let cursor;
    do {
      const page = await env.TRADES.list({ prefix, cursor });
      keys.push(...page.keys.map(({ name }) => name).filter((name) => name !== indexKey));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await env.TRADES.put(indexKey, JSON.stringify(keys));
  }
  return keys.filter((key) => typeof key === "string" && key.startsWith(prefix) && key !== indexKey);
}

export async function addOpenKey(env, indexKey, prefix, key) {
  const keys = await openKeys(env, indexKey, prefix);
  if (!key.startsWith(prefix)) throw new Error(`Open trade key must start with ${prefix}`);
  if (!keys.includes(key)) {
    keys.push(key);
    await env.TRADES.put(indexKey, JSON.stringify(keys));
  }
}

export async function removeOpenKey(env, indexKey, prefix, key) {
  const keys = await openKeys(env, indexKey, prefix);
  const next = keys.filter((item) => item !== key);
  if (next.length !== keys.length) await env.TRADES.put(indexKey, JSON.stringify(next));
}
