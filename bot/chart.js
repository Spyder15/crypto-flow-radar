// Chart image through QuickChart (only public candle data and price levels are sent).
const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : x.toPrecision(4));
export { fmt };

export function chartConfig(r, s, bars = 70) {
  const N = r.d.length, from = N - bars, L = s.side === "LONG", ts = r.d.slice(from).map((k) => k.t);
  const t0 = ts[0], t1 = ts[ts.length - 1], line = (label, y, color, dash) => ({ type: "line", label: `${label} ${fmt(y)}`, data: [{ x: t0, y }, { x: t1, y }], borderColor: color, borderWidth: 1.5, borderDash: dash || [], pointRadius: 0, fill: false });
  const ema = (label, arr, color) => ({ type: "line", label, data: ts.map((t, i) => ({ x: t, y: arr[from + i] })), borderColor: color, borderWidth: 1.2, pointRadius: 0, fill: false });
  const sets = [{
    type: "candlestick", label: s.sym,
    data: r.d.slice(from).map((k) => ({ x: k.t, o: k.o, h: k.h, l: k.l, c: k.c })),
    color: { up: "#16a34a", down: "#dc2626", unchanged: "#888" }, borderColor: { up: "#16a34a", down: "#dc2626", unchanged: "#888" },
  }];
  if (s.kind === "EMA RETEST") sets.push(ema("EMA50", r.e50, "#2563eb"), ema("EMA200", r.e200, "#f59e0b"));
  sets.push(line("Entry", s.entry, "#64748b", [6, 4]), line("SL", s.sl, "#dc2626"), line("TP1", s.tps[0], "#16a34a"), line("TP2", s.tps[1], "#16a34a"), line("TP3", s.tps[2], "#15803d"));
  return {
    version: "3", backgroundColor: "white", width: 900, height: 560, format: "png",
    chart: {
      type: "candlestick", data: { datasets: sets },
      options: {
        animation: false,
        plugins: { title: { display: true, text: `${s.sym} · ${s.tf.toUpperCase()} · ${s.side} · ${s.kind}${s.kind === "EMA RETEST" ? " " + s.lvl : ""}`, font: { size: 18 } }, legend: { position: "right", labels: { boxWidth: 12 } } },
        scales: { x: { type: "time", time: { unit: s.tf === "1d" ? "day" : "hour" }, ticks: { maxTicksLimit: 8 } }, y: { position: "right" } },
      },
    },
  };
}

export async function renderChart(r, s) {
  const res = await fetch("https://quickchart.io/chart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chartConfig(r, s)) });
  if (!res.ok) throw new Error("chart " + res.status);
  return res.arrayBuffer();
}
