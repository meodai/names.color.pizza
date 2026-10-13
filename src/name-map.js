import {
  LISTS,
  UNNAMED,
  clamp,
  hexToRgb,
  rgbToHex,
  rgbToOklab,
  oklabToRgb,
  normalizeHex,
  fold,
  getList,
  nearestIndex,
  colorURL,
} from "./names.js";
import { findCusp, chromaStops, chromaFor, toeInv, okhslToOklab, oklabToOkhsl } from "./okhsl.js";

const Z_MAX = 24;
const START_S = 0.5;
const RIM = 12; // CSS px around the fitted disc

const fmt = (n) => n.toLocaleString("en-US");
const wrap = (v) => ((v % 1) + 1) % 1;

const okhslOf = (item) => (item.okhsl ??= oklabToOkhsl(item.L, item.a, item.b));

const LUT_H = 720;
const LUT_L = 256;
let lut = null;

function buildLut() {
  lut = new Float32Array(LUT_H * LUT_L * 3);
  for (let i = 0; i < LUT_H; i++) {
    const t = (2 * Math.PI * i) / LUT_H;
    const a = Math.cos(t);
    const b = Math.sin(t);
    const cusp = findCusp(a, b);
    for (let j = 0; j < LUT_L; j++) {
      const L = toeInv(clamp(j / (LUT_L - 1), 0.002, 0.998));
      lut.set(chromaStops(L, a, b, cusp), (i * LUT_L + j) * 3);
    }
  }
}

// bilinear lookup, written into out[o..o+2]
function stopsAt(h, l, out, o) {
  const fh = h * LUT_H;
  const fl = l * (LUT_L - 1);
  const i0 = Math.floor(fh) % LUT_H;
  const i1 = (i0 + 1) % LUT_H;
  const j0 = Math.min(LUT_L - 2, Math.floor(fl));
  const th = fh - Math.floor(fh);
  const tl = fl - j0;
  const p00 = (i0 * LUT_L + j0) * 3;
  const p10 = (i1 * LUT_L + j0) * 3;
  for (let c = 0; c < 3; c++) {
    const top = lut[p00 + c] + (lut[p00 + 3 + c] - lut[p00 + c]) * tl;
    const bot = lut[p10 + c] + (lut[p10 + 3 + c] - lut[p10 + c]) * tl;
    out[o + c] = top + (bot - top) * th;
  }
}

