// Single-page interactive atlas: lateral nav + acronym browser + inline section viewer.
const N = 25;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

let DATA = null;             // {acronyms, labels, sections, scales, acroToSecs}
let current = { n: null, acro: null };
let view = { scale: 1, tx: 0, ty: 0 };   // viewBox origin + zoom (1 = fit)
let measure = { pts: [] };
let panState = null;
let loadedImg = null;     // section number whose image is currently displayed
let loadingImg = null;    // section number we're waiting on
let hlShown = true;       // per-section highlight visibility, reset on every load
let currentTool = "measure";  // matlab-style exclusive tool: zoomIn|zoomOut|pan|measure
let rubber = null;        // {ax,ay,bx,by} svg-coord rectangle while dragging in zoomIn
let dragOrigin = null;    // {clientX, clientY, ax, ay} for distinguishing click vs drag

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function loadData() {
  const [acronyms, labels, sections, scales] = await Promise.all([
    fetch("data/acronyms.json").then(r => r.json()),
    fetch("data/labels.json").then(r => r.json()),
    fetch("data/sections.json").then(r => r.json()),
    fetch("data/scales.json").then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  // index sections by lowercased acronym — labels.json and acronyms.json
  // disagree on case for some entries (e.g. Mo vs MO, Fr vs FR).
  const acroToSecs = {};
  for (const [n, lst] of Object.entries(labels)) {
    for (const l of lst) {
      const k = (l.acro || "").toLowerCase();
      (acroToSecs[k] ??= new Set()).add(Number(n));
    }
  }
  for (const k of Object.keys(acroToSecs))
    acroToSecs[k] = [...acroToSecs[k]].sort((a, b) => a - b);
  DATA = { acronyms, labels, sections, scales, acroToSecs };
}

// ---------- lateral nav: 25 numbered tabs + SVG slider ----------
const TAB_X0 = 30, TAB_X1 = 970;
const Y_TABS = 35;
const Y_SLIDER = 78;
const xOfSection = i => TAB_X0 + (TAB_X1 - TAB_X0) * (i - 1) / (N - 1);

function buildTicks() {
  const g = document.getElementById("ticks");
  const ax = document.createElementNS(SVG_NS, "line");
  ax.setAttribute("x1", TAB_X0 - 10); ax.setAttribute("x2", TAB_X1 + 10);
  ax.setAttribute("y1", Y_TABS + 2); ax.setAttribute("y2", Y_TABS + 2);
  ax.setAttribute("stroke", "#30363d"); ax.setAttribute("stroke-width", 1);
  g.appendChild(ax);
  for (let i = 1; i <= N; i++) {
    const x = xOfSection(i);
    const tick = document.createElementNS(SVG_NS, "rect");
    tick.setAttribute("x", x - 11); tick.setAttribute("y", Y_TABS - 12);
    tick.setAttribute("width", 22); tick.setAttribute("height", 28);
    tick.setAttribute("rx", 4);
    tick.classList.add("tick");
    tick.setAttribute("data-n", i);
    tick.addEventListener("click", () => showSection(i, null));
    const ttl = document.createElementNS(SVG_NS, "title");
    ttl.textContent = `Section ${i}`;
    tick.appendChild(ttl);
    g.appendChild(tick);
    const lbl = document.createElementNS(SVG_NS, "text");
    lbl.setAttribute("x", x); lbl.setAttribute("y", Y_TABS + 7);
    lbl.setAttribute("text-anchor", "middle");
    lbl.classList.add("tick-label");
    lbl.textContent = i;
    g.appendChild(lbl);
  }
}

let sliderThumb = null;
function positionAxisLabels() {
  const r = document.getElementById("rostralLbl");
  const c = document.getElementById("caudalLbl");
  if (r) r.setAttribute("x", xOfSection(1));
  if (c) c.setAttribute("x", xOfSection(N));
}

function buildSlider() {
  const g = document.getElementById("sliderG");
  // hit-area background for clicking the track
  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("x", TAB_X0 - 12); hit.setAttribute("y", Y_SLIDER - 9);
  hit.setAttribute("width", TAB_X1 - TAB_X0 + 24); hit.setAttribute("height", 18);
  hit.setAttribute("fill", "transparent");
  hit.classList.add("slider-hit");
  g.appendChild(hit);
  // track
  const track = document.createElementNS(SVG_NS, "line");
  track.setAttribute("x1", TAB_X0); track.setAttribute("y1", Y_SLIDER);
  track.setAttribute("x2", TAB_X1); track.setAttribute("y2", Y_SLIDER);
  track.classList.add("slider-track");
  g.appendChild(track);
  // section snap-dots
  for (let i = 1; i <= N; i++) {
    const d = document.createElementNS(SVG_NS, "circle");
    d.setAttribute("cx", xOfSection(i)); d.setAttribute("cy", Y_SLIDER);
    d.setAttribute("r", 2);
    d.classList.add("slider-dot");
    g.appendChild(d);
  }
  // thumb
  sliderThumb = document.createElementNS(SVG_NS, "circle");
  sliderThumb.setAttribute("cx", xOfSection(1));
  sliderThumb.setAttribute("cy", Y_SLIDER);
  sliderThumb.setAttribute("r", 8);
  sliderThumb.classList.add("slider-thumb");
  g.appendChild(sliderThumb);

  // interactions: drag thumb or click track
  let dragging = false;
  const svg = document.getElementById("brainsvg");
  function svgX(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse()).x;
  }
  function snapToSection(x) {
    const t = (x - TAB_X0) / (TAB_X1 - TAB_X0);
    const i = Math.round(t * (N - 1)) + 1;
    return Math.max(1, Math.min(N, i));
  }
  function pick(e) {
    e.preventDefault();
    const n = snapToSection(svgX(e));
    if (n !== current.n) showSection(n, null);
  }
  hit.addEventListener("mousedown", e => { dragging = true; pick(e); });
  sliderThumb.addEventListener("mousedown", e => { dragging = true; e.preventDefault(); });
  window.addEventListener("mousemove", e => { if (dragging) pick(e); });
  window.addEventListener("mouseup", () => { dragging = false; });
  // touch
  hit.addEventListener("touchstart", e => { dragging = true; pick(e.touches[0]); }, { passive: false });
  window.addEventListener("touchmove", e => { if (dragging) pick(e.touches[0]); }, { passive: false });
  window.addEventListener("touchend", () => { dragging = false; });
}
function syncSlider(n) {
  if (sliderThumb) sliderThumb.setAttribute("cx", xOfSection(n));
}

function highlightTick(n) {
  document.querySelectorAll("#ticks .tick").forEach(t => {
    t.classList.toggle("active", Number(t.getAttribute("data-n")) === n);
  });
}

// ---------- acronym browser ----------
function setupBrowser() {
  const input = document.getElementById("q");
  const list = document.getElementById("acroList");
  const count = document.getElementById("count");
  const entries = Object.entries(DATA.acronyms).sort((a, b) => {
    const ha = (DATA.acroToSecs[a[0].toLowerCase()] || []).length > 0;
    const hb = (DATA.acroToSecs[b[0].toLowerCase()] || []).length > 0;
    if (ha !== hb) return ha ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });

  function render(q) {
    list.innerHTML = "";
    q = q.trim().toLowerCase();
    const hits = q
      ? entries.filter(([a, n]) => a.toLowerCase().includes(q) || n.toLowerCase().includes(q))
      : entries;
    count.textContent = `${hits.length} / ${entries.length}`;
    for (const [a, n] of hits) {
      const secs = DATA.acroToSecs[a.toLowerCase()] || [];
      const li = document.createElement("li");
      li.classList.toggle("active", a === current.acro);
      li.classList.toggle("no-pins", secs.length === 0);
      li.innerHTML = `<span class="acro">${a}</span><span class="name">${n}</span><span class="badge">${secs.length || "·"}</span>`;
      li.addEventListener("click", () => pickAcro(a));
      list.appendChild(li);
    }
  }
  input.addEventListener("input", () => render(input.value));
  window.__renderAcroList = () => render(input.value);
  render("");
}

function pickAcro(a) {
  current.acro = a;
  hlShown = true;
  const secs = DATA.acroToSecs[a.toLowerCase()] || [];
  window.__renderAcroList?.();
  buildSecStrip(secs, a);
  // load first section containing this acro (or stay if already shown)
  if (secs.length && !secs.includes(current.n)) {
    showSection(secs[0], a);
  } else {
    syncHlButton();
    renderOverlay();
    updateTitle();
  }
}

function syncHlButton() {
  const b = document.getElementById("btnHl");
  if (!b) return;
  b.disabled = !current.acro;
  b.classList.toggle("active", !!current.acro && hlShown);
}

function buildSecStrip(secs, acro) {
  const strip = document.getElementById("secStrip");
  strip.innerHTML = "";
  if (!secs.length) { strip.hidden = true; return; }
  strip.hidden = false;
  const lbl = document.createElement("span");
  lbl.className = "strip-label";
  lbl.innerHTML = `<span class="strip-acro">${acro}</span> Appears In:`;
  strip.appendChild(lbl);
  for (const n of secs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "strip-btn";
    if (n === current.n) b.classList.add("active");
    b.textContent = `§${n}`;
    b.addEventListener("click", () => showSection(n, acro));
    strip.appendChild(b);
  }
}

// ---------- viewer ----------
function updateTitle() {
  const t = document.getElementById("vTitle");
  if (current.n == null) { t.textContent = "Section —"; return; }
  const acro = current.acro ? `  •  ${current.acro}` : "";
  t.textContent = `Section ${current.n}${acro}`;
}

function showSection(n, acro) {
  if (!DATA) { console.warn("DATA not loaded yet"); return; }
  if (!DATA.sections[n]) { console.error("no meta for section", n); return; }
  current.n = n;
  if (acro !== undefined) current.acro = acro;
  // explicit null/empty -> clear acro selection and the strip
  if (!current.acro) {
    document.getElementById("secStrip").hidden = true;
    window.__renderAcroList?.();
  }
  measure.pts = [];
  hlShown = true;
  resetZoom();
  document.getElementById("hint").hidden = true;
  highlightTick(n);
  syncSlider(n);
  syncHlButton();

  const meta = DATA.sections[n];
  const stage = document.getElementById("stage");
  stage.setAttribute("viewBox", `0 0 ${meta.w} ${meta.h}`);

  // clear overlay (no highlight until image loads)
  document.getElementById("overlay").innerHTML = "";

  updateTitle();
  if (current.acro) {
    buildSecStrip(DATA.acroToSecs[current.acro.toLowerCase()] || [], current.acro);
  }

  // show spinner unless this image was already loaded in the SVG (instant switch back)
  const spinner = document.getElementById("spinner");
  const needLoad = loadedImg !== n;
  if (needLoad) spinner.hidden = false;
  loadingImg = n;

  const pre = new Image();
  pre.onload = () => {
    if (loadingImg !== n) return; // user switched again; ignore stale load
    const svgImg = document.getElementById("secImg");
    svgImg.setAttributeNS(XLINK, "xlink:href", meta.file);
    svgImg.setAttribute("href", meta.file);
    svgImg.setAttribute("width", meta.w);
    svgImg.setAttribute("height", meta.h);
    loadedImg = n;
    spinner.hidden = true;
    applyView();
    renderOverlay();
  };
  pre.onerror = () => {
    if (loadingImg !== n) return;
    spinner.hidden = true;
    console.error("failed to load", meta.file);
  };
  pre.src = meta.file;
}

function applyView() {
  if (current.n == null) return;
  const { w, h } = DATA.sections[current.n];
  const vbW = w / view.scale;
  const vbH = h / view.scale;
  // clamp tx, ty so we don't pan off-image
  view.tx = clamp(view.tx, 0, Math.max(0, w - vbW));
  view.ty = clamp(view.ty, 0, Math.max(0, h - vbH));
  const stage = document.getElementById("stage");
  stage.setAttribute("viewBox", `${view.tx} ${view.ty} ${vbW} ${vbH}`);
}

function resetZoom() {
  view = { scale: 1, tx: 0, ty: 0 };
  applyView();
}

function renderOverlay() {
  const overlay = document.getElementById("overlay");
  overlay.innerHTML = "";
  if (current.n == null) return;
  // don't draw overlay until the image is actually shown
  if (loadedImg !== current.n) return;
  const { w, h } = DATA.sections[current.n];

  // highlight pin(s) for the currently picked acronym
  if (current.acro && hlShown) {
    const ca = current.acro.toLowerCase();
    const pins = (DATA.labels[current.n] || []).filter(l => l.acro.toLowerCase() === ca);
    for (const p of pins) {
      const r = Math.max(26, Math.min(w, h) * 0.045);
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
      c.setAttribute("r", r);
      c.classList.add("hl-pin");
      const ttl = document.createElementNS(SVG_NS, "title");
      ttl.textContent = `${p.acro} — ${p.name}`;
      c.appendChild(ttl);
      overlay.appendChild(c);
    }
  }

  // rubberband rect (during zoomIn drag)
  if (rubber) {
    const x0 = Math.min(rubber.ax, rubber.bx), y0 = Math.min(rubber.ay, rubber.by);
    const rw = Math.abs(rubber.bx - rubber.ax), rh = Math.abs(rubber.by - rubber.ay);
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", x0); r.setAttribute("y", y0);
    r.setAttribute("width", rw); r.setAttribute("height", rh);
    r.setAttribute("stroke-width", 2 / view.scale);
    r.classList.add("rubber");
    overlay.appendChild(r);
  }

  // measure pts + line + label
  for (const [px, py] of measure.pts) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", px); c.setAttribute("cy", py);
    c.setAttribute("r", 5 / view.scale);
    c.classList.add("mpt");
    overlay.appendChild(c);
  }
  if (measure.pts.length === 2) {
    const [a, b] = measure.pts;
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", a[0]); ln.setAttribute("y1", a[1]);
    ln.setAttribute("x2", b[0]); ln.setAttribute("y2", b[1]);
    ln.setAttribute("stroke-width", 2 / view.scale);
    ln.classList.add("mline");
    overlay.appendChild(ln);

    const dpx = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sc = DATA.scales[current.n];
    const text = sc ? `${(dpx * sc.um_per_px).toFixed(1)} µm` : `${dpx.toFixed(1)} px`;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.max(14, Math.min(w, h) * 0.025) / view.scale;
    const tx = mx + (-dy / len) * off;
    const ty = my + (dx  / len) * off;
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", tx); t.setAttribute("y", ty);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", Math.max(14, Math.min(w, h) * 0.025) / view.scale);
    t.setAttribute("stroke-width", 4 / view.scale);
    t.classList.add("mtext");
    t.textContent = text;
    overlay.appendChild(t);
  }
}

