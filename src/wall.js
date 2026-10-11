/*
  The color wall — every name on the list as a color card, hanging in 3D
  where its color sits in OKLCH: lightness runs up the middle axis, chroma
  is the distance from it, hue the angle around it. Greys gather on the
  axis, the most colorful names on the outside.

  Cards are instanced billboards in WebGL, always facing the camera, drawn
  like the color page's card: a square swatch over a white label strip.
  Close enough to read, the strip gets its hex and name as HTML.

  Clicking a card flies to it until it is as big as the color page's card,
  then navigates; a cross-document view transition carries the card into
  its place on the color page.
*/

import { getList, LISTS, normalizeHex, colorURL, siteURL, hexToRgb, rgbToOklab, cardPlace, UNNAMED, showVersion } from "./names.js";
import { buildOwners, createCellsRenderer, pick as pickCell, MODEL_IDS } from "./cells.js";

/* —— the space, in world units (a card is 1 wide) —— */
const W = 1;
const H = 1.3; // the color page's card: a square swatch, a 0.3 label strip
const LY = 180; // lightness → world height, the same in every model
const R = 100; // the outer radius of the polar models

/* —— where each model puts a color. RGB, OKLab and HSL stand light
   above dark; OKLCH lays the space out as a landscape instead. —— */

function hsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const polar = (deg, radius, y) => {
  const t = (deg * Math.PI) / 180;
  return [radius * Math.cos(t), y, -radius * Math.sin(t)];
};

const RGB_SIDE = 125;
const ROOT2 = Math.SQRT2;
const ROOT3 = Math.sqrt(3);
const ROOT6 = Math.sqrt(6);

export const MODELS = {
  // the cube stood on its black corner, white straight above it
  rgb: {
    label: "RGB",
    place: (it) => {
      const [r, g, b] = it.rgb.map((v) => v / 255 - 0.5);
      return [
        ((r - g) / ROOT2) * RGB_SIDE,
        ((r + g + b) / ROOT3) * RGB_SIDE,
        ((r + g - 2 * b) / ROOT6) * RGB_SIDE,
      ];
    },
  },
  // OKLab to scale: every axis in the same units, so the solid is as tall
  // and as narrow as the space really is
  oklab: {
    label: "OKLab",
    place: (it) => [it.a * LY, (it.L - 0.5) * LY, -it.b * LY],
  },
  // a landscape: hue round the ground, lightness from black at the center
  // out to white at the rim, chroma as height. The colorful names rise as
  // hills, the greys lie flat in the valleys.
  oklch: {
    label: "OKLCH",
    place: (it) =>
      polar(
        (Math.atan2(it.b, it.a) * 180) / Math.PI,
        it.L * R * 1.2,
        (Math.hypot(it.a, it.b) / 0.32) * LY * 0.55 - LY * 0.25
      ),
  },
  // HSL's double cone: hue the angle, saturation out to the rim at mid
  // lightness, pinched to a point at black and at white
  hsl: {
    label: "HSL",
    place: (it) => {
      const [h, s, l] = hsl(it.rgb);
      return polar(h, s * (l < 0.5 ? l : 1 - l) * 2 * R, (l - 0.5) * LY);
    },
  },
};
const DEFAULT_MODEL = "rgb";
const GEO = { LY, R, RGB_SIDE }; // for the cells, which undo MODELS' placing
// how far a name's cell reaches: the name map's "unnamed" distance, in the
// wall's units (OKLab's L runs over LY), the same in every model
const CELL_REACH = UNNAMED * LY;

const FOV = (42 * Math.PI) / 180;
const NEAR = 0.3;
const FAR = 3000;
const MIN_DIST = 2.5; // closer than this, scrolling flies forward instead
const MAX_DIST = 860;
const DAMPING = 0.1; // share of the remaining motion applied per frame (OrbitControls: 0.05)
const MORPH_MS = 1400; // switching models
const BANG_MS = 2600; // the opening burst
const LIST_SHIFT_MS = 600; // changing lists: names leaving shrink, new ones grow
// opening a card: the others pushed off, then gone, then the page changes
// and the card itself travels into place on the color page
// Opening a card and closing it again, as overlapping parts on one
// timeline each ([start, length] in ms): every part begins while the one
// before is still settling, so the whole reads as one movement.
const IN = { fly: 800, clear: [0, 450], repel: [150, 500], fade: [420, 380], glide: 640, travel: 760 };
const OUT = { leave: 300, travel: 760, fade: [380, 420], repel: [520, 520], fly: 900 };
const part = (t, [at, length]) => ease(clamp((t - at) / length, 0, 1));
const START_DIST = 340;
const LABEL_PX = 92; // a card this wide on screen gets its name
const MAX_LABELS = 140;
const FOCUS_PX = 230; // card width when flying to a search result

// the color page's card, shown as it looks once it has appeared
const CARD_HTML = `<article class="swatchcard swatchcard--visible swatchcard--reset">
  <div class="swatchcard__upper"><i class="swatchcard__swatch" aria-hidden="true">
    <i class="swatchcard__shade"></i><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i>
  </i></div>
  <div class="swatchcard__label"><div class="swatchcard__info">
    <span class="swatchcard__row1"></span><span class="swatchcard__row2"></span>
  </div></div>
</article>`;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t) => 1 - Math.pow(1 - t, 4);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* —— small vector helpers —— */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(...a));
const lerp3 = (a, b, k) => add(a, scale(sub(b, a), k));

/* —— WebGL —— */

