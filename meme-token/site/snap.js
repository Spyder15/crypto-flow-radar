// Chart snapshot menu (camera button): download, copy image, copy link, open in new tab, post to X.
// Works on the trade chart popup (data-snap="modal") and on any page via the floating camera button.
(() => {
  const SP = window.SP || (window.SP = {});
  const HC_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  let lib = null, ctx = null, menu = null;

  const toast = (msg) => {
    let t = document.getElementById("snapt");
    if (!t) { t = document.createElement("div"); t.id = "snapt"; t.style.cssText = "position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:#1f2937;color:#fff;padding:8px 16px;border-radius:999px;font-size:13px;z-index:200;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s"; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = 0; }, 2600);
  };
  const loadLib = () => lib || (lib = new Promise((ok, no) => {
    if (window.html2canvas) return ok(window.html2canvas);
    const s = document.createElement("script"); s.src = HC_SRC; s.onload = () => ok(window.html2canvas); s.onerror = () => { lib = null; no(new Error("could not load the screenshot library")); };
    document.head.appendChild(s);
  }));

  // Renders the target to a PNG blob with a small brand strip at the bottom.
  async function capture() {
    const el = ctx.target(); if (!el) throw new Error("nothing to capture");
    const h2c = await loadLib();
    const bg = getComputedStyle(document.body).backgroundColor || "#0b0f14";
    const c = await h2c(el, { backgroundColor: bg, scale: Math.min(2, window.devicePixelRatio || 1) * 1.5, useCORS: true, logging: false, ignoreElements: (e) => e.hasAttribute && (e.hasAttribute("data-snap-ignore") || e.id === "snapm") });
    const out = document.createElement("canvas"), bar = Math.round(30 * c.width / Math.max(el.clientWidth, 1));
    out.width = c.width; out.height = c.height + bar;
    const g = out.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height); g.drawImage(c, 0, 0);
    g.fillStyle = "#8a94a6"; g.font = `${Math.round(bar * 0.42)}px sans-serif`; g.textBaseline = "middle";
    g.fillText("SPYDER TRENCH · meme-trench.spyder-radar.workers.dev", bar / 2, c.height + bar / 2);
    const ts = new Date().toLocaleString(); g.textAlign = "right"; g.fillText(ts, out.width - bar / 2, c.height + bar / 2);
    return new Promise((ok, no) => out.toBlob((b) => (b ? ok(b) : no(new Error("could not make the image"))), "image/png"));
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const download = (blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `spyder-${ctx.name}-${stamp()}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5e3); };

  const act = {
    async dl() { toast("Capturing…"); download(await capture()); toast("Image downloaded"); },
    async copy() {
      toast("Capturing…");
      if (!navigator.clipboard || !window.ClipboardItem) { download(await capture()); toast("Your browser can't copy images, downloaded instead"); return; }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": capture() })]); toast("Image copied");
    },
    async link() { await navigator.clipboard.writeText(ctx.link()); toast("Link copied"); },
    async tab() {
      const w = window.open("about:blank", "_blank"); toast("Capturing…");
      const b = await capture(); if (w) w.location.href = URL.createObjectURL(b); else { download(b); toast("Popup blocked, downloaded instead"); }
    },
    async x() {
      toast("Capturing…"); download(await capture());
      window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(ctx.text() + "\n" + ctx.link()), "_blank");
      toast("Image downloaded, attach it to your post");
    },
  };

  const ITEMS = [["dl", "⬇", "Download image"], ["copy", "⧉", "Copy image"], ["link", "🔗", "Copy link"], ["tab", "↗", "Open in new tab"], ["x", "𝕏", "Post image"]];
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openMenu(btn) {
    closeMenu();
    menu = document.createElement("div"); menu.id = "snapm";
    menu.style.cssText = "position:fixed;z-index:150;min-width:230px;background:var(--bg,#10141b);color:var(--fg,#e6e9ef);border:1px solid var(--line,#2b3340);border-radius:12px;padding:8px;box-shadow:0 12px 40px rgba(0,0,0,.55);font-size:14px";
    menu.innerHTML = '<div style="font-size:11px;letter-spacing:.08em;opacity:.6;padding:6px 10px">CHART SNAPSHOT</div>' + ITEMS.map(([k, i, l]) => `<div data-a="${k}" style="display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:8px;cursor:pointer"><span style="width:18px;text-align:center">${i}</span>${l}</div>`).join("");
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + "px";
    menu.style.top = (r.bottom + mh + 12 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - mh - 6)) + "px";
    menu.onmouseover = (e) => { const d = e.target.closest("[data-a]"); for (const x of menu.querySelectorAll("[data-a]")) x.style.background = x === d ? "rgba(127,127,127,.2)" : ""; };
  }

  // Which tab is visible on the page, for the floating button.
  const page = () => {
    const v = document.body.dataset.v || "mkt";
    if (v === "mkt") return [...document.querySelectorAll("#v-mkt [id^='s-']")].find((e) => !e.hidden) || document.getElementById("v-mkt");
    return document.getElementById("v-" + v) || document.body;
  };
  const tabId = () => { const e = page(); return e && e.id.startsWith("s-") ? e.id.slice(2) : ""; };
  const pageCtx = () => ({ target: page, name: tabId() || "page", link: () => location.origin + "/" + (tabId() ? "#tab=" + tabId() : ""), text: () => "Spyder Trench · " + (tabId() || "page") });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("#snapm [data-a]");
    if (a) { const k = a.dataset.a; closeMenu(); act[k]().catch((er) => toast("Snapshot failed: " + er.message)); return; }
    const b = e.target.closest("[data-snap]");
    if (b) {
      if (menu) { closeMenu(); return; }
      ctx = b.dataset.snap === "modal" && SP.snapModal ? SP.snapModal() : pageCtx();
      openMenu(b); return;
    }
    closeMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  // floating camera button (every page)
  const fb = document.createElement("div");
  fb.id = "snapb"; fb.setAttribute("data-snap", "page"); fb.setAttribute("data-snap-ignore", ""); fb.title = "Chart snapshot";
  fb.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;background:var(--bg,#10141b);border:1px solid var(--line,#2b3340);box-shadow:0 4px 16px rgba(0,0,0,.4)";
  fb.textContent = "📷";
  document.body.appendChild(fb);

  // deep links: #tab=<id> opens a tab, #trade=<id> opens a quant trade chart
  setTimeout(() => {
    const m = /^#(tab|trade)=([\w.-]+)$/.exec(location.hash);
    if (!m) return;
    if (m[1] === "tab") document.querySelector(`#subtabs [data-u="${m[2]}"]`)?.click();
    else if (SP.quantOpen) SP.quantOpen(m[2]);
  }, 1200);
})();
