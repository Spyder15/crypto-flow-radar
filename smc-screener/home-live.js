(() => {
  const API = /workers\.dev$|^localhost$/.test(location.hostname) ? "/api/trades" : "https://crypto-flow-radar.live-scanner.workers.dev/api/trades";
  const cards = document.querySelectorAll("#liveCards .card .v");
  if (cards.length < 4) return;
  fetch(API).then((r) => r.json()).then(({ open, closed }) => {
    const t = closed.filter((x) => x.r !== null), w = t.filter((x) => x.r > 0.05).length, l = t.filter((x) => x.r < -0.05).length, net = t.reduce((a, x) => a + x.r, 0);
    const none = !t.length;
    cards[0].textContent = String(t.length);
    cards[1].textContent = w + l ? Math.round((100 * w) / (w + l)) + "%" : "n/a";
    cards[2].textContent = none ? "n/a" : (net > 0 ? "+" : "") + net.toFixed(1) + "R";
    cards[3].textContent = String(open.length);
    document.getElementById("liveAsof").textContent = none ? "No trade has closed yet, so there is nothing to average." : "";
  }).catch(() => { cards.forEach((c) => (c.textContent = "n/a")); });
})();