const VERT = `#version 300 es
in vec2 a_corner;
in vec3 a_pos;
in vec3 a_color;
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;   // focal length in device px
uniform vec2 u_view;   // canvas size in device px
uniform vec2 u_size;
uniform vec2 u_clip;   // near, far
uniform vec2 u_fog;    // depth where the fog starts, ends (from the eye)
uniform int u_focus;   // the opened card, or -1
uniform vec3 u_focusPos;
uniform float u_repel; // 0–1: the others pushed away from it
uniform float u_fade;  // 0–1: the others shrinking into the dark
uniform float u_clear; // 0–1: the cards between the eye and it, cleared away
uniform bool u_handed; // the opened card has been handed to its HTML copy
uniform float u_bang;  // the opening burst, 0–1, or -1 once it's over
uniform vec3 u_bangCenter;
in float a_grow;       // 1 for a card that's new to the list it's on
uniform float u_grow;  // 0–1: how far the new cards have grown in
uniform int u_only;      // draw only this card (over the cells), or -1
uniform float u_keepAll; // 0–1: every card but the opened one, shrunk away
out vec2 v_local;
out vec3 v_color;
out float v_cardpx;
out float v_fog;
void main() {
  // opening a card: everything else is pushed away from it, nearest the
  // hardest, then shrinks to nothing
  vec3 pos = a_pos;
  float keep = 1.0;
  if (u_focus >= 0 && gl_InstanceID != u_focus) {
    vec3 d = a_pos - u_focusPos;
    float len = length(d) + 0.001;
    // pushed out across the screen, not toward the camera, so nothing
    // sweeps past the eye
    vec3 across = d - u_fwd * dot(d, u_fwd);
    float wide = length(across) + 0.001;
    pos += across / wide * u_repel * (4.0 + 30.0 * exp(-len / 24.0));
    keep = 1.0 - u_fade;
    // a card nearer than it, and covering it on screen, gets out of the way
    vec3 vf = u_focusPos - u_eye;
    vec3 vc = a_pos - u_eye;
    float zf = dot(vf, u_fwd);
    float zc = dot(vc, u_fwd);
    if (zc > 0.0 && zc < zf) {
      vec2 d = abs(vec2(dot(vc, u_right), dot(vc, u_up)) / zc - vec2(dot(vf, u_right), dot(vf, u_up)) / zf);
      vec2 reach = u_size * 0.5 * (1.0 / zc + 1.0 / zf);
      if (d.x < reach.x && d.y < reach.y) keep *= 1.0 - u_clear;
    }
  }
  // the opening burst: out of the middle, past their places and back,
  // growing in out of the dark. Like a change of model, it ripples by
  // lightness, the lightest cards first, with a little jitter
  float born = 1.0;
  if (u_bang >= 0.0) {
    float h = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
    float light = dot(a_color, vec3(0.2126, 0.7152, 0.0722));
    float t = clamp((u_bang - (1.0 - light) * 0.4 - h * 0.08) / 0.52, 0.0, 1.0);
    float c1 = 2.4, c3 = c1 + 1.0, u = t - 1.0;
    float out_ = 1.0 + c3 * u * u * u + c1 * u * u; // ease out, with a bounce back
    pos = mix(u_bangCenter, pos, out_);
    born = smoothstep(0.0, 0.45, t);
    keep *= born;
  }
  keep *= mix(1.0, u_grow, a_grow);
  if (u_only >= 0 && gl_InstanceID != u_only) keep = 0.0;
  if (gl_InstanceID != u_focus) keep *= u_keepAll;
  // once its HTML copy has taken over, the drawn card is gone
  if (u_handed && gl_InstanceID == u_focus) keep = 0.0;
  vec3 v = pos - u_eye;
  float z = dot(v, u_fwd);
  float px = max(z, 0.001) / u_fpx; // world units per pixel at this depth
  // grow the quad by a pixel so its edge can antialias
  v_local = a_corner * u_size + (a_corner * 2.0 - 1.0) * px;
  vec2 p = vec2(dot(v, u_right), dot(v, u_up))
    + vec2(v_local.x - u_size.x * 0.5, u_size.y * 0.5 - v_local.y) * keep;
  float n = u_clip.x, f = u_clip.y;
  gl_Position = vec4(
    p.x * u_fpx / (u_view.x * 0.5),
    p.y * u_fpx / (u_view.y * 0.5),
    (z * (f + n) - 2.0 * f * n) / (f - n),
    z
  );
  // the opened card stays in front of everything on its way out
  if (u_focus >= 0 && gl_InstanceID == u_focus) gl_Position.z = -z;
  v_color = a_color;
  v_cardpx = u_size.x / px;
  v_fog = max(smoothstep(u_fog.x, u_fog.y, z), 1.0 - born);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
in float v_cardpx;
in float v_fog;
uniform vec2 u_size;
out vec4 o;
void main() {
  if (v_local.x < 0.0 || v_local.y < 0.0 || v_local.x > u_size.x || v_local.y > u_size.y) discard;
  // the label strip is white once the card is big enough to have one;
  // further out the whole card is its color, so the space reads as a cloud
  vec3 paper = mix(v_color, vec3(1.0), smoothstep(10.0, 34.0, v_cardpx));
  vec3 c = v_local.y < u_size.x ? v_color : paper;
  o = vec4(mix(c, vec3(0.0), v_fog), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function createRenderer(canvas, positions, colors, grow = new Uint8Array(positions.length / 3)) {
  const gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = {};
  const attrib = (name, array, size, type, normalized, divisor) => {
    const loc = gl.getAttribLocation(prog, name);
    buffers[name] = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name]);
    gl.bufferData(gl.ARRAY_BUFFER, array, name === "a_pos" ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(loc, divisor);
  };
  attrib("a_corner", new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2, gl.FLOAT, false, 0);
  attrib("a_pos", positions, 3, gl.FLOAT, false, 1);
  attrib("a_color", colors, 3, gl.UNSIGNED_BYTE, true, 1);
  attrib("a_grow", grow, 1, gl.UNSIGNED_BYTE, false, 1);

  const u = {};
  for (const k of ["eye", "right", "up", "fwd", "fpx", "view", "size", "clip", "fog", "focus", "focusPos", "repel", "fade", "clear", "handed", "bang", "bangCenter", "only", "keepAll", "grow"]) {
    u[k] = gl.getUniformLocation(prog, `u_${k}`);
  }
  gl.uniform2f(u.size, W, H);
  gl.uniform2f(u.clip, NEAR, FAR);
  gl.uniform1i(u.focus, -1);
  gl.uniform1f(u.bang, -1);
  gl.uniform1f(u.grow, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 1);

  const count = positions.length / 3;
  // clear: false draws over what's there (the cells); only: one card
  const draw = (cam, dpr, { clear = true, only = -1, keepAll = 1 } = {}) => {
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(clear ? gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT : gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(u.only, only);
    gl.uniform1f(u.keepAll, keepAll);
    gl.uniform3fv(u.eye, cam.eye);
    gl.uniform3fv(u.right, cam.right);
    gl.uniform3fv(u.up, cam.up);
    gl.uniform3fv(u.fwd, cam.fwd);
    gl.uniform1f(u.fpx, cam.fpx * dpr);
    gl.uniform2f(u.view, canvas.width, canvas.height);
    // the far side of the shape sinks into the black: measured from the
    // shape's middle, so it doesn't change with where the camera turns
    const mid = Math.hypot(...sub(cam.center, cam.eye));
    gl.uniform2f(u.fog, Math.max(0, mid) + 60, mid + 420);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };
  // the opening burst: progress 0–1 from a center, or -1 for none
  draw.bang = (t, center) => {
    gl.useProgram(prog);
    gl.uniform1f(u.bang, t);
    if (center) gl.uniform3fv(u.bangCenter, center);
  };
  // the cards new to the list, growing in
  draw.grow = (k) => {
    gl.useProgram(prog);
    gl.uniform1f(u.grow, k);
  };
  // the card being opened, and how far the others have gone
  draw.focus = (i, pos, repel, fade, clear = 0, handed = false) => {
    gl.useProgram(prog);
    gl.uniform1i(u.focus, i);
    gl.uniform1i(u.handed, handed ? 1 : 0);
    if (pos) gl.uniform3fv(u.focusPos, pos);
    gl.uniform1f(u.repel, repel);
    gl.uniform1f(u.fade, fade);
    gl.uniform1f(u.clear, clear);
  };
  draw.gl = gl;
  // done with it: another list's cards replace these
  draw.dispose = () => {
    Object.values(buffers).forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(vao);
    gl.deleteProgram(prog);
  };
  // new positions for every card, while models morph
  draw.move = (array) => {
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, array);
  };
  return draw;
}

/* —— the page —— */

export async function initWall(root) {
  const q = (s) => root.querySelector(s);
  showVersion(root);
  const canvas = q("[data-canvas]");
  const labels = q("[data-labels]");
  const mark = q("[data-mark]");
  const tip = q("[data-tip]");
  const status = q("[data-status]");
  const search = q("[data-search]");
  const colorPicker = q("[data-picker]");
  const results = q("[data-results]");
  const intro = q("[data-intro]");

  // the intro card, once dismissed, stays dismissed
  try {
    if (localStorage.getItem("wall-intro-seen")) intro.hidden = true;
  } catch {}
  q("[data-intro-close]").addEventListener("click", () => {
    intro.hidden = true;
    try {
      localStorage.setItem("wall-intro-seen", "1");
    } catch {}
  });

  // which list: the full one, unless the address asks for another (it can
  // be switched later: see setList)
  let listKey = new URLSearchParams(location.search).get("list");
  if (!LISTS[listKey]) listKey = "default";
  let list;
  try {
    list = await getList(listKey);
  } catch {
    status.textContent = "The names didn’t load. Check your connection and reload the page.";
    return;
  }
  let items = list.items;
  let n = items.length;
  const showCount = () =>
    root.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = n.toLocaleString("en-US");
    });
  showCount();

  // each name where the chosen model puts its color; every model's
  // positions are worked out once, the first time it's shown
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

  // each model's middle, worked out once (see home())
  const middles = {};
  const middleOf = (key) => (middles[key] ??= home(key).target);

  const picker = q("[data-models]");
  // RGB first, unless the address asks for another
  let model = new URLSearchParams(location.search).get("model");
  if (!MODELS[model]) model = DEFAULT_MODEL;
  let positions = placeAll(model).slice();
  const posOf = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

  let draw;
  try {
    draw = createRenderer(canvas, positions, colors);
  } catch (e) {
    console.error(e);
  }
  if (!draw) {
    status.textContent = "This view needs WebGL, which this browser doesn’t offer.";
    return;
  }
  status.hidden = true;

  /* —— camera: orbits a target; yaw round the axis, pitch over it —— */

  const view = { w: 1, h: 1 };
  let dpr = 1;
  const cam = {
    target: [0, 0, 0],
    yaw: Math.random() * Math.PI * 2,
    pitch: 0.32,
    dist: START_DIST,
  };

  function update() {
    cam.center = middleOf(model);
    cam.pitch = clamp(cam.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    cam.dist = clamp(cam.dist, MIN_DIST, MAX_DIST);
    const cp = Math.cos(cam.pitch);
    const back = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
    cam.eye = add(cam.target, scale(back, cam.dist));
    cam.fwd = scale(back, -1);
    cam.right = norm(cross(cam.fwd, [0, 1, 0]));
    cam.up = cross(cam.right, cam.fwd);
    cam.fpx = view.h / 2 / Math.tan(FOV / 2); // in CSS px
  }

  // a world point on screen: x, y in CSS px, z its depth, s px per world unit
  function project(p) {
    const v = sub(p, cam.eye);
    const z = dot(v, cam.fwd);
    const s = cam.fpx / z;
    return { x: view.w / 2 + dot(v, cam.right) * s, y: view.h / 2 - dot(v, cam.up) * s, z, s };
  }

  // Every card on screen, nearest first. Cheap enough to run for all of
  // them: a few dot products each.
  function onScreen(minPx = 0, limit = Infinity) {
    const out = [];
    const [ex, ey, ez] = cam.eye;
    const [fx, fy, fz] = cam.fwd;
    const [rx, ry, rz] = cam.right;
    const [ux, uy, uz] = cam.up;
    const maxZ = minPx ? (W * cam.fpx) / minPx : FAR;
    // the cards cleared out of the way of a found card can't be hit: nearer
    // than it, and covering it on screen (the shader's rule)
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
      if (sp && i !== sp.i && z < sp.z && Math.abs(x - sp.x) < hw + sp.hw && Math.abs(y - sp.y) < hh + sp.hh) continue;
      if (x + hw < 0 || x - hw > view.w || y + hh < 0 || y - hh > view.h) continue;
      out.push({ i, z, x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh, s });
    }
    out.sort((a, b) => a.z - b.z);
    return out.length > limit ? out.slice(0, limit) : out;
  }

  function cardAt(sx, sy) {
    // a found card is drawn in front of everything
    if (spot?.on) {
      const b = drawnBox(spot.i);
      if (Math.abs(sx - b.x) <= b.w / 2 && Math.abs(sy - b.y) <= (b.w * H) / 2) return spot.i;
    }
    if (cellsMix > 0.5) return cellAt(sx, sy);
    for (const c of onScreen()) {
      if (sx >= c.x0 && sx <= c.x1 && sy >= c.y0 && sy <= c.y1) return c.i;
    }
    return -1;
  }

  /* —— frame —— */

  let queued = false;
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
  };

  let anim = null; // a flight: { from, to, start, duration, done }
  let morph = null; // a change of model: { from, to, start }
  let bang = null; // the opening burst: { start, center }
  let listShift = null; // changing lists: { start }
  let leaving = null; // the cards of names not on the new list, shrinking away
  let opening = null; // a card on its way into its color page: { i, pos, start }
  // what the pointer and wheel ask of the camera, applied over the next
  // frames (see frame): turns, a move of the target, a zoom (log scale)
  const delta = { yaw: 0, pitch: 0, pan: [0, 0, 0], zoom: 0 };
  const moving = () =>
    Math.abs(delta.yaw) + Math.abs(delta.pitch) + Math.abs(delta.zoom) > 1e-5 || Math.hypot(...delta.pan) > 1e-4;
  const stopMoving = () => Object.assign(delta, { yaw: 0, pitch: 0, pan: [0, 0, 0], zoom: 0 });
  let idle = !reduceMotion; // a slow turn until someone touches it
  let lastTime = 0;
  let marked = -1;
  // a found card (search, color circle, ?c=): drawn in front, with the cards
  // between it and the eye shrunk out of the way, until the camera moves
  let spot = null; // { i, on, t }
  let busy = false; // on the way into a color page

  function frame(time) {
    queued = false;
    const dt = lastTime ? Math.min(48, time - lastTime) : 16;
    lastTime = time;

    if (anim?.card) {
      // zooming into a card: it slides straight from where it was to the
      // middle while it grows, and the camera is placed to show exactly that
      const t = Math.min(1, (time - anim.start) / anim.duration);
      const k = anim.ease(t);
      const w = Math.exp(Math.log(anim.w0) + (Math.log(anim.w1) - Math.log(anim.w0)) * k);
      const z = (W * cam.fpx) / w;
      const sx = anim.sx0 + (anim.sx1 - anim.sx0) * k;
      const sy = anim.sy0 + (anim.sy1 - anim.sy0) * k;
      cam.target = sub(anim.card, add(scale(cam.right, (sx * z) / cam.fpx), scale(cam.up, (sy * z) / cam.fpx)));
      cam.dist = z;
      if (t >= 1) {
        // the same view as the camera asked for; only its target may sit
        // elsewhere along the line of sight
        if (anim.final) Object.assign(cam, anim.final);
        const done = anim.done;
        anim = null;
        done?.();
      }
    } else if (anim) {
      const t = Math.min(1, (time - anim.start) / anim.duration);
      const k = anim.ease(t);
      cam.target = lerp3(anim.from.target, anim.to.target, k);
      cam.dist = Math.exp(Math.log(anim.from.dist) + (Math.log(anim.to.dist) - Math.log(anim.from.dist)) * k);
      cam.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * k;
      cam.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * k;
      if (t >= 1) {
        const done = anim.done;
        anim = null;
        done?.();
      }
    } else if (moving()) {
      // like three.js OrbitControls with damping: each frame takes a share
      // of what the input asked for, the rest carries on and dies away
      const f = reduceMotion ? 1 : 1 - Math.pow(1 - DAMPING, dt / 16.7);
      cam.yaw += delta.yaw * f;
      cam.pitch += delta.pitch * f;
      cam.target = add(cam.target, scale(delta.pan, f));
      cam.dist *= Math.exp(delta.zoom * f);
      delta.yaw *= 1 - f;
      delta.pitch *= 1 - f;
      delta.pan = scale(delta.pan, 1 - f);
      delta.zoom *= 1 - f;
      if (!moving()) stopMoving();
    } else if (idle) {
      cam.yaw += 0.00006 * dt;
    }

    if (morph) {
      // lighter cards set off a little earlier, so the change ripples
      // through the space instead of happening all at once
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
      // changing lists: the names on both stay put, those leaving shrink
      // away where they are, the new ones grow in at their places
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
        // the others grow back while the card is still on its way home,
        // then drift in; from wherever the way in had got to
        const f = opening.from;
        now = {
          clear: f.clear * (1 - part(t, OUT.fade)),
          repel: f.repel * (1 - part(t, OUT.repel)),
          fade: f.fade * (1 - part(t, OUT.fade)),
        };
      } else {
        // the path clears as the camera flies in, the push starts on the
        // way, the others shrink away as it settles
        now = { clear: part(t, IN.clear), repel: part(t, IN.repel), fade: part(t, IN.fade) };
      }
      opening.now = now;
      draw.focus(opening.i, opening.pos, now.repel, now.fade, now.clear, opening.handed);
    }

    update();
    render(time);
    placeLabels();
    placeMark();
    if (anim || moving() || idle || morph || opening || spot || bang || cellsFade || flip || listShift) request();
    else lastTime = 0;
  }

  const stopIdle = () => {
    idle = false;
  };

  /* —— names, on the cards near enough to read —— */

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
    // opening or closing a card, only it keeps its label, while it's drawn
    // (its HTML copy has its own)
    const one = (i) => [{ i, ...boxRect(drawnBox(i)), s: drawnBox(i).w / W }].filter((c) => c.x1 - c.x0 > 36);
    const near = opening
      ? opening.handed
        ? []
        : one(opening.i)
      : cellsMix > 0.5
        ? spot?.on
          ? one(spot.i)
          : []
        : onScreen(LABEL_PX, MAX_LABELS * 3);
    const covers = [];
    for (const c of near) {
      // the strip under the swatch; skipped when a nearer card covers it
      const top = c.y0 + W * c.s;
      const hidden = covers.some((r) => r.x0 < c.x1 && r.x1 > c.x0 && r.y0 < c.y1 && r.y1 > top);
      covers.push(c);
      if (hidden || used >= MAX_LABELS) continue;
      const l = label(used++);
      if (l.i !== c.i) {
        l.i = c.i;
        l.hex.textContent = items[c.i].hex;
        l.name.textContent = items[c.i].name;
      }
      const w = c.x1 - c.x0;
      l.el.style.transform = `translate(${c.x0}px, ${top}px)`;
      l.el.style.width = `${w}px`;
      l.el.style.fontSize = `${w * 0.205}px`;
      l.el.style.zIndex = String(MAX_LABELS - used);
      l.el.hidden = false;
    }
    for (let k = used; k < pool.length && !pool[k].el.hidden; k++) pool[k].el.hidden = true;
  }

  // the found card goes back among the others once the camera moves
  function dropSpot() {
    if (!spot?.on) return;
    spot = { ...spot, on: false, t: performance.now() };
    marked = -1;
    mark.hidden = true;
    request();
  }

  const boxRect = (b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - (b.w * H) / 2, y1: b.y + (b.w * H) / 2 });

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

  /* —— size —— */

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

  /* —— flights —— */

  function flyTo(to, duration = 1100, done, easing = ease) {
    stopMoving();
    stopIdle();
    const target = { target: cam.target, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch, ...to };
    // turn the short way round
    target.yaw = cam.yaw + ((((target.yaw - cam.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
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

  // Fly into a card: from wherever it is on screen, it moves in a straight
  // line to the middle while it grows to w px; the view doesn't turn.
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

  // And back out of it, the same way in reverse: from the middle, the card
  // moves in a straight line to where it sits in the view we return to,
  // shrinking as it goes. Both views look the same way, so nothing turns.
  function zoomOutOf(i, to, duration, done, easing = easeInOut) {
    stopMoving();
    stopIdle();
    const card = posOf(i);
    const now = project(card);
    // where the card will be in that view
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
    // a card out of sight in the view we return to (a color reached from
    // the color page): an ordinary flight then
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

  // the distance at which a card is px wide on screen
  const distFor = (px) => (W * cam.fpx) / px;

  function focusCard(i) {
    marked = i;
    spot = { i, on: true, t: performance.now() };
    colorPicker.value = items[i].hex;
    flyTo({ target: posOf(i), dist: distFor(FOCUS_PX) });
    try {
      const url = new URL(location.href);
      url.searchParams.set("c", items[i].hex.slice(1));
      history.replaceState(null, "", url);
    } catch {}
  }

  // Where the color page puts its card, for a given place: measured on an
  // invisible copy of its hero and card, so it follows the color page's own
  // CSS (landscape or portrait, its card size) rather than repeating it.
  function slotOf(place) {
    // inside a layer like the one the color page opens in, so its width
    // (scrollbar and all) is the same
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

  // Into the color page: the others are pushed off and shrink away, then
  // the card travels into its place on the color page.
  /* —— an HTML copy of the color page's card, to carry a card between
     the 3D space and the color page —— */

  const sizeCard = (card, w) => {
    card.style.inlineSize = `${w}px`;
    card.style.fontSize = `${w * 0.205}px`;
  };

  function makeCopy(hex, name, w) {
    const copy = document.createElement("div");
    copy.className = "wall__handoff";
    copy.innerHTML = CARD_HTML;
    const card = copy.firstElementChild;
    card.style.cssText = `--c-color:${hex};--c-shade0:${hex};--c-shade1:${hex}`;
    card.querySelector(".swatchcard__row1").textContent = hex;
    card.querySelector(".swatchcard__row2").textContent = name;
    sizeCard(card, w);
    return { copy, card };
  }

  // a box is a center and a width; the card's height follows from it
  function placeCopy({ copy, card }, box, r = 0) {
    copy.style.transform = `translate(${box.x - box.w / 2}px, ${box.y - (box.w * H) / 2}px) rotate(${r}deg)`;
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

  // where a card is drawn on screen right now
  function drawnBox(i) {
    const p = project(posOf(i));
    return { x: p.x, y: p.y, w: W * p.s };
  }

  // the size the color page gives its card
  const pageCardWidth = () => clamp(view.w * 0.21, 208, 384);

  // Into the color page: fly to the card, push the others off and let
  // them shrink away, then the card glides into its place on the color
  // page, which opens underneath it.
  let pending = null; // a card on its way in: { i, before, c, cancelled }

  function open(i) {
    if (busy) return;
    busy = true;
    marked = -1;
    mark.hidden = true;
    tip.hidden = true;
    const it = items[i];
    // coming back, the wall is as it was before the click
    const before = saveable();
    const task = (pending = { i, before, c: null, cancelled: false });
    spot = null;
    // the address changes at once, as for a link, so Back at any point on
    // the way in comes back to the wall (see cancelOpening)
    history.pushState({ colorDepth: 1 }, "", colorURL(it.hex));

    // The camera flies to the card until it's as big as on the color
    // page; it's drawn in front from now on, whatever is in the way clears
    // off, the others are pushed away and shrink (see IN and the frame)
    root.classList.add("is-opening");
    opening = { i, pos: posOf(i), t0: performance.now(), handed: false };
    zoomInto(i, pageCardWidth(), IN.fly);

    // As the camera settles, the card becomes an HTML copy laid exactly
    // over the drawn one and glides and tilts to where the color page puts
    // it; the color page opens under it, its own card in the same place.
    later(IN.glide, async () => {
      if (task.cancelled) return;
      const c = (task.c = makeCopy(it.hex, it.name, 0));
      placeCopy(c, drawnBox(i));
      root.append(c.copy);
      opening.handed = true;
      request();
      const place = cardPlace();
      await glide(c, slotOf(place), place.r, IN.travel);
      if (task.cancelled) return;
      try {
        sessionStorage.setItem("card-handoff", JSON.stringify({ hex: it.hex, name: it.name, place }));
        sessionStorage.setItem("wall-camera", JSON.stringify(before));
      } catch {}
      try {
        await showColorPage(it.hex, before, c.copy, task);
      } catch (e) {
        // can't build it here: the address is already the color page's,
        // so load it on its own
        console.error(e);
        location.reload();
      }
    });
  }

  const later = (ms, fn) => setTimeout(fn, reduceMotion ? 0 : ms);

  /* —— the color page, inside the wall ——
     Rather than loading a new page (and the cut that comes with it), the
     color page's markup is laid over the wall in this same document and
     the address changes to color/#hex. Its card takes over from the copy
     in the very same place. Closing plays the way in backwards; a reload
     of that address opens the color page on its own. */

  let colorPage = null; // { layer, controller, returnTo, hex, depth }
  let colorMarkup = null;
  // resolved now: once a card is opening, the address is the color page's
  const colorPageURL = siteURL("color/");
  const loadColorPage = () =>
    (colorMarkup ??= fetch(colorPageURL)
      .then((r) => r.text())
      .then((html) => new DOMParser().parseFromString(html, "text/html").querySelector("main")));
  const loadDetail = () => import("./detail.js");
  // fetched ahead, so a click doesn't wait on them
  setTimeout(() => {
    loadColorPage().catch(() => (colorMarkup = null));
    loadDetail().catch(() => {});
  }, 1500);

  const wallTitle = document.title;

  async function showColorPage(hex, returnTo, copy, task) {
    const [main, detail] = await Promise.all([loadColorPage(), loadDetail()]);
    if (task.cancelled) return;
    pending = null;
    const layer = document.createElement("div");
    layer.className = "wall__page";
    layer.append(document.importNode(main, true));
    // links on the color page are relative to it, one level down
    document.documentElement.dataset.root = "../";
    root.append(layer);
    const controller = new AbortController();
    colorPage = { layer, controller, returnTo, hex, depth: 1 };
    detail.initDetailPage(layer, {
      embedded: true,
      signal: controller.signal,
      // ×, Escape, the home link: straight back to the 3D space, past
      // every color visited since
      onClose: () => history.go(-colorPage.depth),
    });
    // the color page's own card is in place now; the copy can go
    requestAnimationFrame(() => copy.remove());
  }

  // a neighbor on the color page is a new history entry, one deeper
  addEventListener("hashchange", () => {
    if (!colorPage) return;
    colorPage.hex = normalizeHex(location.hash.slice(1)) || colorPage.hex;
    if (history.state?.colorDepth == null) {
      history.replaceState({ colorDepth: colorPage.depth + 1 }, "");
    }
    colorPage.depth = history.state.colorDepth;
  });

  // Out of the color page, the way in backwards: the page fades from under
  // its card, the card glides back to its place in the space, the others
  // grow back and drift in, and the camera returns to where it was.
  function closeColorPage() {
    const page = colorPage;
    colorPage = null;
    const slot = page.layer.querySelector(".color-hero__card");
    const b = slot.getBoundingClientRect();
    const from = { x: b.left + b.width / 2, y: b.top + b.height / 2, w: slot.firstElementChild.offsetWidth };
    const tilt = parseFloat(slot.style.getPropertyValue("--r")) || 0;
    let i = items.findIndex((it) => it.hex === page.hex);
    if (i < 0) i = nearest(page.hex);
    const name = slot.querySelector("[data-card-name]")?.textContent || items[i].name;

    const c = makeCopy(page.hex, name, from.w);
    c.copy.classList.add("is-returning");
    placeCopy(c, from, tilt);
    root.append(c.copy);
    // the copy covers the page's own card exactly; that one goes, so no
    // second card stays behind on the fading page
    slot.style.visibility = "hidden";

    page.controller.abort();
    delete document.documentElement.dataset.root;
    document.documentElement.classList.remove("is-arriving");
    document.title = wallTitle;

    // behind the page, the camera already waits on the card, the others gone
    anim = null;
    Object.assign(cam, {
      target: posOf(i),
      dist: distFor(pageCardWidth()),
      yaw: page.returnTo.yaw,
      pitch: page.returnTo.pitch,
    });
    update();

    // the page fades from under its card while the card already glides home
    page.layer.classList.add("is-leaving");
    later(OUT.leave, () => page.layer.remove());
    returnCard(c, i, page.returnTo, { repel: 1, fade: 1, clear: 1 });
  }

  // The way back from the copy: it glides to where its card is drawn while
  // the others grow back around it and drift in; it hands over to the drawn
  // card, and the camera sets off home while the last of them settle.
  async function returnCard(c, i, returnTo, from) {
    opening = { i, pos: posOf(i), reverse: true, t0: performance.now(), handed: true, from };
    request();
    // the copy is shown where it was for a frame before it sets off
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await glide(c, drawnBox(i), 0, OUT.travel);
    c.copy.remove();
    opening.handed = false;
    zoomOutOf(i, returnTo, OUT.fly, resetOpening);
  }

  // Back while a card is still on its way in: it turns round from wherever
  // it got to.
  function cancelOpening() {
    const task = pending;
    pending = null;
    task.cancelled = true;
    const from = opening?.now || { repel: 0, fade: 0, clear: 0 };
    anim = null;
    if (task.c) {
      // the copy is somewhere between the space and the color page's place
      returnCard(task.c, task.i, task.before, from);
    } else {
      // still flying in: back out, the others coming back on the way
      opening = { i: task.i, pos: posOf(task.i), reverse: true, t0: performance.now() - OUT.fade[0], handed: false, from };
      flyTo(task.before, reduceMotion ? 0 : OUT.fly, resetOpening, easeInOut);
    }
  }

  function resetOpening() {
    busy = false;
    opening = null;
    root.classList.remove("is-opening");
    draw.focus(-1, null, 0, 0);
    labels.hidden = false;
    root.querySelectorAll(".wall__handoff").forEach((el) => el.remove());
    request();
  }

  addEventListener("popstate", () => {
    const onColor = /\/color\/$/.test(location.pathname);
    if (pending && !onColor) cancelOpening();
    else if (colorPage && !onColor) closeColorPage();
    // forward again into a color page that's no longer open: load it
    else if (!colorPage && !pending && onColor) location.reload();
  });

  // back from a color page (bfcache): the copy is gone, the wall is live again
  addEventListener("pageshow", (e) => {
    if (e.persisted && !colorPage) resetOpening();
  });

  /* —— pointer and wheel, the way three.js OrbitControls does it: drag
     turns round the target, right-drag / shift-drag / two fingers move
     it, the wheel and a pinch zoom toward it —— */

  const pointers = new Map();
  let press = null; // the first pointer down, to tell a click from a drag
  let pinch = null;

  // a full screen height of drag is a full turn
  function rotate(dx, dy) {
    delta.yaw -= (2 * Math.PI * dx) / view.h;
    delta.pitch += (2 * Math.PI * dy) / view.h;
  }

  // the target moves with the pointer, at the target's depth
  function pan(dx, dy) {
    const k = cam.dist / cam.fpx;
    delta.pan = add(delta.pan, add(scale(cam.right, -dx * k), scale(cam.up, dy * k)));
  }

  const zoom = (logFactor) => {
    delta.zoom += logFactor;
  };

  // the middle of the current model's shape, and the view of all of it
  function home(key = model) {
    const p = placeAll(key);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], p[i]);
      hi[i % 3] = Math.max(hi[i % 3], p[i]);
    }
    // far enough for the whole shape, on a wide screen and a narrow one
    const radius = Math.hypot(...sub(hi, lo)) / 2;
    const half = Math.min(FOV / 2, Math.atan(Math.tan(FOV / 2) * (view.w / view.h)));
    const dist = clamp((radius / Math.sin(half)) * 0.92, MIN_DIST * 10, MAX_DIST);
    return { target: scale(add(lo, hi), 0.5), dist, pitch: 0.32 };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (busy) return;
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

  // a mouse over the space: the card's name follows it, unless it has a label
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
      tip.hidden = true;
      canvas.style.cursor = "";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const i = cardAt(sx, sy);
    const hit = i < 0 ? null : onScreen().find((c) => c.i === i) || { i, ...boxRect(drawnBox(i)) };
    canvas.style.cursor = hit ? "pointer" : "";
    // cards big enough carry their own label; cells never do
    if (!hit || (cellsMix <= 0.5 && hit.x1 - hit.x0 >= LABEL_PX)) {
      tip.hidden = true;
      return;
    }
    // a dot of the color, then the name and the hex
    const dot = document.createElement("i");
    dot.className = "wall__tip-dot";
    dot.style.background = items[hit.i].hex;
    tip.replaceChildren(dot, `${items[hit.i].name} ${items[hit.i].hex}`);
    tip.style.transform = `translate(${sx}px, ${sy}px)`;
    tip.hidden = false;
  }
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));

  // the wheel and a trackpad pinch zoom toward the target
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (busy) return;
      anim = null;
      stopIdle();
      dropSpot();
      tip.hidden = true;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      zoom(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      request();
    },
    { passive: false }
  );

  // Safari's own pinch events, so the page itself never zooms
  root.addEventListener("gesturestart", (e) => e.preventDefault());

  const step = (factor) => () => {
    if (busy) return;
    flyTo({ dist: clamp(cam.dist * factor, MIN_DIST, MAX_DIST) }, 420);
  };
  const goHome = () => !busy && flyTo(home(), 1000);

  // The logo: over an open color page it closes it (the way the × does);
  // on the wall it shows the whole space again.
  q(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    if (colorPage) history.go(-colorPage.depth);
    else goHome();
  });
  q("[data-home]").addEventListener("click", goHome);
  // a double-click on the dark: back to the whole shape
  canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (cardAt(e.clientX - rect.left, e.clientY - rect.top) < 0) goHome();
  });

  // the keyboard turns and flies too, unless someone is typing
  window.addEventListener("keydown", (e) => {
    if (busy || e.target.closest?.("input, button, a")) return;
    const turns = { ArrowLeft: [0.25, 0], ArrowRight: [-0.25, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] };
    if (turns[e.key]) {
      e.preventDefault();
      dropSpot();
      flyTo({ yaw: cam.yaw + turns[e.key][0], pitch: clamp(cam.pitch + turns[e.key][1], -1.45, 1.45) }, 320);
    } else if (e.key === "+" || e.key === "=") step(1 / 1.8)();
    else if (e.key === "-") step(1.8)();
    else if (e.key === "0" || e.key === "Home") goHome();
    else if (e.key === "/") {
      e.preventDefault();
      search.focus();
    }
  });

  /* —— cells: the space filled, each name's region in its color —— */

  const cellsButton = q("[data-cells]");
  const cellsData = {}; // per model: who owns which part of it (see cells.js)
  const building = {};
  let cellsDraw = null;
  let cellsOn = false;
  let cellsMix = 0; // 0 cards … 1 cells
  let cellsFade = null; // { from, to, t0 }
  let cellsModel = model; // the model the cells are drawn in
  let flip = null; // a change of model under the cells: { t0, from, to }

  // the box around each model's shape, to clip the cells' rays to
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

  // Closing in, the space between the camera and the point it turns round
  // is cut away, more the closer it gets: you look into the cells there.
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
      draw(cam, dpr);
      if (leaving) leaving(cam, dpr, { clear: false, keepAll: listShift?.leave ?? 0 });
      return;
    }
    // the cells: coarser while anything moves, sharp once it all stops
    const still = !anim && !moving() && !morph && !bang && !cellsFade && !flip && !opening && !pointers.size;
    cellsDraw({
      cam,
      dpr,
      key: cellsModel,
      model: MODEL_IDS[cellsModel],
      bounds: boundsOf(cellsModel),
      cut: cutDepth(),
      dim: Math.max(1 - cellsMix, opening?.now?.fade ?? 0, flipDim),
      fog: fogRange(),
      scale: Math.min(1, 1.25 / dpr) * (still ? 1 : 0.5),
    });
    // over them, the cards shrinking away, or the one card being opened
    // or found
    const only = opening ? opening.i : spot ? spot.i : -1;
    if (cellsMix < 1) draw(cam, dpr, { clear: false, keepAll: 1 - cellsMix });
    else if (only >= 0) draw(cam, dpr, { clear: false, only });
  }

  // the cell under a screen point: the name it belongs to, or -1
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
    cellsButton.setAttribute("aria-pressed", String(on));
    try {
      const url = new URL(location.href);
      if (on) url.searchParams.set("view", "cells");
      else url.searchParams.delete("view");
      history.replaceState(history.state, "", url);
    } catch {}
    if (on && !(await ensureCells(model))) {
      cellsOn = false;
      cellsButton.setAttribute("aria-pressed", "false");
      return;
    }
    if (on && !cellsOn) return;
    cellsModel = model;
    cellsFade = { from: cellsMix, to: on ? 1 : 0, t0: performance.now() };
    request();
  }
  cellsButton.addEventListener("click", () => setCells(!cellsOn));

  /* —— the lists: Full, Best of, Short ——
     Switching keeps the names that are on both lists where they are; those
     leaving shrink away, the new ones grow in at their places. */

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
  // a click anywhere else, or Escape, closes it
  document.addEventListener("pointerdown", (e) => {
    if (!listMenu.hidden && !e.target.closest("[data-list-menu], [data-lists]")) toggleListMenu(false);
  });
  listMenu.addEventListener("keydown", (e) => {
    const all = [...listMenu.querySelectorAll("[data-list]")];
    const k = all.indexOf(document.activeElement);
    if (e.key === "Escape") {
      toggleListMenu(false);
      listButton.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(k + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length].focus();
    }
  });
  showListChoice();

  async function setList(key) {
    if (busy || key === listKey || !LISTS[key]) return;
    busy = true;
    dropSpot();
    marked = -1;
    mark.hidden = true;
    found = [];
    showResults();
    const before = listKey;
    listKey = key;
    showListChoice();
    try {
      const url = new URL(location.href);
      if (key === "default") url.searchParams.delete("list");
      else url.searchParams.set("list", key);
      url.searchParams.delete("c"); // that color may not be on this list
      history.replaceState(history.state, "", url);
    } catch {}

    // the cells fade while the other list loads
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
      // The names on both lists stay where they are. Those only on the old
      // one become cards of their own, which shrink away; those only on
      // the new one are marked to grow in.
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
      leaving = gone.length ? createRenderer(canvas, gonePos, goneCol) : null;
      useList(next, grow);
      draw.grow(0);
      listShift = { start: performance.now(), leave: 1 };
    } else {
      // the list it had stays
      status.textContent = `The ${LISTS[key]} list didn’t load. Check your connection.`;
      setTimeout(() => (status.hidden = true), 3000);
      listKey = before;
      showListChoice();
    }

    // the cells, if they were on, come back once they're worked out for
    // this list
    busy = false;
    if (cellsOn) {
      ensureCells(model).then((ok) => {
        if (ok && cellsOn) {
          cellsModel = model;
          cellsFade = { from: cellsMix, to: 1, t0: performance.now() };
          request();
        }
      });
    }
    request();
  }

  // everything that comes from the list, built again from another one
  function useList(next, grow) {
    list = next;
    items = next.items;
    n = items.length;
    colors = colorsOf(items);
    for (const cache of [placed, middles, bounds, wholeDist, cellsData, building]) {
      for (const k of Object.keys(cache)) delete cache[k];
    }
    positions = placeAll(model).slice();
    morph = null;
    spot = null;
    draw.dispose();
    draw = createRenderer(canvas, positions, colors, grow);
    cellsDraw?.dispose();
    cellsDraw = null;
    cellsMix = 0;
    for (const l of pool) l.i = -1;
    showCount();
  }

  // a model's cells, worked out the first time they're shown in it
  async function ensureCells(key) {
    if (cellsDraw?.has(key)) return true;
    status.textContent = "Working out each name’s part of the space…";
    status.hidden = false;
    try {
      cellsDraw ??= createCellsRenderer(draw.gl, canvas, colors, GEO);
      const data = await (building[key] ??= buildOwners(placeAll(key), boundsOf(key), CELL_REACH, (k) => {
        status.textContent = `Working out each name’s part of the space… ${Math.round(k * 100)}%`;
      }));
      if (!cellsDraw.has(key)) cellsDraw.add(key, data);
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

  /* —— the model: the same names, rearranged —— */

  function setModel(key) {
    if (key === model || !MODELS[key]) return;
    dropSpot();
    // the cells can't morph: they dip into the dark and come back reshaped
    // (worked out first, if they haven't been yet)
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
    // each shape has its own middle: turn round the new one
    if (!busy) flyTo(home(), MORPH_MS);
    showModel();
    try {
      const url = new URL(location.href);
      url.searchParams.set("model", key);
      history.replaceState(null, "", url);
    } catch {}
    request();
  }

  // the black pill slides under the chosen model
  const thumb = document.createElement("span");
  thumb.className = "wall__models-thumb";
  thumb.setAttribute("aria-hidden", "true");
  function showModel() {
    picker.querySelectorAll("[data-model]").forEach((b) => {
      const on = b.dataset.model === model;
      b.setAttribute("aria-pressed", String(on));
      if (on) {
        thumb.style.setProperty("--x", `${b.offsetLeft}px`);
        thumb.style.setProperty("--w", `${b.offsetWidth}px`);
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
    })
  );
  showModel();
  // its size follows the buttons' (fonts loading, the phone layout)
  new ResizeObserver(showModel).observe(picker);

  /* —— search: a name, or a hex and the name closest to it —— */

  let found = [];
  let active = 0;

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

  function find(text) {
    const hex = normalizeHex(text);
    if (hex) {
      const i = nearest(hex);
      return [{ i, note: items[i].hex === hex ? "" : `closest to ${hex}` }];
    }
    const t = text.trim().toLowerCase();
    if (t.length < 2) return [];
    const starts = [];
    const within = [];
    for (let i = 0; i < n && starts.length < 8; i++) {
      const at = items[i].lower.indexOf(t);
      if (at === 0) starts.push({ i });
      else if (at > 0 && within.length < 8) within.push({ i });
    }
    return [...starts, ...within].slice(0, 8);
  }

  function showResults() {
    results.replaceChildren(
      ...found.map(({ i, note }, k) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wall__result";
        b.setAttribute("aria-selected", String(k === active));
        b.innerHTML = `<i class="wall__result-swatch"></i><span class="wall__result-name"></span><span class="wall__result-hex"></span>`;
        b.firstChild.style.background = items[i].hex;
        b.children[1].textContent = items[i].name;
        b.children[2].textContent = note || items[i].hex;
        b.addEventListener("click", () => pick(k));
        li.append(b);
        return li;
      })
    );
    results.hidden = !found.length;
  }

  function pick(k) {
    if (!found[k] || busy) return;
    focusCard(found[k].i);
    found = [];
    showResults();
  }

  // the × at the end of the field: shown while there's something in it
  const clearButton = q("[data-clear]");
  const showClear = () => (clearButton.hidden = !search.value);
  clearButton.addEventListener("click", () => {
    search.value = "";
    found = [];
    showResults();
    showClear();
    dropSpot();
    search.focus();
  });

  search.addEventListener("input", () => {
    showClear();
    found = find(search.value);
    active = 0;
    showResults();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!found.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
      showResults();
    } else if (e.key === "Escape") {
      search.value = "";
      showClear();
      found = [];
      showResults();
      search.blur();
    }
  });
  // the color circle: pick any color, fly to the name closest to it; while
  // the picker is being dragged, only every so often
  let pickTimer = 0;
  colorPicker.addEventListener("input", () => {
    clearTimeout(pickTimer);
    pickTimer = setTimeout(() => !busy && focusCard(nearest(colorPicker.value)), 180);
  });

  q("[data-find]").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!found.length) found = find(search.value);
    pick(active);
  });
  results.hidden = true;

  // a handle for poking at the camera in development
  if (import.meta.env.DEV) {
    window.__wall = {
      cam,
      state: () => ({ anim: !!anim, moving: moving(), idle, busy, marked, open: !!colorPage, list: listKey, n }),
      open: (hex) => open(nearest(hex)),
      // where the card closest to a hex is drawn right now
      box: (hex) => drawnBox(nearest(hex)),
      nearest: (hex) => items[nearest(hex)],
      // where the card closest to a hex hangs in the space
      at: (hex) => posOf(nearest(hex)),
      cellAt: (x, y) => cellAt(x, y),
      cardAt: (x, y) => { const i = cardAt(x, y); return i < 0 ? null : items[i]; },
    };
  }

  /* —— start —— */

  const saveable = () => ({ target: cam.target, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist });
  addEventListener("pagehide", () => {
    if (busy) return; // opening a card saved the view from before the click
    try {
      sessionStorage.setItem("wall-camera", JSON.stringify(saveable()));
    } catch {}
  });

  const start = normalizeHex(new URLSearchParams(location.search).get("c") || "");
  // The camera is kept only for coming back from a color page (Back, or
  // its ×); a reload or a fresh visit starts over, with the burst.
  const nav = performance.getEntriesByType("navigation")[0]?.type;
  let fromColorPage = false;
  try {
    fromColorPage = /\/color\/$/.test(new URL(document.referrer).pathname);
  } catch {}
  let saved = null;
  if (nav === "back_forward" || (nav === "navigate" && fromColorPage)) {
    try {
      saved = JSON.parse(sessionStorage.getItem("wall-camera"));
    } catch {}
  }

  if (saved && Number.isFinite(saved.dist) && saved.target?.length === 3) {
    // coming back from a color page: where we were, still
    Object.assign(cam, saved);
    if (new URLSearchParams(location.search).get("view") === "cells") setCells(true);
    idle = false;
    if (start) {
      marked = nearest(start);
      spot = { i: marked, on: true, t: performance.now() };
    }
    request();
  } else {
    // the big bang: every card bursts out of the middle of the shape, past
    // its place and back into it; then a slow turn, or, with a color in the
    // address (?c=), a flight to it
    const h = home();
    const startCells = new URLSearchParams(location.search).get("view") === "cells";
    const then = () => {
      if (start) focusCard(nearest(start));
      else idle = !reduceMotion;
      if (startCells) setCells(true);
    };
    if (reduceMotion) {
      Object.assign(cam, h);
      update();
      then();
    } else {
      // the camera starts in the middle of it and pulls back as they fly out
      Object.assign(cam, { ...h, dist: h.dist * 0.07, yaw: cam.yaw - 0.6 });
      update();
      flyTo(h, BANG_MS);
      bang = { start: performance.now(), center: h.target, then };
      busy = true; // nothing to click until they've landed
    }
    request();
  }
}
