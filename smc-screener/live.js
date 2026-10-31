(() => {
  const API = /workers\.dev$|^localhost$/.test(location.hostname) ? "/api/trades" : "https://crypto-flow-radar.live-scanner.workers.dev/api/trades";
  const $ = (id) => document.getElementById(id);
  const G = "#2fd27a", R_ = "#ff4d4d", OR = "#ffa11a", DIM = "#7a7a7a", GRID = "#1a1a1a";
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : Number(x).toPrecision(4));
  const sR = (x) => (x > 0 ? "+" : "") + x.toFixed(2) + "R";
  const cls = (x) => (x > 0.05 ? "good" : x < -0.05 ? "bad" : "");
  const day = (ms) => new Date(ms).toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const dshort = (ms) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  const when = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const sum = (a) => a.reduce((x, y) => x + y, 0), avg = (a) => (a.length ? sum(a) / a.length : 0);

  function stats(closed) {
    const t = closed.filter((x) => x.r !== null).sort((a, b) => a.closed - b.closed), rs = t.map((x) => x.r);
    const wins = t.filter((x) => x.r > 0.05), loss = t.filter((x) => x.r < -0.05), be = t.length - wins.length - loss.length;
    const gw = sum(wins.map((x) => x.r)), gl = -sum(loss.map((x) => x.r));
    let cum = 0, peak = 0, maxDD = 0; const curve = [], dd = [];
    rs.forEach((r) => { cum += r; peak = Math.max(peak, cum); curve.push(cum); dd.push(cum - peak); maxDD = Math.min(maxDD, cum - peak); });
    const daily = {}; t.forEach((x) => { const d = day(x.closed); daily[d] = (daily[d] || 0) + x.r; });
    const week = {}; t.forEach((x) => { const d = new Date(x.closed); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = day(d.getTime()); week[k] = (week[k] || 0) + x.r; });
    return { t, rs, wins, loss, be, total: sum(rs), pf: gl ? gw / gl : gw ? Infinity : 0, avgWin: avg(wins.map((x) => x.r)), avgLoss: avg(loss.map((x) => x.r)), curve, dd, maxDD, daily, week };
  }

  function setup(c) {
    const d = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = w * d; c.height = h * d; const x = c.getContext("2d"); x.scale(d, d); x.clearRect(0, 0, w, h); x.font = "10px ui-monospace,Menlo,monospace";
    return { x, w, h };
  }
  const none = (c, msg = "No closed trades yet") => { const { x, w, h } = setup(c); x.fillStyle = DIM; x.textAlign = "center"; x.fillText(msg, w / 2, h / 2); };
  function frame(x, w, h, lo, hi, tick) {
    const L = 40, B = 16, T = 6, Rr = 6, ph = h - B - T, pw = w - L - Rr, y = (v) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
    x.strokeStyle = GRID; x.fillStyle = DIM; x.textAlign = "right"; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, yy = y(v); x.beginPath(); x.moveTo(L, yy); x.lineTo(w - Rr, yy); x.stroke(); x.fillText(tick(v), L - 4, yy + 3); }
    return { L, pw, y, B, ph, T };
  }
  function line(c, vals, color, { fill = false, zero = true } = {}) {
    if (!vals.length) return none(c);
    const { x, w, h } = setup(c), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals) || 1, pad = (hi - lo) * 0.08 || 1;
    const f = frame(x, w, h, lo - (lo < 0 ? pad : 0), hi + pad, (v) => v.toFixed(1)), n = vals.length, px = (i) => f.L + (n === 1 ? f.pw / 2 : (i / (n - 1)) * f.pw);
    if (zero) { x.strokeStyle = "#333"; x.beginPath(); x.moveTo(f.L, f.y(0)); x.lineTo(f.L + f.pw, f.y(0)); x.stroke(); }
    x.beginPath(); vals.forEach((v, i) => (i ? x.lineTo(px(i), f.y(v)) : x.moveTo(px(i), f.y(v)))); x.strokeStyle = color; x.lineWidth = 1.6; x.stroke();
    if (fill) { x.lineTo(px(n - 1), f.y(0)); x.lineTo(px(0), f.y(0)); x.closePath(); x.fillStyle = color + "33"; x.fill(); }
  }
  function bars(c, vals, labels) {
    if (!vals.length) return none(c);
    const { x, w, h } = setup(c), m = Math.max(0.5, ...vals.map(Math.abs)), f = frame(x, w, h, -m, m, (v) => v.toFixed(1)), n = vals.length, bw = Math.max(1, Math.min(14, f.pw / n - 1));
    vals.forEach((v, i) => { const cx = f.L + ((i + 0.5) / n) * f.pw; x.fillStyle = v >= 0 ? G : R_; x.fillRect(cx - bw / 2, Math.min(f.y(v), f.y(0)), bw, Math.max(1, Math.abs(f.y(v) - f.y(0)))); });
    if (labels && n) { x.fillStyle = DIM; x.textAlign = "left"; x.fillText(labels[0], f.L, h - 3); x.textAlign = "right"; x.fillText(labels[n - 1], f.L + f.pw, h - 3); }
  }
  function radar(c, axes) {
    const { x, w, h } = setup(c), cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) / 2 - 34, n = axes.length, pt = (i, k) => [cx + Math.sin((i / n) * 2 * Math.PI) * r * k, cy - Math.cos((i / n) * 2 * Math.PI) * r * k];
    x.strokeStyle = GRID; for (const k of [0.33, 0.66, 1]) { x.beginPath(); axes.forEach((_, i) => { const [a, b] = pt(i, k); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.stroke(); }
    axes.forEach(([name, v], i) => { const [a, b] = pt(i, 1), [lx, ly] = pt(i, 1.22); x.beginPath(); x.moveTo(cx, cy); x.lineTo(a, b); x.stroke(); x.fillStyle = DIM; x.textAlign = "center"; x.fillText(`${name} ${Math.round(v)}`, lx, ly + 3); });
    x.beginPath(); axes.forEach(([, v], i) => { const [a, b] = pt(i, Math.max(0.02, v / 100)); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fillStyle = OR + "40"; x.fill(); x.strokeStyle = OR; x.lineWidth = 1.5; x.stroke();
  }
  function kpi(host, items) {
    host.textContent = "";
    items.forEach(({ k, v, s, c, win }) => {
      const d = el("div", undefined, "kpi"); d.append(el("div", k, "k"), el("div", v, "v " + (c || "")));
      if (win !== undefined) { const b = el("div", undefined, "bar"), i = el("i"); i.style.width = win + "%"; b.append(i); d.append(b); }
      if (s) d.append(el("div", s, "s")); host.append(d);
    });
  }
  function table(t, head, rows, empty) {
    t.textContent = ""; const tr = el("tr"); head.forEach(([h, right]) => tr.append(el("th", h, right ? "r" : ""))); t.append(tr);
    if (!rows.length) { const r = el("tr"), td = el("td", empty, "empty"); td.colSpan = head.length; r.append(td); t.append(r); }
    rows.forEach((cells) => { const r = el("tr"); cells.forEach((c, i) => r.append(el("td", c.text !== undefined ? c.text : c, (c.cls || "") + (head[i][1] ? " r" : "")))); t.append(r); });
  }
  const sideCell = (s) => ({ text: s, cls: s === "LONG" ? "good" : "bad" });
  const best = (obj, pick) => Object.entries(obj).sort((a, b) => pick * (b[1] - a[1]))[0];

  function render({ open, closed }) {
    const S = stats(closed), n = S.t.length, now = Date.now(), today = day(now);
    const wk = Object.entries(S.week).sort().pop(), month = sum(S.t.filter((x) => new Date(x.closed).getMonth() === new Date(now).getMonth() && now - x.closed < 40 * 864e5).map((x) => x.r));
    const wl = S.wins.length + S.loss.length, winPct = wl ? (100 * S.wins.length) / wl : 0, exp = n ? S.total / n : 0, wlRatio = S.avgLoss ? S.avgWin / Math.abs(S.avgLoss) : 0;
    kpi($("kpi1"), [
      { k: "Today · realized", v: n ? sR(S.daily[today] || 0) : "0.00R", c: cls(S.daily[today] || 0) },
      { k: "This week", v: wk ? sR(wk[1]) : "0.00R", c: wk ? cls(wk[1]) : "" },
      { k: "This month", v: sR(month), c: cls(month) },
      { k: "Open positions", v: String(open.length), s: "each risks 1R" },
      { k: "Open risk to stops", v: open.filter((o) => (o.stage || 0) === 0).length + "R", s: "trades with TP1 hit are at breakeven or better" },
      { k: "Last closed", v: n ? dshort(S.t[n - 1].closed) : "-", s: n ? S.t[n - 1].sym.replace(/USDT$/, "") + " " + sR(S.t[n - 1].r) : "none yet" },
    ]);
    kpi($("kpi2"), [
      { k: "Net result", v: sR(S.total), c: cls(S.total), s: n + " closed trades" },
      { k: "Win % (excl. BE)", v: wl ? winPct.toFixed(1) + "%" : "-", win: wl ? winPct : undefined, s: `${S.wins.length} W · ${S.be} BE · ${S.loss.length} L` },
      { k: "Profit factor", v: !n ? "-" : isFinite(S.pf) ? S.pf.toFixed(2) : "∞", c: S.pf >= 1 ? "good" : n ? "bad" : "" },
      { k: "Avg win / avg loss", v: n ? `${S.avgWin.toFixed(2)} / ${S.avgLoss.toFixed(2)}` : "-", s: wlRatio ? "ratio " + wlRatio.toFixed(2) : "" },
      { k: "Expectancy", v: n ? sR(exp) : "-", c: cls(exp), s: "per trade" },
      { k: "Max drawdown", v: n ? S.maxDD.toFixed(2) + "R" : "-", c: S.maxDD < -0.05 ? "bad" : "" },
    ]);
    $("cumTag").textContent = n ? sR(S.total) : ""; $("ddTag").textContent = n ? S.maxDD.toFixed(2) + "R" : "";
    line($("cCum"), S.curve, OR, { fill: true }); line($("cDD"), S.dd, R_, { fill: true }); bars($("cTrades"), S.rs, n ? [dshort(S.t[0].closed), dshort(S.t[n - 1].closed)] : null);

    table($("recent"), [["CLOSE"], ["SYMBOL"], ["SIDE"], ["TF"], ["RESULT", 1]], S.t.slice(-30).reverse().map((x) => [dshort(x.closed), x.sym.replace(/USDT$/, ""), sideCell(x.side), x.tf.toUpperCase(), { text: sR(x.r), cls: cls(x.r) }]), "No closed trades yet");
    const weeks = Object.values(S.week), cons = weeks.length ? (100 * weeks.filter((v) => v > 0).length) / weeks.length : 0;
    const axes = [["WIN %", Math.min(100, (winPct / 60) * 100)], ["PROFIT F.", Math.min(100, (Math.min(S.pf, 3) / 3) * 100)], ["W/L RATIO", Math.min(100, (Math.min(wlRatio, 3) / 3) * 100)], ["DRAWDOWN", Math.max(0, 100 + (S.maxDD / 10) * 100)], ["CONSISTENCY", cons]];
    n ? (radar($("cScore"), axes), ($("scoreTag").textContent = Math.round(avg(axes.map((a) => a[1]))) + " / 100")) : none($("cScore"));
    const roll = []; for (let i = 19; i < S.t.length; i++) { const w = S.t.slice(i - 19, i + 1), a = w.filter((x) => x.r > 0.05).length, b = w.filter((x) => x.r < -0.05).length; roll.push(a + b ? (100 * a) / (a + b) : 0); }
    roll.length ? line($("cRoll"), roll, "#4aa8ff", { zero: false }) : none($("cRoll"), n ? "Needs 20 closed trades" : "No closed trades yet");

    $("openTag").textContent = open.length;
    table($("open"), [["COIN"], ["SIDE"], ["TF"], ["SETUP"], ["ENTRY", 1], ["SL", 1], ["TP1", 1], ["STAGE"], ["CONF"]], open.map((o) => [o.sym.replace(/USDT$/, ""), sideCell(o.side), o.tf.toUpperCase(), o.kind, fmt(o.entry), fmt(o.sl), fmt(o.tps[0]), o.stage ? "TP" + o.stage + " hit" : "waiting", o.passed + "/8"]), "No open positions");
    const dk = Object.keys(S.daily).sort(); bars($("cDaily"), dk.map((k) => S.daily[k]), dk.length ? [dk[0].slice(5), dk[dk.length - 1].slice(5)] : null);

    const ul = $("insights"); ul.textContent = "";
    const add = (...parts) => { const li = el("li"); parts.forEach((p) => (typeof p === "string" ? li.append(document.createTextNode(p)) : li.append(el("b", p.b)))); ul.append(li); };
    if (!n) add("Insights appear after the first trades close. Real signals need ≥7/8 confirmations on 1H, 4H or 1D, so this can take a few days.");
    else {
      const coin = {}, byDay = {}, byHour = {}, kind = {}, side = { LONG: [], SHORT: [] }, tf = {};
      S.t.forEach((x) => { const s = x.sym.replace(/USDT$/, ""); coin[s] = (coin[s] || 0) + x.r; byDay[new Date(x.closed).toLocaleDateString([], { weekday: "short" })] = (byDay[new Date(x.closed).toLocaleDateString([], { weekday: "short" })] || 0) + x.r; kind[x.kind] = (kind[x.kind] || 0) + x.r; tf[x.tf] = (tf[x.tf] || 0) + x.r; side[x.side].push(x.r); byHour[new Date(x.opened).getHours()] = (byHour[new Date(x.opened).getHours()] || 0) + x.r; });
      const bc = best(coin, 1), wc = best(coin, -1), bd = best(byDay, 1), wd = best(byDay, -1), bt = best(tf, 1), bk = best(kind, 1);
      add("Best coin: ", { b: bc[0] }, ` ${sR(bc[1])}. Worst: `, { b: wc[0] }, ` ${sR(wc[1])}.`);
      add("Best closing day: ", { b: bd[0] }, ` (${sR(bd[1])}); worst: `, { b: wd[0] }, ` (${sR(wd[1])}).`);
      add("Best timeframe: ", { b: bt[0].toUpperCase() }, ` ${sR(bt[1])}. Best setup: `, { b: bk[0] }, ` ${sR(bk[1])}.`);
      add("Long trades net ", { b: sR(sum(side.LONG)) }, ` (${side.LONG.length}); short trades net `, { b: sR(sum(side.SHORT)) }, ` (${side.SHORT.length}).`);
      const hold = (x) => (x.closed - x.opened) / 36e5, hw = avg(S.wins.map(hold)), hl = avg(S.loss.map(hold));
      if (S.wins.length && S.loss.length) add("Average hold: winners ", { b: hw.toFixed(1) + "h" }, ", losers ", { b: hl.toFixed(1) + "h" }, ".");
      const top5 = sum(S.rs.slice().sort((a, b) => b - a).slice(0, 5));
      if (S.total > 0 && n > 5) add("Your top 5 trades account for ", { b: Math.round((100 * top5) / S.total) + "%" }, " of net R" + (top5 > S.total ? " (the rest net negative)." : "."));
      if (n < 30) add("Only ", { b: String(n) }, " closed trades so far: too few to trust any of the above.");
    }
    $("status").textContent = "Updated " + new Date().toLocaleTimeString() + " · trades tracked on 15m candles, refreshed every 15 minutes";
  }
  let data; // kept so a resize redraws without refetching
  fetch(API).then((r) => r.json()).then((d) => { data = d; render(d); }).catch(() => { $("status").textContent = "Could not load trades."; });
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => data && render(data), 200); });
})();