// ---------- coords ----------
function svgPointFromEvent(e) {
  const stage = document.getElementById("stage");
  const pt = stage.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const ctm = stage.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  const sp = pt.matrixTransform(inv);
  return [sp.x, sp.y];
}

// ---------- interactions ----------
function setupViewerControls() {
  const stage = document.getElementById("stage");

  document.getElementById("btnDownload").addEventListener("click", () => {
    if (current.n == null) return;
    const meta = DATA.sections[current.n];
    const a = document.createElement("a");
    a.href = meta.file;
    a.download = `goldfish_brain_section_${String(current.n).padStart(2, "0")}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.getElementById("btnHl").addEventListener("click", () => {
    if (!current.acro) return;
    hlShown = !hlShown;
    syncHlButton();
    renderOverlay();
  });

  // wheel always zooms (matlab style), regardless of tool
  stage.addEventListener("wheel", e => {
    if (current.n == null) return;
    e.preventDefault();
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomAt(pt[0], pt[1], factor);
  }, { passive: false });

  // double-click anywhere on stage = fit-to-window
  stage.addEventListener("dblclick", e => {
    if (current.n == null) return;
    e.preventDefault();
    resetZoom();
    renderOverlay();
  });

  // tool-button wiring
  document.querySelectorAll(".tool").forEach(btn => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  // mousedown -- behavior depends on current tool
  stage.addEventListener("mousedown", e => {
    if (current.n == null) return;
    if (e.button !== 0) return;  // only left button starts tool action
    e.preventDefault();
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    dragOrigin = { clientX: e.clientX, clientY: e.clientY, ax: pt[0], ay: pt[1] };

    if (currentTool === "pan") {
      panState = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      document.body.style.cursor = "grabbing";
    } else if (currentTool === "zoomIn") {
      // start potential rubberband; finalised on mouseup if drag detected
      rubber = { ax: pt[0], ay: pt[1], bx: pt[0], by: pt[1] };
    }
    // zoomOut + measure: action happens on mouseup (click semantics)
  });

  window.addEventListener("mousemove", e => {
    if (!dragOrigin) return;
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    if (panState) {
      const { w, h } = DATA.sections[current.n];
      const stageRect = stage.getBoundingClientRect();
      const vbW = w / view.scale, vbH = h / view.scale;
      const sx = stageRect.width / vbW, sy = stageRect.height / vbH;
      view.tx = panState.tx - (e.clientX - panState.x) / sx;
      view.ty = panState.ty - (e.clientY - panState.y) / sy;
      applyView();
    } else if (rubber && currentTool === "zoomIn") {
      rubber.bx = pt[0]; rubber.by = pt[1];
      renderOverlay();
    }
  });

  window.addEventListener("mouseup", e => {
    const wasPan = !!panState;
    const wasRubber = !!rubber;
    if (panState) {
      document.body.style.cursor = "";
      panState = null;
    }
    if (!dragOrigin) return;
    const movedPx = Math.hypot(e.clientX - dragOrigin.clientX, e.clientY - dragOrigin.clientY);
    const isClick = movedPx < 5;

    if (currentTool === "zoomIn") {
      if (wasRubber && !isClick) {
        // rubberband released -> fit viewBox to that rect
        zoomToRect(rubber);
      } else {
        zoomAt(dragOrigin.ax, dragOrigin.ay, 2);
      }
      rubber = null;
      renderOverlay();
    } else if (currentTool === "zoomOut") {
      if (isClick) zoomAt(dragOrigin.ax, dragOrigin.ay, 0.5);
    } else if (currentTool === "measure") {
      if (isClick) {
        if (measure.pts.length >= 2) measure.pts = [];
        measure.pts.push([dragOrigin.ax, dragOrigin.ay]);
        renderOverlay();
      }
    }
    dragOrigin = null;
    if (wasRubber && rubber) { rubber = null; renderOverlay(); }
  });

  // right-click: in measure tool, clear pts; in zoomIn, zoom out (matlab)
  stage.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (current.n == null) return;
    const pt = svgPointFromEvent(e);
    if (currentTool === "measure") {
      if (measure.pts.length) { measure.pts = []; renderOverlay(); }
    } else if (currentTool === "zoomIn" && pt) {
      zoomAt(pt[0], pt[1], 0.5);
    }
  });

  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if (current.n == null) return;
    if (e.key === "ArrowRight") showSection(Math.min(N, current.n + 1), current.acro);
    else if (e.key === "ArrowLeft") showSection(Math.max(1, current.n - 1), current.acro);
    else if (e.key === "Escape") {
      if (rubber) { rubber = null; renderOverlay(); }
      else if (measure.pts.length) { measure.pts = []; renderOverlay(); }
    }
  });

  setTool("measure");
}

function setTool(name) {
  currentTool = name;
  document.querySelectorAll(".tool").forEach(b => {
    b.classList.toggle("active", b.dataset.tool === name);
  });
  const stage = document.getElementById("stage");
  const cursors = { zoomIn: "zoom-in", zoomOut: "zoom-out", pan: "grab", measure: "crosshair" };
  stage.style.cursor = cursors[name] || "default";
}

function zoomToRect(r) {
  if (current.n == null) return;
  const { w, h } = DATA.sections[current.n];
  const x0 = Math.min(r.ax, r.bx), y0 = Math.min(r.ay, r.by);
  const rw = Math.abs(r.bx - r.ax), rh = Math.abs(r.by - r.ay);
  if (rw < 4 || rh < 4) return;
  // pick scale that fits rect into the stage (use the smaller scale = "meet")
  const scaleX = w / rw, scaleY = h / rh;
  const newScale = clamp(Math.min(scaleX, scaleY), 1, 30);
  view.scale = newScale;
  // center the rect in the new viewBox
  const vbW = w / newScale, vbH = h / newScale;
  view.tx = (x0 + rw / 2) - vbW / 2;
  view.ty = (y0 + rh / 2) - vbH / 2;
  applyView();
}

function zoomAt(ix, iy, factor) {
  const oldScale = view.scale;
  const newScale = clamp(oldScale * factor, 1, 30);
  if (newScale === oldScale) return;
  const { w, h } = DATA.sections[current.n];
  // keep (ix, iy) under cursor: new viewBox origin chosen so cursor maps to same image coord
  const vbWnew = w / newScale, vbHnew = h / newScale;
  // current cursor svg coord relative to old viewBox: (ix - view.tx)/(w/oldScale) = u in [0..1]
  const u = (ix - view.tx) / (w / oldScale);
  const v = (iy - view.ty) / (h / oldScale);
  view.tx = ix - u * vbWnew;
  view.ty = iy - v * vbHnew;
  view.scale = newScale;
  applyView();
  renderOverlay();
}

function zoomAtCenter(factor) {
  if (current.n == null) return;
  const { w, h } = DATA.sections[current.n];
  const cx = view.tx + (w / view.scale) / 2;
  const cy = view.ty + (h / view.scale) / 2;
  zoomAt(cx, cy, factor);
}

// ---------- background prefetch ----------
function prefetchAll() {
  const files = Object.values(DATA.sections).map(s => s.file);
  let i = 0;
  const cache = [];      // keep refs so GC doesn't drop the bytes
  const next = () => {
    if (i >= files.length) return;
    const img = new Image();
    cache.push(img);
    img.onload = img.onerror = () => {
      i++;
      // schedule next during idle to avoid jank; fall back to setTimeout
      (window.requestIdleCallback || (cb => setTimeout(cb, 50)))(next);
    };
    img.src = files[i];
  };
  // start after current section finishes loading
  (window.requestIdleCallback || (cb => setTimeout(cb, 200)))(next);
}

// ---------- boot ----------
(async () => {
  try {
    await loadData();
    buildTicks();
    setupBrowser();
    buildSlider();
    positionAxisLabels();
    setupViewerControls();
    showSection(1, null);   // auto-load first section so viewer is never empty
    prefetchAll();          // warm browser cache with the other 24 sections
  } catch (err) {
    console.error("boot failed:", err);
    const hint = document.getElementById("hint");
    if (hint) hint.textContent = "Failed to load atlas data — open the JS console for details.";
  }
})();
