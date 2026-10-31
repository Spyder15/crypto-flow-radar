(() => {
  const API = location.hostname.endsWith("workers.dev") ? "/api/trades" : "https://crypto-flow-radar.live-scanner.workers.dev/api/trades";
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : Number(x).toPrecision(4));
  const R = (x) => (Math.abs(x) < 0.05 ? "0.0" : (x > 0 ? "+" : "") + x.toFixed(1)) + "R";
  const when = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function table(t, head, rows) {
    t.textContent = "";
    const tr = el("tr"); head.forEach((h) => tr.append(el("th", h))); t.append(tr);
    if (!rows.length) { const r = el("tr"), td = el("td", "None yet", "dim"); td.colSpan = head.length; r.append(td); t.append(r); }
    rows.forEach((cells) => { const r = el("tr"); cells.forEach((c) => { const td = el("td", c.text !== undefined ? c.text : c, c.cls); r.append(td); }); t.append(r); });
  }
  const side = (s) => ({ text: s, cls: s === "LONG" ? "good" : "bad" });
  fetch(API).then((r) => r.json()).then(({ open, closed }) => {
    const done = closed.filter((x) => x.r !== null), w = done.filter((x) => x.r > 0.05).length, l = done.filter((x) => x.r < -0.05).length, tot = done.reduce((a, x) => a + x.r, 0);
    const cards = $("sum"); cards.textContent = "";
    [["Open", open.length], ["Closed", done.length], ["Win rate (excl. BE)", w + l ? Math.round((100 * w) / (w + l)) + "%" : "n/a"], ["Net result", R(tot)]].forEach(([k, v]) => { const c = el("div", undefined, "card"); c.append(el("div", k, "dim"), el("b", String(v))); cards.append(c); });
    table($("open"), ["Coin", "Side", "TF", "Setup", "Entry", "SL", "TP1", "TP2", "TP3", "Stage", "Opened", "Conf"], open.map((t) => [t.sym.replace(/USDT$/, ""), side(t.side), t.tf.toUpperCase(), t.kind, fmt(t.entry), fmt(t.sl), fmt(t.tps[0]), fmt(t.tps[1]), fmt(t.tps[2]), t.stage ? "TP" + t.stage + " hit" : "waiting", when(t.t0), t.passed + "/8"]));
    table($("closed"), ["Coin", "Side", "TF", "Setup", "Outcome", "Result", "Closed"], done.map((t) => [t.sym.replace(/USDT$/, ""), side(t.side), t.tf.toUpperCase(), t.kind, t.outcome, { text: R(t.r), cls: t.r > 0.05 ? "good" : t.r < -0.05 ? "bad" : "" }, when(t.closed)]));
    $("status").textContent = "Updated " + new Date().toLocaleTimeString() + ". Trades are tracked on 15m candles, updates every 15 minutes.";
  }).catch(() => { $("status").textContent = "Could not load trades."; });
})();
