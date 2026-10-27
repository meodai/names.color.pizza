import {
  getList,
  LISTS,
  normalizeHex,
  slugsOf,
  hexToRgb,
  rgbToOklab,
  cardPlace,
  showVersion,
  siteURL,
} from "./names.js";
import { buildOwners, createCellsRenderer, pick as pickCell, MODEL_IDS } from "./cells.js";
import { createLabelRenderer } from "./labels-gl.js";
import { counts, loadAdoptions } from "./shines.js";
import { createSparkleRenderer } from "./sparkles-gl.js";
import { pixelMode, setPixelMode } from "./pixel-mode.js";
import { readAddress, writeAddress } from "./address.js";
import { createPixelSpace } from "./pixel-space.js";
import { NOT_DRAWN, blankURL } from "./pixel-blank.js";
import { reduceMotion, ease, easeInOut, clamp, wrap, sub, add, scale, dot, cross, norm, lerp3 } from "./wall/math.js";
import { CARD_W, CARD_H, cardScale, MODELS, DEFAULT_MODEL, GEO, CELL_REACH } from "./wall/models.js";
import { createRenderer, NEAR, FAR, NEAR_SLOTS } from "./wall/renderer.js";
import { createViewSwitch } from "./wall/views.js";
import { createSearch } from "./wall/search.js";
import { createList } from "./wall/list.js";
import { createKeys } from "./wall/keys.js";
import { createPage } from "./wall/page.js";

// a short list's cards grow, so a handful don't drown in the space: as big as the
// Short list's cards would be at the same density, up to 8 times
let W = CARD_W;
let H = CARD_H;

const FOV = (42 * Math.PI) / 180;
const MIN_DIST = 2.5;
const MAX_DIST = 860;
// world units flown per unit of log zoom, once past MIN_DIST
const THROUGH = 18;
const DAMPING = 0.1; // share of the remaining motion per frame (OrbitControls: 0.05)
const MORPH_MS = 1400;
const BANG_MS = 2600;
const LIST_SHIFT_MS = 600;
// [start, length] in ms; the parts overlap so it reads as one movement
const IN = { fly: 800, clear: [0, 450], repel: [150, 500], fade: [420, 380], glide: 640, travel: 760 };
const OUT = { leave: 300, travel: 760, fade: [380, 420], repel: [520, 520], fly: 900 };
const part = (t, [at, length]) => ease(clamp((t - at) / length, 0, 1));
const START_DIST = 340;
const LABEL_PX = 60;
const MAX_LABELS = 260;
// share of a name's strip nearer cards may cover before the name is left out
const LABEL_COVERED = 0.45;
// a card wider than this share of the screen's short side dissolves, in its own time
const NEAR_AT = 0.5;
const NEAR_MS = 260;

// a card's name strip slides out under it, then its name fades in
const STRIP_MS = 200;
// names come out from the middle of the view: the edge this much later
const STRIP_SPREAD_MS = 350;
// camera speed (share of its distance moved, plus radians turned, per second) past which
// names stay away until it has been slower for CALM_MS
const RUSH = 1.2;
const CALM_MS = 160;
// the cards in front of a hovered one make way after HOVER_WAIT, over HOVER_MS
const HOVER_WAIT = 140;
const HOVER_MS = 220;
const FOCUS_PX = 230;
// the dice's flight: turns round and over, the share of it spent going out, and how long; the
// way in speeds up for the first share of it, cruises, and slows down over the last
const ROLL = { turns: 3, flips: 1, out: 0.2, ms: 4200, speedUp: 0.15, slowDown: 0.35 };
// 0 to 1 at a steady speed between speeding up and slowing down, so the way through the bulk of
// the colors goes by evenly
function cruise(t, up, down) {
  const top = 1 / (1 - up / 2 - down / 2);
  if (t < up) return (top * t * t) / (2 * up);
  if (t > 1 - down) return 1 - (top * (1 - t) ** 2) / (2 * down);
  return top * (t - up / 2);
}

const CARD_HTML = `<article class="swatchcard swatchcard--visible swatchcard--reset">
  <div class="swatchcard__upper"><i class="swatchcard__swatch" aria-hidden="true">
    <i class="swatchcard__shade"></i><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i>
  </i></div>
  <div class="swatchcard__label"><div class="swatchcard__info">
    <span class="swatchcard__row1"></span><span class="swatchcard__row2"></span>
  </div></div>
</article>`;

