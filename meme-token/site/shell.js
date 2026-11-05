// Pro terminal shell: grouped sidebar, command palette (Cmd/Ctrl+K), status bar, UI settings.
// Drives the existing #subtabs controller, so no tab logic is duplicated.
(() => {
  const $ = (id) => document.getElementById(id), D = document, B = D.body, H = D.documentElement;
  const GROUPS = [
    ["Markets", "◧", ["over", "scr", "mov", "map", "chain", "coin", "cmp", "hist", "watch"]],
    ["Derivatives & liquidity", "◈", ["deriv", "liq", "lmap", "lhist", "fmap", "bas", "opt", "flow"]],
    ["Whales & on-chain", "◉", ["hlw", "hype", "onc", "sm", "gas", "soc"]],
    ["Macro & research", "◍", ["mac", "cyc", "brief", "views", "ask"]],
    ["Trading desk", "◆", ["pf", "paper", "quant", "mq", "bt", "rules", "multi", "jrn", "calc"]],
    ["Learn", "◇", ["learn"]],
  ];
  const ICON = { over: "▦", scr: "☰", deriv: "∿", mov: "⇅", chain: "⌗", hlw: "≈", liq: "◎", hype: "ϟ", opt: "Σ", onc: "⬡", cyc: "◔", mac: "⊕", jrn: "✎", map: "▩", soc: "✦", flow: "≋", lmap: "▤", cmp: "⇄", gas: "⛁", pf: "◐", fmap: "▥", bas: "±", sm: "★", bt: "↺", rules: "⚑", multi: "⊞", brief: "☼", views: "◫", ask: "?", coin: "◌", hist: "◷", lhist: "◴", calc: "∑", paper: "✎", quant: "⚙", mq: "☄", learn: "✧", watch: "☆" };
  const read = () => { try { return JSON.parse(localStorage.getItem("spy.ui")) || {}; } catch { return {}; } };
  const UI = Object.assign({ collapsed: false, density: "cozy", accent: "amber", tape: true, fav: [] }, read());
  const save = () => { try { localStorage.setItem("spy.ui", JSON.stringify(UI)); } catch { /* storage full or blocked */ } };
  const ACC = { amber: "#f59a23", blue: "#3b82f6", green: "#14a76c", violet: "#8b5cf6", rose: "#e5484d" };

  const css = `
:root{--sbw:232px;--rad:6px}
body.sb{padding-bottom:30px}
body.sb header,body.sb .tape,body.sb footer,body.sb #v-mkt.wrap,body.sb #v-meme .wrap{margin-left:var(--sbw);transition:margin-left .18s}
body.sb #v-mkt.wrap,body.sb #v-meme .wrap{max-width:none;padding-left:22px;padding-right:22px}
body.sb.sbc{--sbw:60px}
body.sb #subtabs{display:none!important}
body.sb header .logo{display:none}
body.sb header .nav{display:none}
#sbar{position:fixed;left:0;top:0;bottom:0;width:var(--sbw);z-index:8;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;transition:width .18s,transform .2s}
#sbar .sbh{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);height:52px}
#sbar .sbh b{background:var(--acc);color:#fff;border-radius:5px;padding:2px 8px;letter-spacing:.08em;font-size:12px}
#sbar .sbh span{font-weight:700;letter-spacing:.1em;font-size:12px;white-space:nowrap}
#sbar .sbh i{margin-left:auto;font-style:normal;cursor:pointer;color:var(--mut);padding:2px 6px;border-radius:4px}#sbar .sbh i:hover{background:var(--panel2);color:var(--txt)}
#sbar .sbm{display:flex;gap:4px;padding:10px 12px 4px}
#sbar .sbm span{flex:1;text-align:center;padding:6px 4px;border:1px solid var(--line);border-radius:var(--rad);font-size:10.5px;font-weight:700;letter-spacing:.06em;cursor:pointer;color:var(--mut);white-space:nowrap;overflow:hidden}
#sbar .sbm span.on{background:var(--acc);border-color:var(--acc);color:#fff}
#sbk{margin:8px 12px 4px;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:var(--rad);color:var(--mut);cursor:pointer;font-size:11.5px;background:var(--panel2)}#sbk:hover{border-color:var(--acc)}
#sbk kbd{margin-left:auto;font:inherit;font-size:10px;border:1px solid var(--line);border-radius:4px;padding:0 5px}
#sbl{flex:1;overflow-y:auto;padding:6px 8px 12px;scrollbar-width:thin}
#sbl .gt{display:flex;align-items:center;gap:6px;padding:12px 8px 4px;font-size:9.5px;letter-spacing:.14em;color:var(--mut);text-transform:uppercase;font-weight:700;cursor:pointer;user-select:none}
#sbl .gt:after{content:"▾";margin-left:auto;transition:transform .15s}#sbl .g.shut .gt:after{transform:rotate(-90deg)}#sbl .g.shut .it{display:none}
#sbl .it{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--rad);cursor:pointer;color:var(--txt);font-size:12.5px;border-left:2px solid transparent;position:relative}
#sbl .it:hover{background:var(--panel2)}
#sbl .it.on{background:color-mix(in srgb,var(--acc) 13%,transparent);border-left-color:var(--acc);color:var(--acc);font-weight:700}
#sbl .it .ic{width:18px;text-align:center;flex:none;opacity:.85}
#sbl .it .lb{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sbl .it .fv{margin-left:auto;opacity:0;color:var(--mut);font-size:12px}#sbl .it:hover .fv{opacity:1}#sbl .it .fv.f{opacity:1;color:var(--acc)}
#sbl .nores{padding:16px;color:var(--mut);text-align:center;font-size:11.5px}
#sbar .sbf{border-top:1px solid var(--line);padding:8px 12px;display:flex;gap:6px;align-items:center;font-size:11px;color:var(--mut)}
#sbar .sbf .gb{cursor:pointer;padding:5px 8px;border:1px solid var(--line);border-radius:var(--rad);flex:1;text-align:center;font-weight:600}#sbar .sbf .gb:hover{border-color:var(--acc);color:var(--txt)}
body.sbc #sbar .lb,body.sbc #sbar .gt,body.sbc #sbar .sbh span,body.sbc #sbar .fv,body.sbc #sbk kbd,body.sbc #sbk span+span,body.sbc #sbar .sbh b,body.sbc #sbar .sbm,body.sbc #sbar .sbf .gb span{display:none}
body.sbc #sbl .gt{height:1px;padding:0;margin:8px 10px;background:var(--line)}body.sbc #sbl .gt:after{display:none}body.sbc #sbl .g.shut .it{display:flex}
body.sbc #sbl .it{justify-content:center;padding:8px 0}body.sbc #sbar .sbh{justify-content:center;padding:12px 0}body.sbc #sbar .sbh i{margin:0}body.sbc #sbk{justify-content:center;margin:8px 10px}
#ptitle{font-weight:700;font-size:14px;letter-spacing:.02em;display:flex;align-items:center;gap:8px}#ptitle small{color:var(--mut);font-weight:500;font-size:11px}
#hmb{display:none;cursor:pointer;font-size:18px;padding:2px 8px;border:1px solid var(--line);border-radius:var(--rad)}
#sbov{display:none}
#stat{position:fixed;left:var(--sbw);right:0;bottom:0;height:26px;z-index:7;background:var(--panel);border-top:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 14px;font-size:10.5px;color:var(--mut);letter-spacing:.03em;transition:left .18s;white-space:nowrap;overflow:hidden}
#stat b{color:var(--txt);font-weight:600}#stat .sp{margin-left:auto}
#stat .ss{display:inline-flex;align-items:center;gap:5px}#stat .ss i{width:7px;height:7px;border-radius:50%;background:var(--line);display:inline-block}#stat .ss.o i{background:var(--grn);box-shadow:0 0 6px var(--grn)}#stat .ss.o{color:var(--txt)}
#spop,#cmdk{position:fixed;z-index:120}
#spop{left:12px;bottom:40px;width:270px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;box-shadow:0 14px 40px rgba(0,0,0,.28);display:none}#spop.on{display:block}
#spop h4{margin:0 0 8px;font-size:10px;letter-spacing:.14em;color:var(--mut);text-transform:uppercase}
#spop .rw{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:12px}
#spop .sg{display:flex;gap:4px}#spop .sg span{padding:3px 9px;border:1px solid var(--line);border-radius:var(--rad);cursor:pointer;font-size:11px;font-weight:600;color:var(--mut)}#spop .sg span.on{background:var(--acc);border-color:var(--acc);color:#fff}
#spop .sw{width:18px!important;height:18px;padding:0!important;border-radius:50%!important}#spop .sw.on{outline:2px solid var(--txt);outline-offset:1px}
#cmdk{inset:0;background:rgba(5,8,12,.55);display:none;align-items:flex-start;justify-content:center;padding-top:12vh;backdrop-filter:blur(3px)}#cmdk.on{display:flex}
#cmdk .bx{width:min(560px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.45);overflow:hidden}
#cmdk input{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--txt);padding:14px 16px;font:inherit;font-size:15px;outline:none}
#cmdk .ls{max-height:50vh;overflow:auto;padding:6px}
#cmdk .r{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--rad);cursor:pointer;font-size:13px}#cmdk .r .ic{width:20px;text-align:center}#cmdk .r em{margin-left:auto;font-style:normal;font-size:10.5px;color:var(--mut);letter-spacing:.06em;text-transform:uppercase}
#cmdk .r.on{background:color-mix(in srgb,var(--acc) 15%,transparent);color:var(--acc)}
#cmdk .ft{padding:8px 14px;border-top:1px solid var(--line);font-size:10.5px;color:var(--mut);display:flex;gap:14px}
/* professional skin */
.panel,.kpis,.tile,.stile,.buy,.mbox,.toast,.tw,.tmap,.verdict{border-radius:var(--rad)}
.chip,.btn,.tag,.bell{border-radius:5px}
.panel,.kpis{box-shadow:none}
.panel{padding:12px 14px}
h2{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:700;margin-bottom:6px}
th{font-size:9.5px;letter-spacing:.1em;font-weight:700}
.kpi .v{font-size:19px;letter-spacing:-.01em}
body.dense td{padding:3px 8px}body.dense th{padding:4px 8px}body.dense .panel{padding:8px 10px}body.dense .kpi{padding:8px 12px}body.dense{font-size:12px}body.dense .tile{padding:6px 8px}
html[data-theme=dark]{--bg:#080b10;--panel:#0d1219;--panel2:#111822;--line:#1c2530;--txt:#d6dde7;--mut:#7a8696;--grn:#22c487;--red:#f0616d}
html[data-theme=dark] header{background:rgba(8,11,16,.92)}html[data-theme=dark] .tape{background:#0a0e14}
html[data-theme=dark] td,html[data-theme=dark] .wr{border-bottom-color:#141b25}
html[data-theme=dark] tr:hover td,html[data-theme=dark] .buy:hover{background:#131b26}
html[data-theme=dark] .tag{background:#141c27;color:#9aa6b6;border-color:#223040}
html[data-theme=dark] .btn,html[data-theme=dark] .toast{background:#121a24}
html[data-theme=dark] input,html[data-theme=dark] select{background:#0d1219;color:#d6dde7}
html[data-theme=dark] .mbox canvas{background:#0a0e14}html[data-theme=dark] .tmap{background:#0a0e14}html[data-theme=dark] .tmc{border-color:#0a0e14}
body.notape .tape{display:none}
@media(max-width:900px){
 :root{--sbw:0px}
 body.sb header,body.sb .tape,body.sb footer,body.sb #v-mkt.wrap,body.sb #v-meme .wrap{margin-left:0}
 body.sb #v-mkt.wrap,body.sb #v-meme .wrap{padding-left:10px;padding-right:10px}
 #sbar{width:260px;transform:translateX(-100%)}body.sbo #sbar{transform:none;box-shadow:0 0 40px rgba(0,0,0,.4)}
 body.sbc #sbar .lb,body.sbc #sbar .gt,body.sbc #sbar .sbh span,body.sbc #sbar .fv,body.sbc #sbk span+span,body.sbc #sbar .sbh b,body.sbc #sbar .sbm{display:revert}
 body.sbc #sbl .it{justify-content:flex-start;padding:6px 8px}
 #hmb{display:inline-block}#stat{left:0}#stat .hd{display:none}
 #sbov{position:fixed;inset:0;z-index:7;background:rgba(0,0,0,.45)}body.sbo #sbov{display:block}
 body.sb header .logo{display:flex}#ptitle small{display:none}
}`;

  const st = D.createElement("style"); st.textContent = css; D.head.appendChild(st);

  const tabEls = () => [...D.querySelectorAll("#subtabs .tab")];
  const labelOf = (t) => t.textContent.replace(/\s*★\s*$/, "").trim();
  const meta = () => {
    const m = {};
    tabEls().forEach((t) => { m[t.dataset.u] = { u: t.dataset.u, label: labelOf(t), ic: ICON[t.dataset.u] || "•" }; });
    return m;
  };
  const curU = () => D.querySelector("#subtabs .tab.on")?.dataset.u;
  const inMkt = () => B.dataset.v === "mkt";

  function go(u) {
    if (!inMkt()) D.querySelector('.nv[data-v="mkt"]')?.click();
    const t = D.querySelector(`#subtabs [data-u="${u}"]`);
    if (t) t.click();
    B.classList.remove("sbo");
    window.scrollTo({ top: 0 });
  }

  // sidebar
  const sb = D.createElement("aside"); sb.id = "sbar";
  sb.innerHTML = `<div class="sbh"><b>SPYDER</b><span>TRENCH</span><i id="sbt" title="Collapse sidebar">⇤</i></div>
<div class="sbm"><span data-v="mkt">MARKET</span><span data-v="meme">MEME</span></div>
<div id="sbk" title="Jump to any page"><span>⌕</span><span>Search pages…</span><kbd>⌘K</kbd></div>
<div id="sbl"></div>
<div class="sbf"><div class="gb" id="sbset" title="Settings">⚙ <span>Settings</span></div></div>`;
  B.appendChild(sb);
  const ov = D.createElement("div"); ov.id = "sbov"; B.appendChild(ov);

  function renderList() {
    const M = meta(), used = new Set(), cur = curU(), fav = UI.fav.filter((u) => M[u]);
    const item = (u) => { const m = M[u]; used.add(u); const f = UI.fav.includes(u); return `<div class="it${u === cur && inMkt() ? " on" : ""}" data-go="${u}" title="${m.label}"><span class="ic">${m.ic}</span><span class="lb">${m.label}</span><span class="fv${f ? " f" : ""}" data-fav="${u}" title="Favorite">${f ? "★" : "☆"}</span></div>`; };
    let h = "";
    if (fav.length) h += `<div class="g"><div class="gt">Favorites</div>${fav.map(item).join("")}</div>`;
    const shut = UI.shut || {};
    GROUPS.forEach(([name, ic, ids]) => {
      const list = ids.filter((u) => M[u]); if (!list.length) return;
      h += `<div class="g${shut[name] ? " shut" : ""}" data-g="${name}"><div class="gt"><span>${ic}</span>${name}</div>${list.map(item).join("")}</div>`;
    });
    const rest = Object.keys(M).filter((u) => !GROUPS.some((g) => g[2].includes(u)));
    if (rest.length) h += `<div class="g"><div class="gt">More</div>${rest.map(item).join("")}</div>`;
    $("sbl").innerHTML = h;
    sb.querySelectorAll(".sbm span").forEach((s) => s.classList.toggle("on", s.dataset.v === B.dataset.v));
    const m = M[cur];
    const pt = $("ptitle"); if (pt) pt.innerHTML = inMkt() ? `${m ? m.label : "Market Flow"} <small>Market Flow</small>` : `Meme Trench <small>on-chain DEX flow</small>`;
  }
  $("sbl").addEventListener("click", (e) => {
    const f = e.target.closest("[data-fav]");
    if (f) { const u = f.dataset.fav; UI.fav = UI.fav.includes(u) ? UI.fav.filter((x) => x !== u) : [...UI.fav, u]; save(); renderList(); return; }
    const g = e.target.closest(".gt");
    if (g && g.parentNode.dataset.g) { const n = g.parentNode.dataset.g; UI.shut = Object.assign({}, UI.shut, { [n]: !(UI.shut || {})[n] }); save(); renderList(); return; }
    const it = e.target.closest("[data-go]"); if (it) go(it.dataset.go);
  });
  sb.querySelector(".sbm").addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { D.querySelector(`.nv[data-v="${v}"]`)?.click(); B.classList.remove("sbo"); } });

  // header: hamburger + page title
  const hd = D.querySelector("header");
  const hmb = D.createElement("span"); hmb.id = "hmb"; hmb.textContent = "☰"; hd.prepend(hmb);
  const pt = D.createElement("div"); pt.id = "ptitle"; hd.insertBefore(pt, hd.querySelector("#q"));
  hmb.onclick = () => B.classList.toggle("sbo"); ov.onclick = () => B.classList.remove("sbo");

  function applyUI() {
    B.classList.add("sb");
    B.classList.toggle("sbc", !!UI.collapsed);
    B.classList.toggle("dense", UI.density === "dense");
    B.classList.toggle("notape", !UI.tape);
    H.style.setProperty("--acc", ACC[UI.accent] || ACC.amber);
    $("sbt").textContent = UI.collapsed ? "⇥" : "⇤";
  }
  $("sbt").onclick = () => { UI.collapsed = !UI.collapsed; save(); applyUI(); };

  // settings popover
  const pop = D.createElement("div"); pop.id = "spop";
  B.appendChild(pop);
  function renderPop() {
    const dark = H.dataset.theme === "dark";
    const seg = (key, opts, cur) => `<div class="sg">${opts.map(([v, l]) => `<span class="${cur === v ? "on" : ""}" data-k="${key}" data-v="${v}">${l}</span>`).join("")}</div>`;
    pop.innerHTML = `<h4>Interface</h4>
<div class="rw">Theme${seg("theme", [["light", "Light"], ["dark", "Dark"]], dark ? "dark" : "light")}</div>
<div class="rw">Density${seg("density", [["cozy", "Cozy"], ["dense", "Compact"]], UI.density)}</div>
<div class="rw">Price ticker${seg("tape", [["1", "On"], ["0", "Off"]], UI.tape ? "1" : "0")}</div>
<div class="rw">Accent<div class="sg">${Object.entries(ACC).map(([k, c]) => `<span class="sw ${UI.accent === k ? "on" : ""}" data-k="accent" data-v="${k}" style="background:${c}" title="${k}"></span>`).join("")}</div></div>
<div class="rw" style="margin:0;color:var(--mut);font-size:10.5px">⌘K / Ctrl+K · jump to any page</div>`;
  }
  $("sbset").onclick = (e) => { e.stopPropagation(); renderPop(); pop.classList.toggle("on"); };
  D.addEventListener("click", (e) => { if (!pop.contains(e.target) && !e.target.closest("#sbset")) pop.classList.remove("on"); });
  pop.addEventListener("click", (e) => {
    const s = e.target.closest("[data-k]"); if (!s) return; const k = s.dataset.k, v = s.dataset.v;
    if (k === "theme") { if ((H.dataset.theme === "dark") !== (v === "dark")) $("thm")?.click(); }
    else if (k === "density") UI.density = v; else if (k === "tape") UI.tape = v === "1"; else if (k === "accent") UI.accent = v;
    save(); applyUI(); renderPop();
  });

  // command palette
  const ck = D.createElement("div"); ck.id = "cmdk";
  ck.innerHTML = `<div class="bx"><input placeholder="Jump to a page or run an action…" autocomplete="off" spellcheck="false"><div class="ls"></div><div class="ft"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div></div>`;
  B.appendChild(ck);
  const ci = ck.querySelector("input"), cl = ck.querySelector(".ls");
  let items = [], sel = 0;
  const actions = () => [
    { ic: "☾", label: "Toggle dark / light theme", tag: "action", run: () => $("thm")?.click() },
    { ic: "⇤", label: "Collapse / expand sidebar", tag: "action", run: () => { UI.collapsed = !UI.collapsed; save(); applyUI(); } },
    { ic: "▤", label: "Toggle compact density", tag: "action", run: () => { UI.density = UI.density === "dense" ? "cozy" : "dense"; save(); applyUI(); } },
    { ic: "◧", label: "Open Market Flow", tag: "view", run: () => D.querySelector('.nv[data-v="mkt"]')?.click() },
    { ic: "◉", label: "Open Meme Trench", tag: "view", run: () => D.querySelector('.nv[data-v="meme"]')?.click() },
  ];
  function build(q) {
    const M = meta(), s = q.trim().toLowerCase();
    const pages = Object.values(M).map((m) => ({ ic: m.ic, label: m.label, tag: (GROUPS.find((g) => g[2].includes(m.u)) || [""])[0], run: () => go(m.u) }));
    items = pages.concat(actions()).filter((i) => !s || i.label.toLowerCase().includes(s) || i.tag.toLowerCase().includes(s)).slice(0, 40);
    sel = 0; drawList();
  }
  function drawList() {
    cl.innerHTML = items.length ? items.map((i, n) => `<div class="r${n === sel ? " on" : ""}" data-n="${n}"><span class="ic">${i.ic}</span>${i.label}<em>${i.tag}</em></div>`).join("") : '<div class="r">No match</div>';
    cl.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }
  const openK = () => { ck.classList.add("on"); ci.value = ""; build(""); ci.focus(); };
  const closeK = () => ck.classList.remove("on");
  const runSel = () => { const i = items[sel]; if (i) { closeK(); i.run(); } };
  ci.addEventListener("input", () => build(ci.value));
  ck.addEventListener("mousedown", (e) => { if (e.target === ck) closeK(); });
  cl.addEventListener("click", (e) => { const r = e.target.closest("[data-n]"); if (r) { sel = +r.dataset.n; runSel(); } });
  ci.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); drawList(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); drawList(); e.preventDefault(); }
    else if (e.key === "Enter") runSel(); else if (e.key === "Escape") closeK();
  });
  D.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ck.classList.contains("on") ? closeK() : openK(); }
    else if (e.key === "Escape") { closeK(); pop.classList.remove("on"); B.classList.remove("sbo"); }
  });
  $("sbk").onclick = openK;

  // status bar
  const stat = D.createElement("div"); stat.id = "stat";
  stat.innerHTML = `<span id="stl">● LIVE</span><span class="hd ss" data-s="a"><i></i>ASIA</span><span class="hd ss" data-s="l"><i></i>LONDON</span><span class="hd ss" data-s="n"><i></i>NEW YORK</span><span class="sp" id="stc"></span>`;
  B.appendChild(stat);
  const pad = (n) => String(n).padStart(2, "0");
  function tick() {
    const d = new Date(), h = d.getUTCHours() + d.getUTCMinutes() / 60, wk = d.getUTCDay() % 6 !== 0;
    const on = { a: h < 9, l: h >= 7 && h < 16, n: h >= 13 && h < 22 };
    stat.querySelectorAll("[data-s]").forEach((e) => e.classList.toggle("o", on[e.dataset.s] && wk));
    $("stc").innerHTML = `<b>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</b> local · <b>${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}</b> UTC`;
    const lv = $("live"); if (lv) $("stl").textContent = "● " + lv.textContent.trim();
  }
  tick(); setInterval(tick, 1000);

  // keep sidebar in sync with the old tab controller
  const syncObs = new MutationObserver(() => renderList());
  syncObs.observe($("subtabs"), { attributes: true, subtree: true, attributeFilter: ["class"] });
  syncObs.observe(B, { attributes: true, attributeFilter: ["data-v"] });
  applyUI(); renderList();
})();
