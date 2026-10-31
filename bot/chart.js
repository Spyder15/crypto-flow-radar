// Chart image through QuickChart (only public candle data and price levels are sent).
export const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.01 ? x.toFixed(5) : x.toPrecision(4));

// Wilder RSI, used for the momentum panel under the price chart.
function rsi(d, n = 14) {
  const out = new Array(d.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < d.length; i++) {
    const ch = d[i].c - d[i - 1].c, up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

const BG = "#0b1220", GRID = "rgba(148,163,184,0.12)", TXT = "#cbd5e1";

export function chartConfig(r, s, bars = 90) {
  const N = r.d.length, from = N - bars, L = s.side === "LONG", step = r.d[N - 1].t - r.d[N - 2].t;
  const ts = r.d.slice(from).map((k) => k.t), tEnd = ts[ts.length - 1] + 14 * step;
  const rs = rsi(r.d);
  const tag = (y, text, color, fg) => ({ type: "label", xValue: tEnd, yValue: y, xAdjust: -4, content: [text], color: fg || "#fff", backgroundColor: color, font: { size: 13, weight: "bold", family: "monospace" }, padding: 4, borderRadius: 3 });
  const line = (y, color, _n, dash) => ({ type: "line", yMin: y, yMax: y, borderColor: color, borderWidth: 1.6, borderDash: dash || [6, 4]});
  const name = (y, text, color) => ({ type: "label", xValue: ts[0], yValue: y, xAdjust: 6, yAdjust: -10, content: [text], color, font: { size: 13, weight: "bold" }, position: { x: "start" } });
  const vis = r.d.slice(from), lo = Math.min(...vis.map((k) => k.l), s.sl, s.tps[2]), hi = Math.max(...vis.map((k) => k.h), s.sl, s.tps[2]);
  const ann = {
    mark: { type: "label", drawTime: "beforeDatasetsDraw", xValue: ts[Math.floor(ts.length / 2)], yValue: (lo + hi) / 2, content: ["SPYDER"], color: "rgba(255,255,255,0.11)", font: { size: 150, weight: "bold" } },
    riskZone: { type: "box", yMin: Math.min(s.entry, s.sl), yMax: Math.max(s.entry, s.sl), backgroundColor: "rgba(239,68,68,0.10)", borderWidth: 0 },
    rewardZone: { type: "box", yMin: Math.min(s.entry, s.tps[1]), yMax: Math.max(s.entry, s.tps[1]), backgroundColor: "rgba(34,197,94,0.08)", borderWidth: 0 },
    entry: line(s.entry, "#facc15", "ENTRY", [2, 3]), sl: line(s.sl, "#f43f5e", "INVALID / SL"),
    tp1: line(s.tps[0], "#60a5fa", "TP1 (1R)"), tp2: line(s.tps[1], "#3b82f6", "TP2"), tp3: line(s.tps[2], "#818cf8", "TP3"),
    nEntry: name(s.entry, "ENTRY", "#facc15"), nSl: name(s.sl, "INVALID / SL", "#f43f5e"), nTp1: name(s.tps[0], "TP1 (1R)", "#60a5fa"), nTp2: name(s.tps[1], "TP2", "#60a5fa"), nTp3: name(s.tps[2], "TP3", "#a5b4fc"),
    tEntry: tag(s.entry, fmt(s.entry), "#eab308", "#111"), tSl: tag(s.sl, fmt(s.sl), "#e11d48"),
    tTp1: tag(s.tps[0], fmt(s.tps[0]), "#2563eb"), tTp2: tag(s.tps[1], fmt(s.tps[1]), "#2563eb"), tTp3: tag(s.tps[2], fmt(s.tps[2]), "#4f46e5"),
  };
  const sets = [{
    type: "candlestick", label: s.sym, yAxisID: "y",
    data: r.d.slice(from).map((k) => ({ x: k.t, o: k.o, h: k.h, l: k.l, c: k.c })),
    color: { up: "#22c55e", down: "#ef4444", unchanged: "#94a3b8" }, borderColor: { up: "#22c55e", down: "#ef4444", unchanged: "#94a3b8" },
  }];
  const ema = (label, arr, color) => ({ type: "line", label, yAxisID: "y", data: ts.map((t, i) => ({ x: t, y: arr[from + i] })), borderColor: color, borderWidth: 1.3, pointRadius: 0, fill: false });
  if (s.kind === "EMA RETEST") sets.push(ema("EMA50", r.e50, "#38bdf8"), ema("EMA200", r.e200, "#f59e0b"));
  sets.push({ type: "bar", label: "RSI-50", yAxisID: "y2", data: ts.map((t, i) => ({ x: t, y: rs[from + i] - 50 })), backgroundColor: ts.map((t, i) => (rs[from + i] >= 50 ? "rgba(34,197,94,0.75)" : "rgba(239,68,68,0.75)")), barPercentage: 1, categoryPercentage: 1 });
  const head = `${s.sym}, ${s.tf.toUpperCase()}  |  ${L ? "POTENTIAL UPSIDE MOVE" : "POTENTIAL DOWNSIDE MOVE"}  |  ${s.kind}${s.kind === "EMA RETEST" ? " " + s.lvl : ""}`;
  return {
    version: "3", backgroundColor: BG, width: 1100, height: 700, format: "png",
    chart: {
      type: "candlestick", data: { datasets: sets },
      options: {
        animation: false, layout: { padding: { right: 8, top: 4 } },
        plugins: {
          title: { display: true, text: head, align: "start", color: "#fff", font: { size: 19, weight: "bold" } },
          legend: { display: false }, annotation: { annotations: ann },
        },
        scales: {
          x: { type: "time", max: tEnd, time: { unit: s.tf === "1d" ? "day" : "hour" }, ticks: { color: TXT, maxTicksLimit: 9, source: "auto" }, grid: { color: GRID } },
          y: { stack: "main", stackWeight: 4, position: "right", ticks: { color: TXT }, grid: { color: GRID } },
          y2: { stack: "main", stackWeight: 1, position: "right", offset: false, title: { display: true, text: "MOMENTUM (RSI-50)", color: "#22d3ee", align: "start" }, ticks: { display: false }, grid: { color: GRID } },
        },
      },
    },
  };
}

export async function renderChart(r, s) {
  const res = await fetch("https://quickchart.io/chart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chartConfig(r, s)) });
  if (!res.ok) throw new Error("chart " + res.status);
  return res.arrayBuffer();
}