export async function initWall(root) {
  const q = (s) => root.querySelector(s);
  showVersion(root);
  const canvas = q("[data-canvas]");
  const labels = q("[data-labels]");
  const mark = q("[data-mark]");
  const tip = q("[data-tip]");
  const status = q("[data-status]");
  const search = q("[data-search]");
  const intro = q("[data-intro]");

  let introWanted = true;
  try {
    introWanted = !localStorage.getItem("wall-intro-seen");
  } catch {}
  // how many are adopted so far, once the adoptions are in; asked once the intro shows
  let counted = false;
  function tellAdopted() {
    if (counted) return;
    counted = true;
    loadAdoptions()
      .then((adopted) => {
        const n = counts(adopted);
        // the invitation's own line until there's a count to tell
        if (n.colors)
          q("[data-adopted-count]").textContent =
            `${n.colors.toLocaleString("en-US")} ${n.colors === 1 ? "color" : "colors"} adopted by ${n.patrons.toLocaleString("en-US")} ${n.patrons === 1 ? "patron" : "patrons"}`;
      })
      .catch(() => {});
  }
  if (introWanted) tellAdopted();
  // the ? beside GitHub opens and closes it
  const help = q("[data-intro-open]");
  // it goes as it came, sliding off and fading, before it's hidden
  function closeIntro() {
    if (intro.hidden || intro.classList.contains("is-leaving")) return;
    intro.classList.add("is-leaving");
    help.setAttribute("aria-expanded", "false");
    setTimeout(
      () => {
        intro.classList.remove("is-leaving");
        intro.hidden = true;
      },
      reduceMotion ? 0 : 300,
    );
    try {
      localStorage.setItem("wall-intro-seen", "1");
    } catch {}
  }
  q("[data-intro-close]").addEventListener("click", closeIntro);
  q("[data-intro-x]").addEventListener("click", closeIntro);
  help.addEventListener("click", () => {
    if (!intro.hidden) return closeIntro();
    tellAdopted();
    intro.hidden = false;
    help.setAttribute("aria-expanded", "true");
    q("[data-intro-close]").focus({ preventScroll: true });
  });

  // the page starts with all of this away (index.html) and brings it in as a color page's
  // close does: as the space flies in, at once when it's restored or can't load
  const enter = () => root.classList.remove("is-opening");

  // what the address asked for, read before any control writes it to its own
  const asked = readAddress();
  let listKey = asked.list;
  if (!LISTS[listKey]) listKey = "default";
  let list;
  try {
    list = await getList(listKey);
  } catch {
    status.textContent = "The names didn’t load. Check your connection and reload the page.";
    enter();
    return;
  }
  let items = list.items;
  let n = items.length;
  W = CARD_W * cardScale(n);
  H = CARD_H * cardScale(n);
  const showCount = () =>
    root.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = n.toLocaleString("en-US");
    });
  showCount();
  if (introWanted) {
    intro.hidden = false;
    help.setAttribute("aria-expanded", "true");
  }

  const colorsOf = (list) => {
    const out = new Uint8Array(list.length * 3);
    list.forEach((it, i) => out.set(it.rgb, i * 3));
    return out;
  };
  let colors = colorsOf(items);
  const placed = {};
  const placeAll = (key) =>
    (placed[key] ??= (() => {
      const out = new Float32Array(n * 3);
      items.forEach((it, i) => out.set(MODELS[key].place(it), i * 3));
      return out;
    })());

  const middles = {};
  const middleOf = (key) => (middles[key] ??= home(key).target);

  const picker = q("[data-models]");
  let model = asked.model;
  const startView = asked.view;
  if (!MODELS[model]) model = DEFAULT_MODEL;
  let positions = placeAll(model).slice();
  const posOf = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

  let draw;
  try {
    draw = createRenderer(canvas, positions, colors, undefined, [W, H]);
  } catch (e) {
    console.error(e);
  }
  if (!draw) {
    status.textContent = "This view needs WebGL, which this browser doesn’t offer.";
    enter();
    return;
  }
  // the names in the 3D view; without them the HTML labels stay
  let texts = null;
  let textsFor = draw;
  try {
    texts = createLabelRenderer(draw.gl, { W: CARD_W, H: CARD_H, NEAR, FAR, NEAR_SLOTS });
    texts.scale = cardScale(n);
  } catch (e) {
    console.error(e);
  }
  // the A–Z list, over the space when it's up
  const azList = createList(root, {
    items: () => items,
    get search() {
      return searchBox;
    },
    saveable: () => saveable(),
    flyTo: (to, ms) => flyTo(to, ms),
    home: () => home(),
    busy: () => busy,
    stopIdle: () => stopIdle(),
    request: () => request(),
    showModel: () => showModel(),
    showView: () => showView(),
    pixelOn: () => pixelArt.on,
    pixelOf: (i) => pixelOf(i),
    maxDist: MAX_DIST,
  });
  const textInGL = () =>
    texts && !opening && !spot && cellsMix <= 0 && azList.mix() <= 0 && !morph && !bang && !listShift;
  status.hidden = true;
  // the adopted colors glitter among the rest: by name, so it holds in every list
  let adoptedNames = new Set();
  let glitter = [];
  let sparkles = null;
  try {
    sparkles = createSparkleRenderer(draw.gl, { NEAR, FAR, W: CARD_W, H: CARD_H });
    sparkles.scale = cardScale(n);
  } catch (e) {
    console.error(e);
  }
  // the space in pixel art (pixel-space.js)
  const pixelArt = createPixelSpace({
    getDraw: () => draw,
    getItems: () => items,
    onScreen: (...a) => onScreen(...a),
    request: () => request(),
    reduceMotion,
    onToggle: (on) => on && (tip.hidden = true),
    // the list's drawings, once the space knows which name has which
    onSlots: () => azList.refresh(),
    getFocus: () => opening?.i ?? spot?.i ?? -1,
  });
  window.addEventListener("pixelmode", (e) => {
    if (e.detail !== pixelArt.on) pixelArt.toggle();
    showMode();
    azList.refresh();
  });
  if (pixelMode()) pixelArt.toggle();

  function markStars() {
    glitter = [];
    items.forEach(
      (it, i) => adoptedNames.has(it.name) && glitter.push({ i, cell: null, at: -1e9, rest: 0, flash: 0, turn: 0 }),
    );
    request();
  }
  // Each card has tiny facets that come round as the view turns, zooms or travels;
  // about half catch the light, and that one flashes like a photo far off: on at once,
  // gone in a moment, however fast the camera goes. After a flash a card rests a few
  // seconds, so a quick turn or zoom glitters only a little busier than the slow drift
  const FLASH_MS = 70;
  const REST_MS = { drift: [2000, 6000], moved: [1000, 3500] };
  const hash = (n) => {
    const x = Math.sin(n * 91.345) * 47453.5453;
    return x - Math.floor(x);
  };
  function trackGlitter(time) {
    let lit = false;
    for (const g of glitter) {
      const p = g.i * 3;
      const v = [positions[p] - cam.eye[0], positions[p + 1] - cam.eye[1], positions[p + 2] - cam.eye[2]];
      const len = Math.hypot(...v) || 1e-6;
      const seed = (g.i * 2.399963) % 6.2832;
      const a = [Math.sin(seed * 3.1), Math.cos(seed * 5.7), Math.sin(seed * 1.3 + 1)];
      const facet = Math.floor(
        ((v[0] * a[0] + v[1] * a[1] + v[2] * a[2]) / len) * 24 +
          ((v[0] * a[2] - v[2] * a[0]) / len) * 15 +
          Math.log(len) * 6,
      );
      if (g.cell !== null && facet !== g.cell && time - g.at > g.rest && hash(facet + seed) < 0.5) {
        g.at = time;
        const [lo, hi] = idle ? REST_MS.drift : REST_MS.moved;
        g.rest = lo + Math.random() * (hi - lo);
        g.turn = hash(facet * 3.7 + seed) * Math.PI * 0.5;
      }
      g.cell = facet;
      const flash = Math.exp(-(time - g.at) / FLASH_MS);
      const next = flash > 0.02 ? flash : 0;
      if (next !== g.flash) draw.star(g.i, next);
      g.flash = next;
      lit ||= next > 0;
    }
    return lit;
  }
  Promise.all([loadAdoptions(), getList("default")]).then(([adopted, all]) => {
    const names = new Map([...slugsOf(all.items)].map(([name, slug]) => [slug, name]));
    adoptedNames = new Set(
      Object.entries(adopted)
        .filter(([, a]) => a.amount >= 5)
        .map(([slug]) => names.get(slug)),
    );
    markStars();
  });

  const view = { w: 1, h: 1 };
  let dpr = 1;
  const cam = {
    target: [0, 0, 0],
    yaw: Math.random() * Math.PI * 2,
    pitch: 0.32,
    dist: START_DIST,
  };

  // away from the whole view: the button back to it shows
  let away = false;
  function setAway(on) {
    if (on === away) return;
    away = on;
    root.classList.toggle("is-away", on);
  }

  function update() {
    cam.center = middleOf(model);
    // over the top and on: past a pole the world's up turns over with the camera
    cam.pitch = wrap(cam.pitch);
    cam.dist = clamp(cam.dist, MIN_DIST, MAX_DIST);
    let cp = Math.cos(cam.pitch);
    if (Math.abs(cp) < 1e-4) cp = cp < 0 ? -1e-4 : 1e-4;
    const back = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
    cam.eye = add(cam.target, scale(back, cam.dist));
    cam.fwd = scale(back, -1);
    cam.right = norm(cross(cam.fwd, [0, cp < 0 ? -1 : 1, 0]));
    cam.up = cross(cam.right, cam.fwd);
    cam.fpx = view.h / 2 / Math.tan(FOV / 2); // in CSS px
  }

  // x, y in CSS px; z depth; s px per world unit
  function project(p) {
    const v = sub(p, cam.eye);
    const z = dot(v, cam.fwd);
    const s = cam.fpx / z;
    return { x: view.w / 2 + dot(v, cam.right) * s, y: view.h / 2 - dot(v, cam.up) * s, z, s };
  }

  // margin: also the cards this share of the view beyond its edges, about to come in
  // at: only the cards under that point of the screen, for picking one there
  function onScreen(minPx = 0, limit = Infinity, margin = 0, at = null) {
    const out = [];
    const [ex, ey, ez] = cam.eye;
    const [fx, fy, fz] = cam.fwd;
    const [rx, ry, rz] = cam.right;
    const [ux, uy, uz] = cam.up;
    const maxZ = minPx ? (W * cam.fpx) / minPx : FAR;
    const short = Math.min(view.w, view.h);
    // mirrors the shader's clearing around a found card
    let sp = null;
    if (spot?.on) {
      const p = project(posOf(spot.i));
      sp = { i: spot.i, z: p.z, x: p.x, y: p.y, hw: (W / 2) * p.s, hh: (H / 2) * p.s };
    }
    for (let i = 0; i < n; i++) {
      const vx = positions[i * 3] - ex;
      const vy = positions[i * 3 + 1] - ey;
      const vz = positions[i * 3 + 2] - ez;
      const z = vx * fx + vy * fy + vz * fz;
      if (z < NEAR || z > maxZ) continue;
      const s = cam.fpx / z;
      const x = view.w / 2 + (vx * rx + vy * ry + vz * rz) * s;
      const y = view.h / 2 - (vx * ux + vy * uy + vz * uz) * s;
      const hw = (W / 2) * s;
      const hh = (H / 2) * s;
      if (at && (Math.abs(at[0] - x) > hw || Math.abs(at[1] - y) > hh)) continue;
      if (sp && i !== sp.i && z < sp.z && Math.abs(x - sp.x) < hw + sp.hw && Math.abs(y - sp.y) < hh + sp.hh) continue;
      const mx = view.w * margin;
      const my = view.h * margin;
      if (x + hw < -mx || x - hw > view.w + mx || y + hh < -my || y - hh > view.h + my) continue;
      const near = i === sp?.i ? 1 : nearAlpha(i, (W * s) / short);
      out.push({ i, z, x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh, s, near });
    }
    out.sort((a, b) => a.z - b.z);
    return out.length > limit ? out.slice(0, limit) : out;
  }

  // a card that grows past NEAR_AT fades out over NEAR_MS, and back in once it's smaller again,
  // so a camera that stops halfway never leaves one half there
  let gone = new Set();
  const fading = new Map();
  let nearNow = 0;
  const nearIds = new Int32Array(NEAR_SLOTS);
  const nearAlphas = new Float32Array(NEAR_SLOTS);
  function nearAlpha(i, fill) {
    const f = fading.get(i);
    if (!f) return fill > NEAR_AT ? 0 : 1;
    return f.from + (f.to - f.from) * easeInOut(clamp((nearNow - f.t0) / NEAR_MS, 0, 1));
  }
  function trackNear(time) {
    nearNow = time;
    const short = Math.min(view.w, view.h);
    const keep = opening?.i ?? (spot?.on ? spot.i : -1);
    const now = new Set();
    for (const c of onScreen(short * NEAR_AT)) if (c.i !== keep) now.add(c.i);
    for (const [i, f] of fading) if (time - f.t0 >= NEAR_MS) fading.delete(i);
    const start = (i, to) => {
      const f = fading.get(i);
      const at = f ? f.from + (f.to - f.from) * easeInOut(clamp((time - f.t0) / NEAR_MS, 0, 1)) : 1 - to;
      fading.set(i, { from: at, to, t0: time });
    };
    for (const i of now) if (!gone.has(i)) start(i, 0);
    for (const i of gone) if (!now.has(i)) start(i, 1);
    gone = now;
    nearIds.fill(-1);
    let k = 0;
    for (const [i] of fading) {
      if (k >= NEAR_SLOTS) break;
      nearIds[k] = i;
      nearAlphas[k++] = nearAlpha(i, 0);
    }
    draw.near(NEAR_AT, nearIds, nearAlphas);
    return fading.size > 0;
  }

  // the cards with a name to show grow their strip, the others fold it away
  const showing = new Set();
  const stripAnim = new Map();
  let hoverI = -1;
  // which card the others make way for, and how far they have
  const clearing = { i: -1, v: 0, from: 0 };
  function trackHoverClear(time, dt) {
    const want = hoverI >= 0 && !opening && !spot && cellsMix <= 0.5 && !rushing ? hoverI : -1;
    const was = clearing.v;
    if (clearing.i !== want) {
      // the last one's cards come back first
      clearing.v = Math.max(0, clearing.v - (2 * dt) / HOVER_MS);
      if (clearing.v === 0) Object.assign(clearing, { i: want, from: time + HOVER_WAIT });
    } else if (want >= 0 && time >= clearing.from) clearing.v = Math.min(1, clearing.v + dt / HOVER_MS);
    if (reduceMotion) clearing.v = clearing.i === want && want >= 0 ? 1 : 0;
    if (clearing.i >= 0) draw.hover(clearing.i, posOf(clearing.i), easeInOut(clearing.v));
    else draw.hover(-1, null, 0);
    return clearing.v !== was || (clearing.i >= 0 && clearing.v < 1) || clearing.i !== want;
  }
  let lastEye = null;
  let lastFwd = null;
  let calmSince = 0;
  let rushing = false;
  function trackSpeed(time, dt) {
    if (lastEye && dt > 0) {
      const move = Math.hypot(...sub(cam.eye, lastEye)) / Math.max(cam.dist, MIN_DIST);
      const turn = Math.acos(clamp(dot(cam.fwd, lastFwd), -1, 1));
      if (((move + turn) * 1000) / dt > RUSH) {
        rushing = true;
        calmSince = time;
      } else if (rushing && time - calmSince > CALM_MS) rushing = false;
    }
    lastEye = cam.eye;
    lastFwd = cam.fwd;
  }
  // in pixel art the drawings speak for themselves: one name only, the card under the pointer's,
  // or else the one nearest the middle
  function pixelNames(ready) {
    if (!pixelArt.on) return ready;
    if (hoverI >= 0 && ready.has(hoverI)) return new Set([hoverI]);
    let middle = -1;
    let best = Infinity;
    for (const i of ready) {
      const p = project(posOf(i));
      const d = Math.hypot(p.x - view.w / 2, p.y - view.h / 2);
      if (d < best) [best, middle] = [d, i];
    }
    return new Set(middle >= 0 ? [middle] : []);
  }
  let stripsOf = draw;
  function trackStrips(time, ready) {
    if (stripsOf !== draw) {
      showing.clear();
      stripAnim.clear();
      stripsOf = draw;
    }
    const strips = draw.strips;
    const fromMiddle = (i) => {
      const p = project(posOf(i));
      return Math.min(1, Math.hypot(p.x - view.w / 2, p.y - view.h / 2) / Math.hypot(view.w / 2, view.h / 2));
    };
    const aim = (i, to) => {
      const a = stripAnim.get(i);
      if (a ? a.to === to : strips[i] === to) return;
      const wait = to === 1 && !reduceMotion ? fromMiddle(i) * STRIP_SPREAD_MS : 0;
      stripAnim.set(i, { from: strips[i], to, t0: time + wait });
    };
    for (const i of ready) {
      aim(i, 1);
      showing.add(i);
    }
    for (const i of showing) if (!ready.has(i)) aim(i, 0);
    if (!stripAnim.size) return false;
    for (const [i, a] of stripAnim) {
      const k = reduceMotion ? 1 : clamp((time - a.t0) / STRIP_MS, 0, 1);
      strips[i] = a.from + (a.to - a.from) * easeInOut(k);
      if (k < 1) continue;
      stripAnim.delete(i);
      if (a.to === 0) showing.delete(i);
    }
    draw.uploadStrips();
    return true;
  }

  // in pixel art only the drawing itself takes the mouse, not the empty square around it
  const drawnAt = (i, u, v) => pixelArt.k <= 0.5 || pixelArt.covers(i, u, v);

  function cardAt(sx, sy) {
    if (spot?.on) {
      const b = drawnBox(spot.i);
      if (Math.abs(sx - b.x) <= b.w / 2 && Math.abs(sy - b.y) <= (b.w * H) / W / 2) return spot.i;
    }
    if (cellsMix > 0.5) return cellAt(sx, sy);
    // the hovered card keeps the mouse while the cards in front of it are away
    if (clearing.i >= 0 && clearing.v > 0) {
      const p = project(posOf(clearing.i));
      const top = p.y - (H / 2) * p.s;
      const bottom = pixelArt.k > 0.5 ? top + W * p.s : p.y + (H / 2) * p.s;
      const left = p.x - (W / 2) * p.s;
      if (
        sx >= left &&
        sx <= left + W * p.s &&
        sy >= top &&
        sy <= bottom &&
        drawnAt(clearing.i, (sx - left) / (W * p.s), (sy - top) / (W * p.s))
      )
        return clearing.i;
    }
    // nor do the cards cleared away in front of it, as the shader clears them
    const h = clearing.i >= 0 && clearing.v > 0.5 ? project(posOf(clearing.i)) : null;
    const [rw, rh] = pixelArt.k > 0.5 ? [W * 0.6, W * 0.6] : [W, H];
    const cleared = (c) =>
      h &&
      c.i !== clearing.i &&
      c.z < h.z &&
      Math.abs((c.x0 + c.x1) / 2 - h.x) < (rw / 2) * (c.s + h.s) &&
      Math.abs((c.y0 + c.y1) / 2 - h.y) < (rh / 2) * (c.s + h.s);
    for (const c of onScreen(0, Infinity, 0, [sx, sy])) {
      // in pixel art a card is only its drawing, the square at its top
      const y1 = pixelArt.k > 0.5 ? c.y0 + W * c.s : c.y1;
      if (
        c.near > 0.5 &&
        sx >= c.x0 &&
        sx <= c.x1 &&
        sy >= c.y0 &&
        sy <= y1 &&
        !cleared(c) &&
        drawnAt(c.i, (sx - c.x0) / (c.x1 - c.x0), (sy - c.y0) / (W * c.s))
      )
        return c.i;
    }
    return -1;
  }

  let queued = false;
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
  };

  let anim = null;
  let morph = null;
  let bang = null;
  let listShift = null;
  let leaving = null;
  let opening = null;
  const keys = createKeys({
    listMenu: (e) => listMenuKeys(e),
    views: (e) => views.keys(e),
    get search() {
      return searchBox;
    },
    busy: () => busy,
    escapeMenu: () => {
      if (!menuOpen() || !listMenu.hidden) return false;
      toggleMenu(false);
      menuButton.focus();
      return true;
    },
    list: azList,
    space: {
      flying: () => {
        walking = true;
        // the mouse looks round, no button held, the pointer hidden till Esc, a click or the wheel
        if (!looking()) canvas.requestPointerLock?.()?.catch(() => {});
        tip.hidden = true;
        anim = null;
        stopIdle();
        dropSpot();
        setAway(true);
        request();
      },
      zoom: (factor) => step(factor)(),
      home: () => goHome(),
      toSearch: () => search.focus(),
    },
  });
  const held = keys.held;
  // From the first fly key on, the view is flown as in a game: it turns about the camera, not
  // the point it looks at, and goes where it looks at one speed for the whole shape; the
  // wheel (or going home) hands it back to the orbit
  let walking = false;
  const looking = () => document.pointerLockElement === canvas;
  // the first move once locked can carry the pointer's own jump to the middle: from where it was
  let lookFrom = false;
  document.addEventListener("pointerlockchange", () => {
    lookFrom = looking();
    if (!lookFrom) stopWalking();
  });
  // the orbit again, round the point straight ahead as deep as the shape's middle, so the
  // view itself doesn't move
  function stopWalking() {
    if (looking()) document.exitPointerLock();
    if (!walking) return;
    walking = false;
    const { lo, hi } = boundsOf(model);
    const deep = clamp(dot(sub(scale(add(lo, hi), 0.5), cam.eye), cam.fwd), MIN_DIST * 4, MAX_DIST);
    cam.target = add(cam.eye, scale(cam.fwd, deep));
    cam.dist = deep;
  }
  // per 16 ms a key is held, fed into the same eased motion as the mouse
  function fly(dt) {
    const k = dt / 16;
    const { lo, hi } = boundsOf(model);
    const v = Math.hypot(...sub(hi, lo)) * 0.0025 * k;
    const go = (dir, by) => (delta.pan = add(delta.pan, scale(dir, by)));
    if (held.has("forward")) go(cam.fwd, v);
    if (held.has("back")) go(cam.fwd, -v);
    if (held.has("left")) go(cam.right, -v);
    if (held.has("right")) go(cam.right, v);
    if (held.has("turnLeft")) rotate(-7 * k, 0);
    if (held.has("turnRight")) rotate(7 * k, 0);
    if (held.has("turnUp")) rotate(0, -7 * k);
    if (held.has("turnDown")) rotate(0, 7 * k);
  }
  // pending input, eased out in frame(); zoom is log scale
  const delta = { yaw: 0, pitch: 0, pan: [0, 0, 0], zoom: 0 };
  const moving = () =>
    Math.abs(delta.yaw) + Math.abs(delta.pitch) + Math.abs(delta.zoom) > 1e-5 || Math.hypot(...delta.pan) > 1e-4;
  const stopMoving = () => Object.assign(delta, { yaw: 0, pitch: 0, pan: [0, 0, 0], zoom: 0 });
  let idle = !reduceMotion;
  let lastTime = 0;
  let marked = -1;
  // a found card: drawn in front until the camera moves
  let spot = null;
  let busy = false;

  function frame(time) {
    queued = false;
    const dt = lastTime ? Math.min(48, time - lastTime) : 16;
    lastTime = time;
    pixelArt.lookForDetail(time);

    if (held.size && !busy) fly(dt);
    if (anim?.card) {
      const t = Math.min(1, (time - anim.start) / anim.duration);
      const k = anim.ease(t);
      const w = Math.exp(Math.log(anim.w0) + (Math.log(anim.w1) - Math.log(anim.w0)) * k);
      const z = (W * cam.fpx) / w;
      const sx = anim.sx0 + (anim.sx1 - anim.sx0) * k;
      const sy = anim.sy0 + (anim.sy1 - anim.sy0) * k;
      cam.target = sub(anim.card, add(scale(cam.right, (sx * z) / cam.fpx), scale(cam.up, (sy * z) / cam.fpx)));
      cam.dist = z;
      if (t >= 1) {
        // same view; only the target may differ along the line of sight
        if (anim.final) Object.assign(cam, anim.final);
        const done = anim.done;
        anim = null;
        done?.();
      }
    } else if (anim) {
      const t = Math.min(1, (time - anim.start) / anim.duration);
      // a flight drawing its own path, else straight from one view to the other
      if (anim.at) Object.assign(cam, anim.at(t));
      else {
        const k = anim.ease(t);
        cam.target = lerp3(anim.from.target, anim.to.target, k);
        cam.dist = Math.exp(Math.log(anim.from.dist) + (Math.log(anim.to.dist) - Math.log(anim.from.dist)) * k);
        cam.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * k;
        cam.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * k;
      }
      if (t >= 1) {
        const done = anim.done;
        anim = null;
        done?.();
      }
    } else if (moving()) {
      setAway(true);
      // damped like three.js OrbitControls
      const f = reduceMotion ? 1 : 1 - Math.pow(1 - DAMPING, dt / 16.7);
      const was = cam.target;
      const eye = walking && cam.eye;
      cam.yaw += delta.yaw * f;
      cam.pitch += delta.pitch * f;
      if (eye) {
        update();
        cam.target = add(eye, scale(cam.fwd, cam.dist));
      }
      cam.target = add(cam.target, scale(delta.pan, f));
      if (!walking) zoomBy(Math.exp(delta.zoom * f), was);
      else {
        // the camera kept within half the shape past its sides, nor further than it already was
        const { lo, hi } = boundsOf(model);
        const pad = Math.hypot(...sub(hi, lo)) / 2;
        const at = sub(cam.target, scale(cam.fwd, cam.dist)).map((v, j) =>
          clamp(v, Math.min(lo[j] - pad, eye[j]), Math.max(hi[j] + pad, eye[j])),
        );
        cam.target = add(at, scale(cam.fwd, cam.dist));
      }
      delta.yaw *= 1 - f;
      delta.pitch *= 1 - f;
      delta.pan = scale(delta.pan, 1 - f);
      delta.zoom *= 1 - f;
      if (!moving()) stopMoving();
    } else if (idle) {
      cam.yaw += 0.00006 * dt;
    }

    if (morph) {
      // lighter cards start earlier, so the change ripples
      const t = (time - morph.start) / MORPH_MS;
      const { from, to } = morph;
      for (let i = 0; i < n; i++) {
        const k = ease(clamp(t * 1.35 - items[i].L * 0.35, 0, 1));
        for (let j = i * 3; j < i * 3 + 3; j++) positions[j] = from[j] + (to[j] - from[j]) * k;
      }
      draw.move(positions);
      if (t >= 1) morph = null;
    }

    if (listShift) {
      const t = reduceMotion ? 1 : clamp((time - listShift.start) / LIST_SHIFT_MS, 0, 1);
      const k = easeInOut(t);
      draw.grow(k);
      listShift.leave = 1 - k;
      if (t >= 1) {
        listShift = null;
        leaving?.dispose();
        leaving = null;
      }
    }

    if (bang) {
      const t = (time - bang.start) / BANG_MS;
      draw.bang(clamp(t, 0, 1), bang.center);
      if (t >= 1) {
        const { then } = bang;
        draw.bang(-1);
        bang = null;
        busy = false;
        then?.();
      }
    }

    if (spot && !opening) {
      const k = spot.on ? ease(clamp((time - spot.t) / 500, 0, 1)) : 1 - ease(clamp((time - spot.t) / 350, 0, 1));
      draw.focus(spot.i, posOf(spot.i), 0, 0, k, false);
      if (!spot.on && k <= 0) {
        spot = null;
        draw.focus(-1, null, 0, 0);
      }
    }

    if (opening) {
      const t = time - opening.t0;
      let now;
      if (opening.reverse) {
        const f = opening.from;
        now = {
          clear: f.clear * (1 - part(t, OUT.fade)),
          repel: f.repel * (1 - part(t, OUT.repel)),
          fade: f.fade * (1 - part(t, OUT.fade)),
        };
      } else {
        now = { clear: part(t, IN.clear), repel: part(t, IN.repel), fade: part(t, IN.fade) };
      }
      opening.now = now;
      draw.focus(opening.i, opening.pos, now.repel, now.fade, now.clear, opening.handed);
    }

    update();
    trackSpeed(time, dt);
    const fadingNear = trackNear(time);
    const clearingWay = trackHoverClear(time, dt);
    // while a card opens or comes back, only it keeps its name; the rest fold theirs away, as
    // they do round a found card (its name is its own, over the space) and all the dice's flight
    const stripping = folding
      ? trackStrips(time, new Set())
      : opening
        ? trackStrips(time, pixelArt.on ? new Set() : new Set([opening.i]))
        : spot || anim?.roll
          ? trackStrips(time, new Set())
          : textInGL()
            ? trackStrips(time, pixelNames(texts.ready))
            : false;
    const glittering = trackGlitter(time);
    render(time);
    placeLabels();
    placeMark();
    if (
      time < pixelArt.fadingUntil ||
      anim ||
      moving() ||
      idle ||
      morph ||
      // a page open over the wall hides it whole; a found card is still once it's in
      (opening && !page.isOpen()) ||
      (spot && (!spot.on || time - spot.t < 500)) ||
      azList.fading() ||
      bang ||
      cellsFade ||
      flip ||
      listShift ||
      fadingNear ||
      stripping ||
      rushing ||
      clearingWay ||
      held.size ||
      glittering
    )
      request();
    else lastTime = 0;
  }

  const stopIdle = () => {
    idle = false;
  };

  const pool = [];
  function label(k) {
    if (!pool[k]) {
      const el = document.createElement("div");
      el.className = "wall__label";
      el.innerHTML = '<span class="wall__label-hex"></span><span class="wall__label-name"></span>';
      labels.append(el);
      pool[k] = { el, hex: el.firstChild, name: el.lastChild, i: -1 };
    }
    return pool[k];
  }

  function placeLabels() {
    let used = 0;
    const one = (i) => [{ i, ...boxRect(drawnBox(i)), s: drawnBox(i).w / W }].filter((c) => c.x1 - c.x0 > 36);
    const near =
      azList.mix() > 0
        ? []
        : opening
          ? opening.handed
            ? []
            : one(opening.i)
          : cellsMix > 0.5
            ? spot?.on
              ? one(spot.i)
              : []
            : textInGL()
              ? []
              : onScreen(LABEL_PX, MAX_LABELS * 3);
    const covers = [];
    for (const c of near) {
      const top = c.y0 + W * c.s;
      const w = c.x1 - c.x0;
      // a nearer card over the right end of the strip only cuts the name short;
      // one over just a corner of it lets the name show on top
      let clip = c.x1;
      let covered = 0;
      for (const r of covers) {
        if (r.x0 >= c.x1 || r.x1 <= c.x0 || r.y0 >= c.y1 || r.y1 <= top) continue;
        if (r.x0 > c.x0 + w * 0.6 && r.y0 <= top && r.y1 >= c.y1) clip = Math.min(clip, r.x0);
        else covered += (Math.min(r.x1, c.x1) - Math.max(r.x0, c.x0)) * (Math.min(r.y1, c.y1) - Math.max(r.y0, top));
      }
      const hidden = covered > LABEL_COVERED * w * (c.y1 - top);
      // a card dissolving near the camera no longer hides the names behind it
      if ((c.near ?? 1) > 0.5) covers.push(c);
      if (hidden || used >= MAX_LABELS || c.near === 0) continue;
      if (c.i !== spot?.i && c.i !== opening?.i && draw.strips[c.i] < 0.99) continue;
      const l = label(used++);
      if (l.i !== c.i) {
        l.i = c.i;
        l.hex.textContent = items[c.i].hex;
        l.name.textContent = items[c.i].name;
      }
      l.el.style.clipPath = clip < c.x1 ? `inset(0 ${c.x1 - clip}px 0 0)` : "";
      l.el.style.transform = `translate(${c.x0}px, ${top}px)`;
      l.el.style.width = `${w}px`;
      l.el.style.fontSize = `${w * 0.205}px`;
      l.el.style.zIndex = String(MAX_LABELS - used);
      l.el.style.opacity = c.near < 1 ? String(c.near) : "";
      l.el.hidden = false;
    }
    for (let k = used; k < pool.length && !pool[k].el.hidden; k++) pool[k].el.hidden = true;
  }

  function dropSpot() {
    if (!spot?.on) return;
    spot = { ...spot, on: false, t: performance.now() };
    marked = -1;
    mark.hidden = true;
    request();
  }

  const boxRect = (b) => ({
    x0: b.x - b.w / 2,
    x1: b.x + b.w / 2,
    y0: b.y - (b.w * H) / W / 2,
    y1: b.y + (b.w * H) / W / 2,
  });

  function placeMark() {
    if (marked < 0) return;
    const p = project(posOf(marked));
    if (p.z < NEAR) {
      mark.hidden = true;
      return;
    }
    mark.hidden = false;
    mark.style.transform = `translate(${p.x - (W / 2) * p.s}px, ${p.y - (H / 2) * p.s}px)`;
    mark.style.width = `${W * p.s}px`;
    mark.style.height = `${H * p.s}px`;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.w = rect.width;
    view.h = rect.height;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    update();
    request();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // a found card is only kept by focusCard, which marks it once its flight is set
  function flyTo(to, duration = 1100, done, easing = ease) {
    dropSpot();
    setAway(!to.home);
    stopMoving();
    stopIdle();
    const { home: _home, ...dest } = to;
    const target = { target: cam.target, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch, ...dest };
    // turn the short way round
    target.yaw = cam.yaw + ((((target.yaw - cam.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    target.pitch = cam.pitch + wrap(target.pitch - cam.pitch);
    if (reduceMotion || !duration) {
      Object.assign(cam, target);
      request();
      done?.();
      return;
    }
    anim = {
      from: { target: cam.target, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch },
      to: target,
      start: performance.now(),
      duration,
      done,
      ease: easing,
    };
    request();
  }

  function zoomInto(i, w, duration, easing = easeInOut) {
    stopMoving();
    stopIdle();
    const card = posOf(i);
    const p = project(card);
    if (reduceMotion || !duration || !(p.z > 0)) {
      Object.assign(cam, { target: card, dist: distFor(w) });
      update();
      request();
      return;
    }
    anim = {
      card,
      sx0: p.x - view.w / 2,
      sy0: view.h / 2 - p.y,
      w0: W * p.s,
      sx1: 0,
      sy1: 0,
      w1: w,
      start: performance.now(),
      duration,
      ease: easing,
    };
    request();
  }

  function zoomOutOf(i, to, duration, done, easing = easeInOut) {
    stopMoving();
    stopIdle();
    const card = posOf(i);
    const now = project(card);
    const keep = { ...cam };
    Object.assign(cam, to);
    update();
    const end = project(card);
    Object.assign(cam, keep);
    update();
    if (reduceMotion || !duration) {
      Object.assign(cam, to);
      request();
      done?.();
      return;
    }
    if (!(end.z > NEAR) || !(now.z > NEAR)) return flyTo(to, duration, done, easing);
    anim = {
      card,
      sx0: now.x - view.w / 2,
      sy0: view.h / 2 - now.y,
      w0: W * now.s,
      sx1: end.x - view.w / 2,
      sy1: view.h / 2 - end.y,
      w1: W * end.s,
      final: { ...to },
      start: performance.now(),
      duration,
      ease: easing,
      done,
    };
    request();
  }

  const distFor = (px) => (W * cam.fpx) / px;

  // under the size where cards dissolve, so a narrow screen keeps it once the camera moves
  const focusDist = () => distFor(Math.min(FOCUS_PX, Math.min(view.w, view.h) * NEAR_AT * 0.8));
  function focusCard(i) {
    flyTo({ target: posOf(i), dist: focusDist() });
    marked = i;
    spot = { i, on: true, t: performance.now() };
  }

  // the dice: one of the Best of names in the list shown, at random; in the A–Z list, scrolled
  // to. In the space, thrown: three turns round and one over, fast at first and slowing till it
  // rests on the card; meanwhile out to the whole of it quickly, then a long way in, slowly
  // through the bulk of the colors, the turning bending the way in into an arc. Once a roll
  // waits on the Best of names, and its flight is marked as the dice's
  let rolling = false;
  // the Best of list comes out of the full one, so it's there at once (names.js)
  const bestOfNames = () =>
    getList("bestOf").then(
      (list) => new Set(list.items.map((it) => it.name)),
      () => new Set(),
    );
  async function roll() {
    if (busy || rolling || anim?.roll || page.isOpen()) return;
    rolling = true;
    const best = await bestOfNames();
    rolling = false;
    const pool = items.flatMap((it, i) => (best.has(it.name) ? [i] : []));
    const i = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * items.length);
    const it = items[i];
    searchBox.clearResults();
    if (azList.on()) {
      choose(it.hex, "");
      return azList.az()?.reveal(it.name);
    }
    choose(it.hex, it.name);
    if (reduceMotion) return focusCard(i);
    dropSpot();
    setAway(true);
    stopMoving();
    stopIdle();
    const from = { target: cam.target, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch };
    const top = home();
    const card = posOf(i);
    const near = focusDist();
    const yaws = ROLL.turns * 2 * Math.PI;
    const pitches = ROLL.flips * 2 * Math.PI + wrap(top.pitch - from.pitch);
    const far = (a, b, k) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
    anim = {
      roll: true,
      start: performance.now(),
      duration: ROLL.ms,
      at(t) {
        const k = 1 - Math.pow(1 - t, 3);
        const turned = { yaw: from.yaw + yaws * k, pitch: from.pitch + pitches * k };
        if (t < ROLL.out) {
          const u = ease(t / ROLL.out);
          return { ...turned, target: lerp3(from.target, top.target, u), dist: far(from.dist, top.dist, u) };
        }
        const u = cruise((t - ROLL.out) / (1 - ROLL.out), ROLL.speedUp, ROLL.slowDown);
        return { ...turned, target: lerp3(top.target, card, u), dist: far(top.dist, near, u) };
      },
      // found once it has come to rest on it, not on the way
      done: () => {
        marked = i;
        spot = { i, on: true, t: performance.now() };
        request();
      },
    };
    request();
  }

  // measured on a hidden copy, so it follows the color page's own CSS
  function slotOf(place) {
    // same layer as the color page, so the scrollbar width matches
    const probe = document.createElement("div");
    probe.className = "wall__page wall__probe";
    probe.innerHTML = `<section class="slide hero color-hero"><div class="color-hero__card">${CARD_HTML}</div></section>`;
    const slot = probe.querySelector(".color-hero__card");
    slot.style.cssText = `--x:${place.x};--y:${place.y};--r:0deg`;
    document.body.append(probe);
    const b = slot.getBoundingClientRect();
    probe.remove();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
  }

  const sizeCard = (card, w) => {
    card.style.inlineSize = `${w}px`;
    card.style.fontSize = `${w * 0.205}px`;
  };

  // in pixel art the copy is the drawing alone, as the space shows it; the card builds up
  // under it once on the color's page
  function makeCopy(hex, name, w, pixel, painted = false) {
    const copy = document.createElement("div");
    copy.className = pixel && !painted ? "wall__handoff is-pixel" : "wall__handoff";
    copy.innerHTML = CARD_HTML;
    const card = copy.firstElementChild;
    card.style.cssText = `--c-color:${hex};--c-shade0:${hex};--c-shade1:${hex}`;
    card.querySelector(".swatchcard__row1").textContent = hex;
    card.querySelector(".swatchcard__row2").textContent = name;
    if (pixel)
      card.querySelector(".swatchcard__upper").append(
        Object.assign(document.createElement("img"), {
          className: "swatchcard__pixel swatchcard__pixel--now",
          src: pixel.src,
          alt: "",
        }),
      );
    sizeCard(card, w);
    return { copy, card };
  }
  // a picture loaded, so it shows the moment it's on the page; never longer than a moment and
  // a half (decode() of one not yet on the page can stay pending, so it's load we wait for)
  const drawable = (img) =>
    img &&
    !(img.complete && img.naturalWidth) &&
    Promise.race([
      new Promise((done) => {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }),
      new Promise((done) => setTimeout(done, 1500)),
    ]);
  const pixelOf = (i) =>
    !pixelArt.on || !pixelArt.slots
      ? null
      : pixelArt.slots[i] >= 0
        ? { src: pixelArt.index.tileURL(pixelArt.slots[i]), slug: pixelArt.index.slugs[pixelArt.slots[i]] }
        : pixelArt.slots[i] === NOT_DRAWN
          ? { src: blankURL(items[i].hex), slug: pixelArt.names?.get(items[i].name) }
          : null;

  function placeCopy({ copy, card }, box, r = 0) {
    copy.style.transform = `translate(${box.x - box.w / 2}px, ${box.y - (box.w * H) / W / 2}px) rotate(${r}deg)`;
    sizeCard(card, box.w);
  }

  // Glide a copy to a box, tilting to r; resolves once it has arrived:
  // on the transition's own end, since a transition only starts with the
  // next frame and a timer would cut it short. The timer is only a fallback.
  function glide(c, box, r, ms) {
    if (reduceMotion) {
      placeCopy(c, box, r);
      return Promise.resolve();
    }
    c.copy.classList.add("is-travelling");
    void c.copy.offsetWidth;
    placeCopy(c, box, r);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(fallback);
        c.copy.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e) => e.target === c.copy && e.propertyName === "transform" && done();
      const fallback = setTimeout(done, ms + 600);
      c.copy.addEventListener("transitionend", onEnd);
    });
  }

  function drawnBox(i) {
    const p = project(posOf(i));
    return { x: p.x, y: p.y, w: W * p.s };
  }

  const pageCardWidth = () => clamp(view.w * 0.21, 208, 384);

  let pending = null;
  // in pixel art a card's name folds away before it opens, so the drawing goes on its own
  let folding = false;
  function open(i, folded = false) {
    if (busy) return;
    if (pixelArt.on && !folded && draw.strips[i] > 0.01) {
      busy = folding = true;
      tip.hidden = true;
      request();
      setTimeout(
        () => {
          busy = folding = false;
          open(i, true);
        },
        reduceMotion ? 0 : STRIP_MS + 40,
      );
      return;
    }
    busy = true;
    marked = -1;
    mark.hidden = true;
    tip.hidden = true;
    const it = items[i];
    const before = saveable();
    const task = (pending = { i, before, c: null, cancelled: false });
    spot = null;
    page.enter(it);

    root.classList.add("is-opening");
    page.away(true);
    opening = { i, pos: posOf(i), t0: performance.now(), handed: false };
    zoomInto(i, pageCardWidth(), IN.fly);

    later(IN.glide, async () => {
      if (task.cancelled) return;
      const pixel = pixelOf(i);
      const c = (task.c = makeCopy(it.hex, it.name, 0, pixel));
      // its drawing loaded before it takes over from the space's, so nothing blinks: on the
      // page but unseen meanwhile, as a picture off the page may not load at all
      placeCopy(c, drawnBox(i));
      if (pixel) {
        c.copy.style.visibility = "hidden";
        root.append(c.copy);
        await drawable(c.card.querySelector(".swatchcard__pixel"));
        if (task.cancelled) return c.copy.remove();
        placeCopy(c, drawnBox(i));
        c.copy.style.visibility = "";
      } else root.append(c.copy);
      opening.handed = true;
      request();
      const place = cardPlace();
      await glide(c, slotOf(place), place.r, IN.travel);
      if (task.cancelled) return;
      try {
        sessionStorage.setItem("card-handoff", JSON.stringify({ hex: it.hex, name: it.name, place, pixel }));
        sessionStorage.setItem("wall-camera", JSON.stringify(before));
      } catch {}
      try {
        await page.show(it.hex, before, c.copy, task);
      } catch (e) {
        // the address is already the color page's, so load it on its own
        console.error(e);
        location.reload();
      }
    });
  }

  const later = (ms, fn) => setTimeout(fn, reduceMotion ? 0 : ms);
  // how long a card back from its page takes to shed its color, in pixel art
  const SHED_MS = 280;

  const page = createPage(root, {
    nameOf: (hex) => items[nearest(hex)],
    drawable: (img) => drawable(img),
    shown: () => (pending = null),
    onClose: () => history.go(-page.depth()),
  });

  // the page taken down, its card flown back to its place in the space, the color it showed last
  function closeColorPage() {
    const { hex, returnTo, card } = page.leave(reduceMotion ? 0 : OUT.leave);
    let i = items.findIndex((it) => it.hex === hex);
    if (i < 0) i = nearest(hex);

    // in pixel art it leaves as a whole card, sheds its color, then flies back as the drawing
    const pixel = pixelOf(i);
    const c = makeCopy(hex, card.name || items[i].name, card.w, pixel, true);
    c.copy.classList.add("is-returning");
    placeCopy(c, card, card.tilt);
    root.append(c.copy);

    anim = null;
    Object.assign(cam, {
      target: posOf(i),
      dist: distFor(pageCardWidth()),
      yaw: returnTo.yaw,
      pitch: returnTo.pitch,
    });
    update();
    returnCard(c, i, returnTo, { repel: 1, fade: 1, clear: 1 });
  }

  async function returnCard(c, i, returnTo, from) {
    opening = { i, pos: posOf(i), reverse: true, t0: performance.now(), handed: true, from };
    request();
    // show the copy in place for a frame before it moves
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // animated here, as the copy's card takes no transitions (swatchcard--reset)
    if (c.card.querySelector(".swatchcard__pixel")) {
      const shed = [...c.card.querySelectorAll(".swatchcard__swatch, .swatchcard__label")].map(
        (el) =>
          el.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: reduceMotion ? 0 : SHED_MS,
            easing: "ease",
            fill: "forwards",
          }).finished,
      );
      await Promise.all(shed).catch(() => {});
      c.copy.classList.add("is-pixel");
    }
    await glide(c, drawnBox(i), 0, OUT.travel);
    c.copy.remove();
    opening.handed = false;
    zoomOutOf(i, returnTo, OUT.fly, resetOpening);
  }

  function cancelOpening() {
    const task = pending;
    pending = null;
    task.cancelled = true;
    const from = opening?.now || { repel: 0, fade: 0, clear: 0 };
    anim = null;
    // a copy only flies back once it's shown: in pixel art it waits, hidden, for its drawing,
    // and gliding it then would leave nothing to see on the way
    if (task.c && opening?.handed) {
      returnCard(task.c, task.i, task.before, from);
    } else {
      task.c?.copy.remove();
      opening = {
        i: task.i,
        pos: posOf(task.i),
        reverse: true,
        t0: performance.now() - OUT.fade[0],
        handed: false,
        from,
      };
      flyTo(task.before, reduceMotion ? 0 : OUT.fly, resetOpening, easeInOut);
    }
  }

  function resetOpening() {
    busy = false;
    opening = null;
    root.classList.remove("is-opening");
    page.away(false);
    draw.focus(-1, null, 0, 0);
    labels.hidden = false;
    root.querySelectorAll(".wall__handoff").forEach((el) => el.remove());
    request();
  }

  addEventListener("popstate", () => {
    const onColor = /\/color\/([^/]+\/)?$/.test(location.pathname);
    if (pending && !onColor) cancelOpening();
    else if (page.isOpen() && !onColor) closeColorPage();
    // forward into a color page that's no longer open: load it
    else if (!page.isOpen() && !pending && onColor) location.reload();
  });

  // back from bfcache
  addEventListener("pageshow", (e) => {
    if (e.persisted && !page.isOpen()) resetOpening();
  });

  const pointers = new Map();
  let press = null;
  let pinch = null;

  // a full screen height of drag is a full turn
  function rotate(dx, dy) {
    // upside down, a drag to the right still turns the view to the right
    delta.yaw -= ((Math.cos(cam.pitch) < 0 ? -1 : 1) * 2 * Math.PI * dx) / view.h;
    delta.pitch += (2 * Math.PI * dy) / view.h;
  }

  function pan(dx, dy) {
    const k = cam.dist / cam.fpx;
    delta.pan = add(delta.pan, add(scale(cam.right, -dx * k), scale(cam.up, dy * k)));
  }

  const zoom = (logFactor) => {
    delta.zoom += logFactor;
  };
  // toward the middle of the view; at the closest the camera orbits from, it flies on
  // through instead of stopping. was: the point it orbits before this frame's moves
  function zoomBy(k, was) {
    const kk = clamp(k, MIN_DIST / cam.dist, MAX_DIST / cam.dist);
    cam.dist *= kk;
    if (k < kk) cam.target = add(cam.target, scale(cam.fwd, -Math.log(k / kk) * THROUGH));
    // never further out than a little past the shape, nor than it already was
    const { lo, hi } = boundsOf(model);
    cam.target = cam.target.map((v, j) => clamp(v, Math.min(lo[j] - 20, was[j]), Math.max(hi[j] + 20, was[j])));
  }

  function home(key = model) {
    const p = placeAll(key);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], p[i]);
      hi[i % 3] = Math.max(hi[i % 3], p[i]);
    }
    const radius = Math.hypot(...sub(hi, lo)) / 2;
    const half = Math.min(FOV / 2, Math.atan(Math.tan(FOV / 2) * (view.w / view.h)));
    const dist = clamp((radius / Math.sin(half)) * 0.92, MIN_DIST * 10, MAX_DIST);
    return { target: scale(add(lo, hi), 0.5), dist, pitch: 0.32, home: true };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (busy) return;
    if (looking()) return stopWalking();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anim = null;
    stopIdle();
    tip.hidden = true;
    if (pointers.size === 1) {
      press = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        moved: false,
        pan: e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey,
      };
    } else {
      press = null;
      dropSpot();
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    root.classList.add("is-dragging");
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointermove", (e) => {
    if (looking()) {
      const jump = lookFrom || Math.hypot(e.movementX, e.movementY) > 250;
      lookFrom = false;
      if (!jump) rotate(e.movementX * 0.5, e.movementY * 0.5);
      return request();
    }
    const p = pointers.get(e.pointerId);
    if (!p) return hover(e);
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1 && press) {
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
        press.moved = true;
        dropSpot();
      }
      if (press.pan) pan(dx, dy);
      else rotate(dx, dy);
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      pan(mx - pinch.x, my - pinch.y);
      zoom(Math.log(pinch.d / d));
      Object.assign(pinch, { d, x: mx, y: my });
    }
    request();
  });

  function release(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) return;
    root.classList.remove("is-dragging");
    pinch = null;
    request(); // a last, sharp frame of the cells
    if (press && !press.moved && performance.now() - press.t < 500 && e.type === "pointerup") {
      const rect = canvas.getBoundingClientRect();
      const i = cardAt(e.clientX - rect.left, e.clientY - rect.top);
      if (i >= 0) open(i);
    }
    press = null;
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  let hoverQueued = null;
  function hover(e) {
    if (e.pointerType !== "mouse" || busy) return;
    if (!hoverQueued) requestAnimationFrame(showTip);
    hoverQueued = e;
  }
  function showTip() {
    const e = hoverQueued;
    hoverQueued = null;
    // a click may have opened a card since the move was queued
    if (busy) {
      hoverI = -1;
      tip.hidden = true;
      canvas.style.cursor = "";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const i = cardAt(sx, sy);
    const hit = i < 0 ? null : { i, ...boxRect(drawnBox(i)) };
    canvas.style.cursor = hit ? "pointer" : "";
    // the card under the mouse shows its strip and name, however small
    if ((hit?.i ?? -1) !== hoverI) {
      hoverI = hit?.i ?? -1;
      request();
    }
    if (!hit || (cellsMix <= 0.5 && hit.x1 - hit.x0 >= LABEL_PX)) {
      tip.hidden = true;
      return;
    }
    const dot = document.createElement("i");
    dot.className = "wall__tip-dot";
    dot.style.background = items[hit.i].hex;
    tip.replaceChildren(dot, items[hit.i].name);
    tip.style.transform = `translate(${sx}px, ${sy}px)`;
    tip.hidden = pixelArt.on;
  }
  canvas.addEventListener("pointerleave", () => {
    tip.hidden = true;
    hoverI = -1;
    request();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (busy) return;
      anim = null;
      stopIdle();
      dropSpot();
      tip.hidden = true;
      stopWalking();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      zoom(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      request();
    },
    { passive: false },
  );

  // Safari's own pinch events, so the page itself never zooms
  root.addEventListener("gesturestart", (e) => e.preventDefault());

  const step = (factor) => () => {
    if (busy) return;
    flyTo({ dist: clamp(cam.dist * factor, MIN_DIST, MAX_DIST) }, 420);
  };
  // home, by any way there, and turning again once it arrives, as when the page opens
  const goHome = () => {
    if (busy) return;
    stopWalking();
    flyTo(home(), 1000, () => {
      idle = !reduceMotion;
      request();
    });
  };

  q(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    if (page.isOpen()) history.go(-page.depth());
    // from the list, back to the space as it was last shown
    else if (azList.on()) leaveList();
    else goHome();
  });
  q("[data-home]").addEventListener("click", () => (azList.on() ? leaveList() : goHome()));
  canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (cardAt(e.clientX - rect.left, e.clientY - rect.top) < 0) goHome();
  });

  const cellsData = {};
  const building = {};
  let cellsDraw = null;
  let cellsOn = false;
  let cellsMix = 0;
  let cellsFade = null;
  let cellsModel = model;
  let flip = null;

  const bounds = {};
  function boundsOf(key) {
    if (bounds[key]) return bounds[key];
    const p = placeAll(key);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], p[i]);
      hi[i % 3] = Math.max(hi[i % 3], p[i]);
    }
    return (bounds[key] = { lo: lo.map((v) => v - 6), hi: hi.map((v) => v + 6) });
  }

  // the closer in, the more of the space in front of the target is cut away
  const wholeDist = {};
  function cutDepth() {
    const key = `${cellsModel} ${view.w}×${view.h}`;
    const whole = (wholeDist[key] ??= home(cellsModel).dist);
    return cam.dist * clamp(1 - cam.dist / whole, 0, 0.9);
  }

  const fogRange = () => {
    const mid = Math.hypot(...sub(cam.center, cam.eye));
    return [Math.max(0, mid) + 60, mid + 420];
  };

  function render(time) {
    azList.step(time);
    const azMix = azList.mix();
    if (cellsFade) {
      const k = clamp((time - cellsFade.t0) / 700, 0, 1);
      cellsMix = cellsFade.from + (cellsFade.to - cellsFade.from) * easeInOut(k);
      if (k >= 1) cellsFade = null;
    }
    let flipDim = 0;
    if (flip) {
      const k = clamp((time - flip.t0) / 600, 0, 1);
      flipDim = k < 0.5 ? easeInOut(k * 2) : 1 - easeInOut((k - 0.5) * 2);
      cellsModel = k < 0.5 ? flip.from : flip.to;
      if (k >= 1) flip = null;
    }
    if (!cellsDraw || cellsMix <= 0) {
      draw(cam, dpr, { keepAll: 1 - azMix });
      if (!opening && !morph && !bang && !listShift && azMix <= 0)
        sparkles?.draw(
          cam,
          dpr,
          canvas,
          glitter.filter((g) => g.flash > 0),
          positions,
          colors,
        );
      if (textInGL()) {
        if (textsFor !== draw) {
          texts.reset();
          textsFor = draw;
        }
        // a name stays a little below the size it came at, so it doesn't flicker at the edge
        // a fast camera leaves the names away until it slows down
        const named = rushing
          ? []
          : onScreen(LABEL_PX * 0.85, texts.slots).filter((c) => c.x1 - c.x0 >= LABEL_PX || showing.has(c.i));
        if (hoverI >= 0 && !rushing && cellsMix <= 0.5 && !named.some((c) => c.i === hoverI))
          named.unshift({ i: hoverI });
        texts.draw(
          cam,
          dpr,
          canvas,
          named,
          items,
          positions,
          {
            at: NEAR_AT,
            ids: nearIds,
            alphas: nearAlphas,
            hover: clearing.i >= 0 ? { i: clearing.i, pos: posOf(clearing.i), clear: easeInOut(clearing.v) } : null,
          },
          draw.strips,
        );
      }
      if (leaving) leaving(cam, dpr, { clear: false, keepAll: (listShift?.leave ?? 0) * (1 - azMix) });
      return;
    }
    // lower resolution while anything moves
    const still = !anim && !moving() && !morph && !bang && !cellsFade && !flip && !opening && !pointers.size;
    cellsDraw({
      cam,
      dpr,
      key: cellsModel,
      model: MODEL_IDS[cellsModel],
      bounds: boundsOf(cellsModel),
      cut: cutDepth(),
      dim: Math.max(1 - cellsMix, opening?.now?.fade ?? 0, flipDim, azMix),
      fog: fogRange(),
      scale: Math.min(1, 1.25 / dpr) * (still ? 1 : 0.5),
    });
    const only = opening ? opening.i : spot ? spot.i : -1;
    if (cellsMix < 1) draw(cam, dpr, { clear: false, keepAll: (1 - cellsMix) * (1 - azMix) });
    else if (only >= 0) draw(cam, dpr, { clear: false, only });
  }

  function cellAt(sx, sy) {
    if (!cellsData[cellsModel]) return -1;
    const x = (sx - view.w / 2) / cam.fpx;
    const y = (view.h / 2 - sy) / cam.fpx;
    const dir = norm(add(cam.fwd, add(scale(cam.right, x), scale(cam.up, y))));
    return pickCell(dir, cam.eye, boundsOf(cellsModel), cutDepth(), MODEL_IDS[cellsModel], GEO, cellsData[cellsModel]);
  }

  async function setCells(on) {
    if (busy || on === cellsOn) return;
    cellsOn = on;
    showMode();
    if (on) {
      const ok = await cellsForModel();
      if (ok === null) return;
      if (!ok) {
        cellsOn = false;
        showMode();
        return;
      }
    }
    if (on && !cellsOn) return;
    cellsModel = model;
    cellsFade = { from: cellsMix, to: on ? 1 : 0, t0: performance.now() };
    request();
  }
  const modeNow = () => (pixelMode() ? "pixel" : cellsOn ? "cells" : "colors");
  // what's shown, as one value: the space's own view (colors, cells, pixel), or the list over
  // it. The address says it, but for the colors, the space's default
  const viewNow = () => (azList.on() ? "az" : modeNow());
  const showView = () => writeAddress({ view: viewNow() === "colors" ? null : viewNow() });
  // the one way to change it. Leaving the list is going back to the space's own view, which
  // stays as it was under the list; restore: a page that opens on the list, where it was left
  function setView(next, restore = null) {
    if (next === "az") return azList.set(true, restore);
    if (azList.on()) azList.set(false);
    if (next === modeNow()) return;
    setPixelMode(next === "pixel");
    setCells(next === "cells");
  }
  const leaveList = () => setView(modeNow());
  const views = createViewSwitch(root, {
    now: modeNow,
    picking: () => azList.on() && leaveList(),
    pick: (want) => setView(want),
  });
  function showMode() {
    showView();
    views.show();
  }
  showMode();

  const listButton = q("[data-lists]");
  const listMenu = q("[data-list-menu]");

  function showListChoice() {
    listMenu.querySelectorAll("[data-list]").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.list === listKey));
    });
  }
  function toggleListMenu(open = listMenu.hidden) {
    listMenu.hidden = !open;
    listButton.setAttribute("aria-expanded", String(open));
    if (open) listMenu.querySelector('[aria-checked="true"]')?.focus();
  }
  listButton.addEventListener("click", () => toggleListMenu());
  listMenu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (!b) return;
    toggleListMenu(false);
    setList(b.dataset.list);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!listMenu.hidden && !e.target.closest("[data-list-menu], [data-lists]")) toggleListMenu(false);
  });
  // the list menu's keys: up and down through it, Escape closes it
  function listMenuKeys(e) {
    const all = [...listMenu.querySelectorAll("[data-list]")];
    const k = all.indexOf(document.activeElement);
    if (e.key === "Escape") {
      toggleListMenu(false);
      listButton.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(k + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length].focus();
    }
  }
  showListChoice();

  // on a phone the models, lists and zoom sit behind this button
  const menuButton = q("[data-menu]");
  const menuOpen = () => menuButton.getAttribute("aria-expanded") === "true";
  const toggleMenu = (open = !menuOpen()) => menuButton.setAttribute("aria-expanded", String(open));
  menuButton.addEventListener("click", () => toggleMenu());
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen() && !e.target.closest("[data-menu], .wall__dock, .wall__zoom")) toggleMenu(false);
  });

  async function setList(key) {
    if (busy || key === listKey || !LISTS[key]) return;
    busy = true;
    dropSpot();
    marked = -1;
    mark.hidden = true;
    searchBox.clearResults();
    const before = listKey;
    listKey = key;
    showListChoice();
    // that color may not be on this list
    choose(null, "");

    if (cellsMix > 0) cellsFade = { from: cellsMix, to: 0, t0: performance.now() };
    request();
    const slow = setTimeout(() => {
      status.textContent = `Loading the ${LISTS[key]} list…`;
      status.hidden = false;
    }, 250);
    let next;
    try {
      next = await getList(key);
    } catch {
      next = null;
    }
    clearTimeout(slow);
    if (next) {
      status.hidden = true;
      // the address once it's there: a list that doesn't load leaves the one shown in it
      writeAddress({ list: key === "default" ? null : key });
      const id = (it) => `${it.name}\u0000${it.hex}`;
      const coming = new Set(next.items.map(id));
      const staying = new Set(items.map(id));
      const gone = [];
      items.forEach((it, i) => coming.has(id(it)) || gone.push(i));
      const gonePos = new Float32Array(gone.length * 3);
      const goneCol = new Uint8Array(gone.length * 3);
      gone.forEach((i, k) => {
        gonePos.set(positions.subarray(i * 3, i * 3 + 3), k * 3);
        goneCol.set(colors.subarray(i * 3, i * 3 + 3), k * 3);
      });
      const grow = new Uint8Array(next.items.length);
      next.items.forEach((it, i) => (grow[i] = staying.has(id(it)) ? 0 : 1));
      leaving?.dispose();
      leaving = gone.length ? createRenderer(canvas, gonePos, goneCol, undefined, [W, H]) : null;
      useList(next, grow);
      draw.grow(0);
      listShift = { start: performance.now(), leave: 1 };
    } else {
      status.textContent = `The ${LISTS[key]} list didn’t load. Check your connection.`;
      setTimeout(() => (status.hidden = true), 3000);
      listKey = before;
      showListChoice();
    }

    busy = false;
    if (cellsOn) {
      cellsForModel().then((ok) => {
        if (ok && cellsOn) {
          cellsModel = model;
          cellsFade = { from: cellsMix, to: 1, t0: performance.now() };
          request();
        }
      });
    }
    request();
  }

  function useList(next, grow) {
    list = next;
    items = next.items;
    n = items.length;
    W = CARD_W * cardScale(n);
    H = CARD_H * cardScale(n);
    if (texts) texts.scale = cardScale(n);
    if (sparkles) sparkles.scale = cardScale(n);
    colors = colorsOf(items);
    for (const cache of [placed, middles, bounds, wholeDist, cellsData, building]) {
      for (const k of Object.keys(cache)) delete cache[k];
    }
    positions = placeAll(model).slice();
    morph = null;
    spot = null;
    draw.dispose();
    draw = createRenderer(canvas, positions, colors, grow, [W, H]);
    cellsDraw?.dispose();
    cellsDraw = null;
    cellsMix = 0;
    for (const l of pool) l.i = -1;
    // a card under a resting mouse is the old list's index
    hoverI = -1;
    Object.assign(clearing, { i: -1, v: 0, from: 0 });
    tip.hidden = true;
    showCount();
    markStars();
    pixelArt.restore();
    azList.reopen();
  }

  // true once a model's cells are drawable, false if they can't be; null when the list changed
  // meanwhile, so these were the old list's and whoever switched it builds the new ones
  async function ensureCells(key) {
    if (cellsDraw?.has(key)) return true;
    status.textContent = "Working out each name’s part of the space…";
    status.hidden = false;
    try {
      const renderer = (cellsDraw ??= createCellsRenderer(draw.gl, canvas, colors, GEO));
      const data = await (building[key] ??= buildOwners(placeAll(key), boundsOf(key), CELL_REACH, (k) => {
        status.textContent = `Working out each name’s part of the space… ${Math.round(k * 100)}%`;
      }));
      if (renderer !== cellsDraw) return null;
      if (!renderer.has(key)) renderer.add(key, data);
      cellsData[key] = data;
      status.hidden = true;
      return true;
    } catch (e) {
      console.error(e);
      status.textContent = "The cells couldn’t be drawn in this browser.";
      setTimeout(() => (status.hidden = true), 3000);
      return false;
    }
  }

  // the cells of the model shown, built again if the model changed while they were worked out
  async function cellsForModel() {
    for (;;) {
      const key = model;
      const ok = await ensureCells(key);
      if (!ok || key === model) return ok;
    }
  }

  function setModel(key) {
    if (azList.on()) leaveList();
    if (key === model || !MODELS[key]) return;
    dropSpot();
    // cells can't morph: they dip into the dark and come back reshaped
    if (cellsMix > 0) {
      const from = cellsModel;
      ensureCells(key).then((ok) => {
        if (ok && model === key) {
          flip = { t0: performance.now(), from, to: key };
          request();
        }
      });
    }
    model = key;
    const to = placeAll(key);
    if (reduceMotion) {
      positions.set(to);
      draw.move(positions);
    } else {
      morph = { from: positions.slice(), to, start: performance.now() };
    }
    if (!busy) flyTo(home(), MORPH_MS);
    showModel();
    writeAddress({ model: key });
    request();
  }

  const thumb = document.createElement("span");
  thumb.className = "wall__models-thumb";
  thumb.setAttribute("aria-hidden", "true");
  function showModel() {
    picker.querySelectorAll("[data-model], [data-az]").forEach((b) => {
      const on = azList.on() ? b.hasAttribute("data-az") : b.dataset.model === model;
      b.setAttribute("aria-pressed", String(on));
      if (on) {
        thumb.style.setProperty("--x", `${b.offsetLeft}px`);
        thumb.style.setProperty("--w", `${b.offsetWidth}px`);
        // too narrow for every model: the chosen one in the middle, its neighbors in reach
        if (picker.scrollWidth > picker.clientWidth)
          picker.scrollTo({
            left: b.offsetLeft + b.offsetWidth / 2 - picker.clientWidth / 2,
            behavior: reduceMotion ? "auto" : "smooth",
          });
      }
    });
  }

  picker.replaceChildren(
    thumb,
    ...Object.entries(MODELS).map(([key, m]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.model = key;
      b.textContent = m.label;
      b.addEventListener("click", () => setModel(key));
      return b;
    }),
    Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "A–Z",
      title: "Every name, A to Z",
      onclick: () => setView("az"),
    }),
  );
  picker.lastElementChild.dataset.az = "";
  showModel();
  // fonts loading and the phone layout resize the buttons
  new ResizeObserver(() => {
    showModel();
    showModelEdges();
  }).observe(picker);
  // a fade on each side that has more models to scroll to
  function showModelEdges() {
    const rest = picker.scrollWidth - picker.clientWidth - picker.scrollLeft;
    picker.classList.toggle("has-before", picker.scrollLeft > 1);
    picker.classList.toggle("has-after", rest > 1);
  }
  picker.addEventListener("scroll", showModelEdges, { passive: true });
  // the search as wide as the tabs and the list button under it, from one's left edge to the
  // other's right (CSS, on a wide screen)
  new ResizeObserver(() => {
    const wide = listButton.getBoundingClientRect().right - picker.getBoundingClientRect().left;
    if (wide > 0) document.documentElement.style.setProperty("--dock-w", `${wide}px`);
  }).observe(picker.closest(".wall__dock"));

  function nearest(hex) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    let best = 0;
    let bd = Infinity;
    items.forEach((it, i) => {
      const d = (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  const searchBox = createSearch(root, {
    items: () => items,
    nearest,
    focusCard,
    dropSpot,
    goHome,
    busy: () => busy,
    roll,
    warm: bestOfNames,
    listUp: () => azList.on(),
    list: () => azList.az(),
  });
  const choose = searchBox.choose;

  keys.listen();

  // the brand is under the space, the cards going over it: an unseen clone over the space takes
  // its click and its pointer (CSS); the brand itself stays the one link to tab to and to read
  const brand = q(".wall__brand");
  if (brand) {
    const hit = brand.cloneNode(true);
    hit.classList.replace("wall__brand", "wall__brand-hit");
    hit.setAttribute("aria-hidden", "true");
    hit.tabIndex = -1;
    brand.after(hit);
  }
  // the GitHub link the other way round: it stays in the bar, unseen till pointed at; a copy of
  // the bar's links under the space, where the bar has them (CSS), the version filled in with it
  const links = q(".wall__nav");
  if (links) {
    const under = links.cloneNode(true);
    under.classList.add("wall__nav--under");
    under.setAttribute("aria-hidden", "true");
    under.inert = true;
    root.append(under);
    root.classList.add("has-under");
  }

  if (import.meta.env.DEV) {
    window.__wall = {
      cam,
      state: () => ({
        anim: !!anim,
        moving: moving(),
        idle,
        busy,
        marked,
        open: page.isOpen(),
        list: listKey,
        n,
        model,
        view: viewNow(),
        chosen: searchBox.chosen(),
        spot: !!spot?.on,
        azMix: azList.mix(),
        cellsMix,
      }),
      open: (hex) => open(nearest(hex)),
      box: (hex) => drawnBox(nearest(hex)),
      nearest: (hex) => items[nearest(hex)],
      at: (hex) => posOf(nearest(hex)),
      cellAt: (x, y) => cellAt(x, y),
      cardAt: (x, y) => {
        const i = cardAt(x, y);
        return i < 0 ? null : items[i];
      },
    };
  }

  const saveable = () => ({ target: cam.target, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, home: !away });
  addEventListener("pagehide", () => {
    if (!page.isOpen() && !pending) page.rememberView();
    if (busy) return; // opening a card already saved the view from before the click
    try {
      sessionStorage.setItem("wall-camera", JSON.stringify(saveable()));
    } catch {}
  });

  const start = normalizeHex(asked.c || "");
  if (start) choose(start, start);
  // the camera is restored only when coming back from a color page
  const nav = performance.getEntriesByType("navigation")[0]?.type;
  let fromColorPage = false;
  try {
    fromColorPage = /\/color\/([^/]+\/)?$/.test(new URL(document.referrer).pathname);
  } catch {}
  // a color page's close sent us back here
  let returning = false;
  try {
    returning = sessionStorage.getItem("wall-return") === "1";
    sessionStorage.removeItem("wall-return");
  } catch {}
  let saved = null;
  if (nav === "back_forward" || returning || (nav === "navigate" && fromColorPage)) {
    try {
      saved = JSON.parse(sessionStorage.getItem("wall-camera"));
    } catch {}
  }

  // a link to the A–Z list opens on it, whichever way the page was reached
  if (startView === "az") {
    let was = null;
    try {
      if (nav === "back_forward" || returning || fromColorPage) was = JSON.parse(sessionStorage.getItem("az-view"));
    } catch {}
    setView("az", was ?? {});
  }
  if (saved && Number.isFinite(saved.dist) && saved.target?.length === 3) {
    const { home: wasHome, ...restored } = saved;
    Object.assign(cam, restored);
    setAway(!wasHome);
    if (startView === "cells") setView("cells");
    idle = false;
    // back from a color's page: flown to that color, the one it ended on; under the list the
    // space has no card to show, only its label would linger over the names
    if (start && !azList.on() && returning) focusCard(nearest(start));
    else if (start && !azList.on()) {
      marked = nearest(start);
      spot = { i: marked, on: true, t: performance.now() };
    }
    request();
    requestAnimationFrame(() => requestAnimationFrame(enter));
  } else {
    const h = home();
    const startCells = startView === "cells";
    const then = () => {
      if (start && !azList.on()) focusCard(nearest(start));
      else idle = !reduceMotion;
      if (startCells) setView("cells");
    };
    // under the list there's no space to fly into
    if (reduceMotion || azList.on()) {
      Object.assign(cam, h);
      update();
      if (!azList.on()) then();
      enter();
    } else {
      Object.assign(cam, { ...h, dist: h.dist * 0.07, yaw: cam.yaw - 0.6 });
      update();
      flyTo(h, BANG_MS);
      bang = { start: performance.now(), center: h.target, then };
      busy = true;
      setTimeout(enter, BANG_MS * 0.75);
    }
    request();
  }
}