export function initNameMap(root) {
  const q = (sel) => root.querySelector(sel);
  const frame = q("[data-frame]");
  const home = q("[data-home]");
  const panel = q("[data-panel]");
  const mosaic = q("[data-mosaic]");
  const labels = q("[data-labels]");
  const hit = q("[data-hit]");
  const tip = q("[data-tip]");
  const pin = q("[data-pin]");
  const depth = q("[data-depth]");
  const depthValue = q("[data-depth-value]");
  const readout = q("[data-readout]");
  const hint = q("[data-hint]");
  const findInput = q("[data-find-input]");
  const findResults = q("[data-results]");
  const listSelect = q("[data-list]");

  const mctx = mosaic.getContext("2d");
  const lctx = labels.getContext("2d");
  const hctx = hit.getContext("2d");

  const state = {
    s: START_S,
    list: "default",
    view: { cx: 0, cy: 0, z: 1 },
    slice: null,
    hover: null,
    selected: null, // { kind: 'name', item } or { kind: 'blank', hex, L, a, b, h, l, s }
    cursor: null,
    engaged: false,
  };
  const loaded = {};
  let bestSet = new Set();

  let W = 800;
  let H = 500;
  let HX = 400;
  let HY = 250;
  let R = 200;
  let dpr = 1;

  function sizeFrame() {
    W = Math.max(160, Math.floor(frame.clientWidth));
    H = Math.max(160, Math.floor(frame.clientHeight));
    const box = frame.getBoundingClientRect();
    const free = home.getBoundingClientRect();
    HX = free.left - box.left + free.width / 2;
    HY = free.top - box.top + free.height / 2;
    R = Math.max(60, Math.min(free.width, free.height) / 2 - RIM);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [labels, hit]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
  }

  // the disc has radius 1, lightness 0 at the center
  const unit = () => R * state.view.z;

  const toCss = (h, l) => {
    const { cx, cy } = state.view;
    const t = 2 * Math.PI * h;
    const u = unit();
    return [HX + (l * Math.cos(t) - cx) * u, HY - (l * Math.sin(t) - cy) * u];
  };
  const toDisc = (x, y) => {
    const { cx, cy } = state.view;
    const u = unit();
    return [cx + (x - HX) / u, cy - (y - HY) / u];
  };
  const toHsl = (x, y, slack = 0) => {
    const [X, Y] = toDisc(x, y);
    const l = Math.hypot(X, Y);
    return l > 1 + slack ? null : [wrap(Math.atan2(Y, X) / (2 * Math.PI)), Math.min(l, 1)];
  };

  function discRect() {
    const u = unit();
    const [X, Y] = toCss(0, 0);
    const x = Math.max(0, Math.floor(X - u));
    const y = Math.max(0, Math.floor(Y - u));
    const w = Math.min(W, Math.ceil(X + u)) - x;
    const h = Math.min(H, Math.ceil(Y + u)) - y;
    return { x, y, w, h, X, Y, u };
  }

  function setView(cx, cy, z) {
    z = clamp(z, 1, Z_MAX);
    const lim = 1 - 1 / z;
    const d = Math.hypot(cx, cy);
    const k = d > lim ? lim / d : 1;
    state.view = { cx: cx * k, cy: cy * k, z };
  }

  // stops depend only on hue and lightness, so they survive saturation changes
  const tables = {};

  function getTable(NX, NY, rect) {
    const { cx, cy, z } = state.view;
    const key = `${NX}x${NY}|${W}x${H}|${cx}|${cy}|${z}`;
    const kind = NX * NY > 60000 ? "crisp" : "fast";
    if (tables[kind]?.key === key) return tables[kind];

    const size = NX * NY;
    const Lp = new Float32Array(size).fill(-1); // -1 marks pixels off the disc
    const ca = new Float32Array(size);
    const cb = new Float32Array(size);
    const stops = new Float32Array(size * 3); // C0, Cmid, Cmax per pixel
    const lim = (1 + 2 / rect.u) ** 2; // just past the rim, so the clipped edge is solid
    for (let y = 0; y < NY; y++) {
      const Y = cy - (rect.y + ((y + 0.5) / NY) * rect.h - HY) / rect.u;
      for (let x = 0; x < NX; x++) {
        const X = cx + (rect.x + ((x + 0.5) / NX) * rect.w - HX) / rect.u;
        const r2 = X * X + Y * Y;
        if (r2 > lim) continue;
        const p = y * NX + x;
        const r = Math.sqrt(r2);
        const l = clamp(r, 0.002, 0.998);
        Lp[p] = toeInv(l);
        ca[p] = r > 1e-9 ? X / r : 1;
        cb[p] = r > 1e-9 ? Y / r : 0;
        stopsAt(wrap(Math.atan2(Y, X) / (2 * Math.PI)), l, stops, p * 3);
      }
    }
    tables[kind] = { key, Lp, ca, cb, stops };
    return tables[kind];
  }

  // owner: index into items, -1 for unnamed ground, -2 off the disc
  function computeSlice(data, s, rect, NX, NY) {
    const t = getTable(NX, NY, rect);
    const n = data.items.length;
    const owner = new Int32Array(NX * NY);
    const area = new Float32Array(n);
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    let land = 0;
    let blank = 0;
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const p = y * NX + x;
        const L = t.Lp[p];
        if (L < 0) {
          owner[p] = -2;
          continue;
        }
        land++;
        const C = chromaFor(s, t.stops[p * 3], t.stops[p * 3 + 1], t.stops[p * 3 + 2]);
        const k = nearestIndex(data, L, C * t.ca[p], C * t.cb[p]);
        owner[p] = k;
        if (k < 0) blank++;
        else {
          area[k]++;
          sx[k] += x;
          sy[k] += y;
        }
      }
    }
    return { s, rect, NX, NY, table: t, items: data.items, owner, area, sx, sy, land, blank };
  }

  function paintMosaic(sl, crisp) {
    const { NX, NY, owner, items, table: t, s, rect } = sl;
    mosaic.width = NX;
    mosaic.height = NY;
    Object.assign(mosaic.style, {
      left: rect.x + "px",
      top: rect.y + "px",
      width: rect.w + "px",
      height: rect.h + "px",
      clipPath: `circle(${rect.u}px at ${rect.X - rect.x}px ${rect.Y - rect.y}px)`,
    });
    const img = mctx.createImageData(NX, NY);
    const d = img.data;
    // outlines fade in with zoom, full from 4×
    const edge = crisp ? 1 - 0.16 * clamp((state.view.z - 2) / 2, 0, 1) : 1;
    const period = Math.max(2, Math.round((NX / rect.w) * 4));

    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const p = y * NX + x;
        const o = owner[p];
        const i = p * 4;
        if (o === -2) continue;
        let r;
        let g;
        let b;
        if (o === -1) {
          // unnamed ground: hatched with a paler stripe
          const C = chromaFor(s, t.stops[p * 3], t.stops[p * 3 + 1], t.stops[p * 3 + 2]);
          [r, g, b] = oklabToRgb(t.Lp[p], C * t.ca[p], C * t.cb[p]);
          if (Math.floor((x + y) / period) & 1) {
            r += (255 - r) * 0.6;
            g += (255 - g) * 0.6;
            b += (255 - b) * 0.6;
          }
        } else {
          [r, g, b] = items[o].rgb;
          if (edge < 1) {
            const right = x < NX - 1 ? owner[p + 1] : o;
            const down = y < NY - 1 ? owner[p + NX] : o;
            if ((right !== o && right !== -2) || (down !== o && down !== -2)) {
              r *= edge;
              g *= edge;
              b *= edge;
            }
          }
        }
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
  }

  // near-gray rings have their centroid in the hole, hence the fallback
  function anchorOf(sl, k) {
    const { rect, NX, NY, owner, area, sx, sy } = sl;
    const owns = (x, y) => {
      const px = Math.floor(((x - rect.x) / rect.w) * NX);
      const py = Math.floor(((y - rect.y) / rect.h) * NY);
      return px >= 0 && py >= 0 && px < NX && py < NY && owner[py * NX + px] === k;
    };
    const cx = rect.x + (sx[k] / area[k] + 0.5) * (rect.w / NX);
    const cy = rect.y + (sy[k] / area[k] + 0.5) * (rect.h / NY);
    if (owns(cx, cy)) return [cx, cy];
    const [h, , l] = okhslOf(sl.items[k]);
    const own = toCss(h, l);
    return owns(...own) ? own : null;
  }

  const overlaps = (box, boxes) => boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);

  function drawLabels(sl) {
    const ctx = lctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    // the panel counts as taken, so no label hides under it
    const origin = frame.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const boxes = [[p.left - origin.left, p.top - origin.top, p.right - origin.left, p.bottom - origin.top]];

    const { items, area, NX, NY, rect } = sl;
    const scx = rect.w / NX;
    const scy = rect.h / NY;
    const cand = [];
    for (let k = 0; k < items.length; k++) {
      if (!area[k]) continue;
      const ac = area[k] * scx * scy;
      if (ac >= 260) cand.push([k, ac * (bestSet.has(items[k].hex) ? 2.2 : 1)]);
    }
    cand.sort((a, b) => b[1] - a[1]);

    let placed = 0;
    for (const [k] of cand) {
      if (placed >= 260) break;
      const it = items[k];
      const ac = area[k] * scx * scy;
      const fs = clamp(6 + Math.sqrt(ac) * 0.08, 10, 26);
      ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(it.name).width;
      const at = anchorOf(sl, k);
      if (!at) continue;
      const [x, y] = at;
      const box = [x - w / 2 - 3, y - fs * 0.6, x + w / 2 + 3, y + fs * 0.6];
      if (box[0] < 0 || box[2] > W || box[1] < 0 || box[3] > H) continue;
      if (overlaps(box, boxes)) continue;
      boxes.push(box);
      placed++;
      ctx.lineWidth = 3;
      ctx.strokeStyle = it.hex;
      ctx.strokeText(it.name, x, y);
      ctx.fillStyle = it.L > 0.62 ? "#000" : "#fff";
      ctx.fillText(it.name, x, y);
    }
  }

  function outline(k, color, width) {
    const { NX, NY, owner, rect } = state.slice;
    const scx = rect.w / NX;
    const scy = rect.h / NY;
    const ctx = hctx;
    ctx.beginPath();
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const p = y * NX + x;
        if (owner[p] !== k) continue;
        const X = rect.x + x * scx;
        const Y = rect.y + y * scy;
        if (x === 0 || owner[p - 1] !== k) {
          ctx.moveTo(X, Y);
          ctx.lineTo(X, Y + scy);
        }
        if (x === NX - 1 || owner[p + 1] !== k) {
          ctx.moveTo(X + scx, Y);
          ctx.lineTo(X + scx, Y + scy);
        }
        if (y === 0 || owner[p - NX] !== k) {
          ctx.moveTo(X, Y);
          ctx.lineTo(X + scx, Y);
        }
        if (y === NY - 1 || owner[p + NX] !== k) {
          ctx.moveTo(X, Y + scy);
          ctx.lineTo(X + scx, Y + scy);
        }
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function selectedIndex() {
    const sel = state.selected;
    const sl = state.slice;
    if (!sel || sel.kind !== "name" || !sl) return -1;
    const k = sl.items.indexOf(loaded[state.list].byHex.get(sel.item.hex));
    return k >= 0 && sl.area[k] > 0 ? k : -1;
  }

  function drawHighlights() {
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, W, H);
    if (!state.slice) return;
    const sk = selectedIndex();
    if (sk >= 0) {
      outline(sk, "#000", 3.5);
      outline(sk, "#fff", 1.5);
    }
    if (state.hover != null && state.hover !== sk) outline(state.hover, "#fff", 1.5);
    if (state.cursor) {
      const { x, y } = state.cursor;
      hctx.strokeStyle = "#fff";
      hctx.lineWidth = 1.5;
      hctx.beginPath();
      hctx.moveTo(x - 10, y);
      hctx.lineTo(x + 10, y);
      hctx.moveTo(x, y - 10);
      hctx.lineTo(x, y + 10);
      hctx.stroke();
    }
  }

  function placePin() {
    const sel = state.selected;
    const sl = state.slice;
    let pos = null;
    const k = selectedIndex();
    if (k >= 0) pos = anchorOf(sl, k);
    else if (sel?.kind === "blank" && Math.abs(sel.s - state.s) < 0.006) {
      pos = toCss(sel.h, sel.l);
    }
    if (!pos || pos[0] < 0 || pos[1] < 0 || pos[0] > W || pos[1] > H) {
      pin.hidden = true;
      return;
    }
    pin.hidden = false;
    pin.style.left = pos[0] + "px";
    pin.style.top = pos[1] + "px";
  }

  function updateReadout(sl) {
    let names = 0;
    for (let k = 0; k < sl.area.length; k++) if (sl.area[k] > 0) names++;
    const pct = sl.land ? Math.round((sl.blank / sl.land) * 100) : 0;
    const where = state.view.z > 1 ? "this view" : "the map";
    readout.textContent =
      `At ${Math.round(state.s * 100)}% saturation, ${fmt(names)} names share ${where}. ` +
      (pct ? `${pct}% of it has no name yet.` : "Every color in view has a name.");
  }

  function updateHint() {
    hint.textContent = state.engaged ? "Scroll to zoom. Drag to move." : "Click the map, then scroll to zoom.";
  }

  function render(crisp) {
    const data = loaded[state.list];
    if (!data) return;
    const rect = discRect();
    const px = rect.w * rect.h;
    const k = crisp ? Math.min(dpr * 0.7, Math.sqrt(300000 / px)) : Math.min(dpr * 0.3, Math.sqrt(36000 / px));
    const NX = Math.max(40, Math.round(rect.w * k));
    const NY = Math.max(40, Math.round(rect.h * k));
    state.slice = computeSlice(data, state.s, rect, NX, NY);
    state.hover = null;
    if (!state.cursor) tip.hidden = true;
    paintMosaic(state.slice, crisp);
    drawLabels(state.slice);
    drawHighlights();
    placePin();
    updateReadout(state.slice);
  }

  let raf = 0;
  let idle = 0;
  function requestRender() {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        render(false);
      });
    }
    clearTimeout(idle);
    idle = setTimeout(() => render(true), 180);
  }

  function syncDepth() {
    const pct = Math.round(state.s * 100);
    depth.value = Math.round(state.s * 1000);
    depthValue.textContent = pct;
    depth.setAttribute("aria-valuetext", `${pct}% saturation`);
  }

  function setSaturation(s) {
    state.s = clamp(s, 0, 1);
    syncDepth();
    requestRender();
  }

  depth.addEventListener("input", () => setSaturation(depth.value / 1000));

  function zoomAt(x, y, factor) {
    const [X, Y] = toDisc(x, y);
    const z = clamp(state.view.z / factor, 1, Z_MAX);
    const u = R * z;
    setView(X - (x - HX) / u, Y + (y - HY) / u, z);
    tip.hidden = true;
    requestRender();
  }

  q("[data-zoom-in]").addEventListener("click", () => zoomAt(HX, HY, 0.5));
  q("[data-zoom-out]").addEventListener("click", () => zoomAt(HX, HY, 2));
  q("[data-zoom-fit]").addEventListener("click", () => {
    setView(0, 0, 1);
    requestRender();
  });

  // the wheel zooms only after a click, so the page can still scroll past
  function engage(on) {
    if (state.engaged === on) return;
    state.engaged = on;
    updateHint();
  }
  root.addEventListener("pointerleave", () => engage(false));

  hit.addEventListener(
    "wheel",
    (e) => {
      const pinch = e.ctrlKey;
      if (!state.engaged && !pinch) return;
      const step = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * step;
      const dy = e.deltaY * step;
      if (!pinch && Math.abs(dx) > Math.abs(dy)) {
        if (state.view.z <= 1) return;
        e.preventDefault();
        const { cx, cy, z } = state.view;
        setView(cx + dx / unit(), cy, z);
        requestRender();
        return;
      }
      const { z } = state.view;
      if ((dy > 0 && z <= 1) || (dy < 0 && z >= Z_MAX)) return;
      e.preventDefault();
      const rect = hit.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(dy * (pinch ? 0.01 : 0.002)));
    },
    { passive: false },
  );

  function ownerAt(x, y) {
    const sl = state.slice;
    if (!sl) return null;
    if (!toHsl(x, y)) return -2;
    const { rect } = sl;
    const px = clamp(Math.floor(((x - rect.x) / rect.w) * sl.NX), 0, sl.NX - 1);
    const py = clamp(Math.floor(((y - rect.y) / rect.h) * sl.NY), 0, sl.NY - 1);
    return sl.owner[py * sl.NX + px];
  }

  function blankAt(x, y) {
    const hl = toHsl(x, y);
    if (!hl) return null;
    const [h, l] = hl;
    const [L, a, b] = okhslToOklab(h, state.s, l);
    return { hex: rgbToHex(oklabToRgb(L, a, b)), L, a, b, h, l, s: state.s };
  }

  function showTipAt(x, y) {
    const o = ownerAt(x, y);
    if (o == null) return;
    if (o === -2) {
      tip.hidden = true;
      if (state.hover != null) {
        state.hover = null;
        drawHighlights();
      }
      return;
    }
    tip.innerHTML = "<span></span><small></small>";
    if (o >= 0) {
      const it = state.slice.items[o];
      tip.firstChild.textContent = it.name;
      tip.lastChild.textContent = it.hex;
    } else {
      tip.firstChild.textContent = "No name yet";
      tip.lastChild.textContent = blankAt(x, y).hex;
    }
    tip.hidden = false;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    tip.style.transform = x > W - 200 ? "translate(calc(-100% - 14px), 14px)" : "translate(14px, 14px)";
    const hover = o >= 0 ? o : null;
    if (hover !== state.hover) {
      state.hover = hover;
      drawHighlights();
    }
  }

  function pickAt(x, y) {
    const o = ownerAt(x, y);
    if (o == null) return;
    if (o >= 0) selectName(state.slice.items[o]);
    else if (o === -1) selectBlank(blankAt(x, y));
  }

  let down = null;
  const local = (e) => {
    const rect = hit.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  hit.addEventListener("pointerdown", (e) => {
    engage(true);
    down = { x: e.clientX, y: e.clientY, view: { ...state.view }, panning: false };
  });
  hit.addEventListener("pointermove", (e) => {
    if (down && e.buttons & 1) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.panning && Math.hypot(dx, dy) > 5) {
        down.panning = true;
        hit.setPointerCapture(e.pointerId);
        hit.classList.add("is-panning");
        tip.hidden = true;
      }
      if (down.panning) {
        const { cx, cy, z } = down.view;
        const u = R * z;
        setView(cx - dx / u, cy + dy / u, z);
        requestRender();
        return;
      }
    }
    state.cursor = null;
    showTipAt(...local(e));
  });
  hit.addEventListener("pointerup", (e) => {
    if (down && !down.panning) pickAt(...local(e));
    down = null;
    hit.classList.remove("is-panning");
  });
  hit.addEventListener("pointercancel", () => {
    down = null;
    hit.classList.remove("is-panning");
  });
  hit.addEventListener("pointerleave", () => {
    if (down) return;
    tip.hidden = true;
    state.hover = null;
    drawHighlights();
  });

  hit.addEventListener("focus", () => engage(true));
  hit.addEventListener("keydown", (e) => {
    const c = (state.cursor ??= { x: HX, y: HY });
    const step = (e.shiftKey ? 0.1 : 0.02) * Math.min(W, H);
    const keys = {
      ArrowLeft: () => (c.x -= step),
      ArrowRight: () => (c.x += step),
      ArrowUp: () => (c.y -= step),
      ArrowDown: () => (c.y += step),
      PageUp: () => setSaturation(state.s + 0.05),
      PageDown: () => setSaturation(state.s - 0.05),
      Enter: () => pickAt(c.x, c.y),
      " ": () => pickAt(c.x, c.y),
      "+": () => zoomAt(c.x, c.y, 0.5),
      "=": () => zoomAt(c.x, c.y, 0.5),
      "-": () => zoomAt(c.x, c.y, 2),
      Escape: () => clearSelection(),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
    c.x = clamp(c.x, 0, W - 1);
    c.y = clamp(c.y, 0, H - 1);
    showTipAt(c.x, c.y);
    drawHighlights();
  });
  hit.addEventListener("blur", () => {
    state.cursor = null;
    tip.hidden = true;
    drawHighlights();
  });

  function restartPin() {
    pin.style.animation = "none";
    void pin.offsetWidth;
    pin.style.animation = "";
  }

  function select(selected, detailHex) {
    state.selected = selected;
    restartPin();
    drawHighlights();
    placePin();
    if (detailHex) location.href = colorURL(detailHex);
  }

  const selectName = (item, detailHex = item.hex) => select({ kind: "name", item }, detailHex);
  const selectBlank = (spot, detailHex = spot.hex) => select({ kind: "blank", ...spot }, detailHex);

  function clearSelection() {
    state.selected = null;
    pin.hidden = true;
    drawHighlights();
  }

  function flyTo(h, s, l, zoom = true) {
    state.s = s;
    syncDepth();
    const t = 2 * Math.PI * h;
    if (zoom) setView(l * Math.cos(t), l * Math.sin(t), 6);
    else setView(0, 0, 1);
    render(true);
  }

  function goToItem(item, zoom = true, detailHex = item.hex) {
    flyTo(...okhslOf(item), zoom);
    selectName(item, detailHex);
  }

  function goToHex(hex, { zoom = true, open = true } = {}) {
    const data = loaded[state.list];
    const detailHex = open && hex;
    const exact = data.byHex.get(hex);
    if (exact) return goToItem(exact, zoom, detailHex);
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    const k = nearestIndex(data, L, a, b);
    if (k >= 0) return goToItem(data.items[k], zoom, detailHex);
    const [h, s, l] = oklabToOkhsl(L, a, b);
    flyTo(h, s, l, zoom);
    selectBlank({ hex, L, a, b, h, s, l }, detailHex);
  }

  function resultButton(swatch, text, onPick) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = '<span class="name-map__dot" aria-hidden="true"></span><span></span>';
    btn.style.setProperty("--swatch", swatch);
    btn.lastChild.textContent = text;
    btn.addEventListener("click", () => {
      onPick();
      findResults.replaceChildren();
    });
    li.append(btn);
    return li;
  }

  function search() {
    const raw = findInput.value.trim();
    const data = loaded[state.list];
    if (!raw || !data) return findResults.replaceChildren();
    const hex = normalizeHex(raw);
    if (hex) {
      return findResults.replaceChildren(resultButton(hex, `Go to ${hex}`, () => goToHex(hex)));
    }
    const needle = fold(raw);
    const starts = [];
    const contains = [];
    for (const it of data.items) {
      if (it.lower.startsWith(needle)) starts.push(it);
      else if (contains.length < 6 && it.lower.includes(needle)) contains.push(it);
    }
    starts.sort((x, y) => x.name.length - y.name.length);
    const hits = starts.concat(contains).slice(0, 6);
    if (!hits.length) {
      const li = document.createElement("li");
      li.className = "name-map__empty";
      li.textContent = `No name contains “${raw}” in the ${LISTS[state.list]} list.`;
      return findResults.replaceChildren(li);
    }
    findResults.replaceChildren(...hits.map((it) => resultButton(it.hex, it.name, () => goToItem(it))));
  }

  findInput.addEventListener("input", search);
  q("[data-find]").addEventListener("submit", (e) => {
    e.preventDefault();
    findResults.querySelector("button")?.click();
  });

  listSelect.addEventListener("change", async () => {
    state.list = listSelect.value;
    readout.textContent = "Loading names…";
    loaded[state.list] = await getList(state.list);
    search();
    render(true);
  });

  document.addEventListener("color-names:show", (e) => {
    if (loaded[state.list]) goToHex(e.detail.hex, { open: false });
  });

  syncDepth();
  updateHint();
  sizeFrame();
  new ResizeObserver(() => {
    sizeFrame();
    if (state.slice) render(true);
  }).observe(frame);

  buildLut();
  getList("bestOf").then((d) => {
    bestSet = new Set(d.items.map((i) => i.hex));
  });
  Promise.all([getList("default"), document.fonts.load("600 16px Inter").catch(() => {})])
    .then(([data]) => {
      loaded.default = data;
      const target = normalizeHex(new URLSearchParams(location.search).get("color"));
      if (target) goToHex(target, { open: false });
      else render(true);
    })
    .catch(() => {
      readout.textContent = "The names didn’t load. Check your connection and reload the page.";
    });
}
