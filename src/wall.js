import {
  getList,
  LISTS,
  normalizeHex,
  fold,
  colorURL,
  siteURL,
  slugsOf,
  hexToRgb,
  rgbToOklab,
  cardPlace,
  UNNAMED,
  showVersion,
} from "./names.js";
import { buildOwners, createCellsRenderer, pick as pickCell, MODEL_IDS } from "./cells.js";
import { createLabelRenderer } from "./labels-gl.js";
import { loadAdoptions } from "./shines.js";
import { createSparkleRenderer } from "./sparkles-gl.js";
import { createAz } from "./az.js";

const CARD_W = 1;
const CARD_H = 1.3; // square swatch over a 0.3 label strip
// a short list's cards grow, so a handful don't drown in the space: as big as the
// Short list's cards would be at the same density, up to 8 times
let W = CARD_W;
let H = CARD_H;
const cardScale = (n) => Math.min(8, Math.max(1, Math.cbrt(3087 / Math.max(n, 1))));
const LY = 180; // lightness → world height
const R = 100;

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
  // the cube stood on its black corner, white straight above
  rgb: {
    label: "RGB",
    place: (it) => {
      const [r, g, b] = it.rgb.map((v) => v / 255 - 0.5);
      return [((r - g) / ROOT2) * RGB_SIDE, ((r + g + b) / ROOT3) * RGB_SIDE, ((r + g - 2 * b) / ROOT6) * RGB_SIDE];
    },
  },
  oklab: {
    label: "OKLab",
    place: (it) => [it.a * LY, (it.L - 0.5) * LY, -it.b * LY],
  },
  // lightness as the radius, chroma as the height
  oklch: {
    label: "OKLCH",
    place: (it) =>
      polar(
        (Math.atan2(it.b, it.a) * 180) / Math.PI,
        it.L * R * 1.2,
        (Math.hypot(it.a, it.b) / 0.32) * LY * 0.55 - LY * 0.25,
      ),
  },
  hsl: {
    label: "HSL",
    place: (it) => {
      const [h, s, l] = hsl(it.rgb);
      return polar(h, s * (l < 0.5 ? l : 1 - l) * 2 * R, (l - 0.5) * LY);
    },
  },
};
const DEFAULT_MODEL = "rgb";
const GEO = { LY, R, RGB_SIDE }; // cells.js undoes MODELS' placing with these
// the name map's "unnamed" distance, in wall units
const CELL_REACH = UNNAMED * LY;

const FOV = (42 * Math.PI) / 180;
const NEAR = 0.3;
const FAR = 3000;
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
const NEAR_SLOTS = 16;
// the pixel art atlas: sheets of 4,096 tiles, 16 × 16 each (see art-colors-runner/pixel)
const PIXEL_SHEETS = 8;
// from the bucket; a local preview can't read it (CORS), so it's served its own copy
const PIXEL_FROM = location.hostname === "localhost" ? siteURL("") : "https://media.color.pizza/";
const PIXEL_ATLAS = `${PIXEL_FROM}pixel-atlas/`;
const PIXEL_TILES = location.hostname === "localhost" ? `${PIXEL_FROM}pixel-tiles/` : `${PIXEL_FROM}pixel/`;
const DETAIL_SLOTS = 1024;
// a card's name strip slides out under it, then its name fades in
const STRIP_MS = 200;
// names come out from the middle of the view: the edge this much later
const STRIP_SPREAD_MS = 350;
// camera speed (share of its distance moved, plus radians turned, per second) past which
// names stay away until it has been slower for CALM_MS
const RUSH = 1.2;
const FLY_KEYS = {
  w: "forward",
  s: "back",
  a: "left",
  d: "right",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  ArrowUp: "turnUp",
  ArrowDown: "turnDown",
};
const CALM_MS = 160;
// the cards in front of a hovered one make way after HOVER_WAIT, over HOVER_MS
const HOVER_WAIT = 140;
const HOVER_MS = 220;
const FOCUS_PX = 230;

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
// an angle into -π…π
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(...a));
const lerp3 = (a, b, k) => add(a, scale(sub(b, a), k));

const VERT = `#version 300 es
in vec2 a_corner;
in vec3 a_pos;
in vec3 a_color;
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;   // focal length in device px
uniform vec2 u_view;
uniform vec2 u_size;
uniform vec2 u_clip;   // near, far
uniform vec2 u_fog;    // depth where the fog starts, ends (from the eye)
uniform int u_focus;
uniform vec3 u_focusPos;
uniform float u_repel;
uniform float u_fade;
uniform float u_clear;
uniform bool u_handed; // the focused card is now drawn by its HTML copy
uniform float u_bang;
uniform vec3 u_bangCenter;
in float a_grow;
in float a_strip;  // how far its name strip is out, 0 for a plain swatch
in float a_star;   // how bright an adopted color flashes now, like glitter catching the light
in float a_slot;   // where its pixel art is in the atlas, -1 for none
in float a_detail; // where its full-size pixel art is, once it came close, -1 till then
uniform float u_grow;
uniform int u_only;
uniform float u_keepAll;
out vec2 v_local;
out vec3 v_color;
out float v_cardpx;
out float v_fog;
out float v_near;
out float v_strip;
out float v_star;
flat out float v_slot;
flat out float v_detail;
uniform int u_hover;            // the hovered card: the ones in front of it make way
uniform vec3 u_hoverPos;
uniform float u_hoverClear;
uniform float u_nearAt;          // card width over the screen's short side past which it's gone
uniform int u_nearIds[${NEAR_SLOTS}];   // the cards fading in or out right now
uniform float u_nearAlpha[${NEAR_SLOTS}];
void main() {
  vec3 pos = a_pos;
  float keep = 1.0;
  if (u_focus >= 0 && gl_InstanceID != u_focus) {
    vec3 d = a_pos - u_focusPos;
    float len = length(d) + 0.001;
    // across the screen, not toward the eye, so nothing sweeps past the camera
    vec3 across = d - u_fwd * dot(d, u_fwd);
    float wide = length(across) + 0.001;
    pos += across / wide * u_repel * (4.0 + 30.0 * exp(-len / 24.0));
    keep = 1.0 - u_fade;
    // clear the cards between the eye and the focused one
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
  // the burst ripples by lightness, lightest first, with a little jitter
  float born = 1.0;
  if (u_bang >= 0.0) {
    float h = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
    float light = dot(a_color, vec3(0.2126, 0.7152, 0.0722));
    float t = clamp((u_bang - (1.0 - light) * 0.4 - h * 0.08) / 0.52, 0.0, 1.0);
    float c1 = 2.4, c3 = c1 + 1.0, u = t - 1.0;
    float out_ = 1.0 + c3 * u * u * u + c1 * u * u; // easeOutBack
    pos = mix(u_bangCenter, pos, out_);
    born = smoothstep(0.0, 0.45, t);
    keep *= born;
  }
  keep *= mix(1.0, u_grow, a_grow);
  if (u_only >= 0 && gl_InstanceID != u_only) keep = 0.0;
  if (gl_InstanceID != u_focus) keep *= u_keepAll;
  if (u_handed && gl_InstanceID == u_focus) keep = 0.0;
  v_star = a_star;
  v_slot = a_slot;
  v_detail = a_detail;
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
  // the focused card is always in front
  if (u_focus >= 0 && gl_InstanceID == u_focus) gl_Position.z = -z;
  v_color = a_color;
  v_cardpx = u_size.x / px;
  v_fog = max(smoothstep(u_fog.x, u_fog.y, z), 1.0 - born);
  // a card about to fill the screen dissolves, so the camera passes through it
  float near = v_cardpx / min(u_view.x, u_view.y) > u_nearAt ? 0.0 : 1.0;
  for (int k = 0; k < ${NEAR_SLOTS}; k++) if (u_nearIds[k] == gl_InstanceID) near = u_nearAlpha[k];
  if (u_hover >= 0 && gl_InstanceID != u_hover && u_hoverClear > 0.0) {
    vec3 vh = u_hoverPos - u_eye;
    float zh = dot(vh, u_fwd);
    if (z > 0.0 && z < zh) {
      vec2 d = abs(vec2(dot(v, u_right), dot(v, u_up)) / z - vec2(dot(vh, u_right), dot(vh, u_up)) / zh);
      vec2 reach = u_size * 0.5 * (1.0 / z + 1.0 / zh);
      if (d.x < reach.x && d.y < reach.y) near *= 1.0 - u_hoverClear;
    }
  }
  v_near = gl_InstanceID == u_focus || gl_InstanceID == u_only ? 1.0 : near;
  v_strip = gl_InstanceID == u_focus ? 1.0 : a_strip;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
in float v_cardpx;
in float v_fog;
in float v_near;
in float v_strip;
in float v_star;
flat in float v_slot;
flat in float v_detail;
uniform vec2 u_size;
uniform highp sampler2DArray u_atlas; // pixel art, 64 × 64 tiles to a layer
uniform float u_pixel;                // 0 the colors, 1 their pixel art
uniform highp sampler2D u_detail;     // full-size pixel art of the cards close by, 32 × 32 tiles
uniform int u_sheets;                 // which of the atlas's sheets have come, a bit each
out vec4 o;
void main() {
  // dithered, so it fades without sorting the cards
  if (v_near < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= v_near) discard;
  if (v_local.x < 0.0 || v_local.y < 0.0 || v_local.x > u_size.x || v_local.y > u_size.y) discard;
  if (v_local.y > u_size.x + (u_size.y - u_size.x) * v_strip) discard;
  // far cards are solid color, so the space reads as a cloud
  vec3 paper = mix(v_color, vec3(1.0), smoothstep(10.0, 34.0, v_cardpx));
  vec3 c = v_local.y < u_size.x ? v_color : paper;
  // its pixel art over the color, where there is any and its sheet has come
  // its pixel art instead of the color, once its sheet has come: the color goes, and only
  // the drawing is left, floating
  if (u_pixel > 0.0 && v_slot >= 0.0 && v_local.y < u_size.x) {
    vec2 inTile = clamp(v_local / u_size.x, 0.0, 0.999);
    float layer = floor(v_slot / 4096.0);
    bool there = v_detail >= 0.0 || ((u_sheets >> int(layer)) & 1) == 1;
    if (there) {
      vec4 t;
      if (v_detail >= 0.0) {
        t = texture(u_detail, (vec2(mod(v_detail, 32.0), floor(v_detail / 32.0)) + inTile) / 32.0);
      } else {
        float k = v_slot - layer * 4096.0;
        t = texture(u_atlas, vec3((vec2(mod(k, 64.0), floor(k / 64.0)) + inTile) / 64.0, layer));
      }
      if (t.a < 0.4 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < u_pixel) discard;
      c = mix(c, t.rgb, t.a * u_pixel);
    }
  }
  if (v_star > 0.001) {
    // the card lights up, with a four-pointed glint near its corner
    vec2 q = (v_local - vec2(u_size.x * 0.8, u_size.x * 0.2)) / u_size.x;
    float glint = exp(-abs(q.x) * 70.0) * exp(-abs(q.y) * 9.0) + exp(-abs(q.y) * 70.0) * exp(-abs(q.x) * 9.0);
    vec3 light = mix(v_color / max(max(v_color.r, v_color.g), max(v_color.b, 0.001)), vec3(1.0), 0.6);
    c = mix(c, light, clamp(v_star * (0.35 + glint), 0.0, 1.0));
  }
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
    gl.bufferData(gl.ARRAY_BUFFER, array, ["a_pos", "a_strip", "a_star"].includes(name) ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(loc, divisor);
  };
  attrib("a_corner", new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2, gl.FLOAT, false, 0);
  attrib("a_pos", positions, 3, gl.FLOAT, false, 1);
  attrib("a_color", colors, 3, gl.UNSIGNED_BYTE, true, 1);
  attrib("a_grow", grow, 1, gl.UNSIGNED_BYTE, false, 1);
  const strips = new Float32Array(positions.length / 3);
  attrib("a_strip", strips, 1, gl.FLOAT, false, 1);
  const stars = new Float32Array(positions.length / 3);
  attrib("a_star", stars, 1, gl.FLOAT, false, 1);
  attrib("a_slot", new Float32Array(positions.length / 3).fill(-1), 1, gl.FLOAT, false, 1);
  attrib("a_detail", new Float32Array(positions.length / 3).fill(-1), 1, gl.FLOAT, false, 1);
  // the pixel art atlas: empty (clear) until its sheets come
  const atlas = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 11, gl.RGBA8, 1024, 1024, PIXEL_SHEETS);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // and the full-size tiles of the cards close by, swapped in and out as they come and go
  const detail = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, detail);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 2048, 2048);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);

  const u = {};
  for (const k of [
    "eye",
    "right",
    "up",
    "fwd",
    "fpx",
    "view",
    "size",
    "clip",
    "fog",
    "focus",
    "focusPos",
    "repel",
    "fade",
    "clear",
    "handed",
    "bang",
    "bangCenter",
    "only",
    "keepAll",
    "grow",
    "nearAt",
    "nearIds",
    "nearAlpha",
    "hover",
    "hoverPos",
    "hoverClear",
    "atlas",
    "pixel",
    "detail",
    "sheets",
  ]) {
    u[k] = gl.getUniformLocation(prog, `u_${k}`);
  }
  gl.uniform1f(u.nearAt, 1e9);
  gl.uniform1i(u.hover, -1);
  gl.uniform1iv(u.nearIds, new Int32Array(NEAR_SLOTS).fill(-1));
  gl.uniform2f(u.size, W, H);
  gl.uniform2f(u.clip, NEAR, FAR);
  gl.uniform1i(u.focus, -1);
  gl.uniform1f(u.bang, -1);
  gl.uniform1f(u.grow, 1);
  gl.uniform1i(u.atlas, 1);
  gl.uniform1i(u.detail, 2);
  gl.uniform1i(u.sheets, 0);
  gl.uniform1f(u.pixel, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 1);

  const count = positions.length / 3;
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
    // fog from the shape's middle, so it doesn't shift as the camera turns
    const mid = Math.hypot(...sub(cam.center, cam.eye));
    gl.uniform2f(u.fog, Math.max(0, mid) + 60, mid + 420);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detail);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };
  draw.bang = (t, center) => {
    gl.useProgram(prog);
    gl.uniform1f(u.bang, t);
    if (center) gl.uniform3fv(u.bangCenter, center);
  };
  draw.grow = (k) => {
    gl.useProgram(prog);
    gl.uniform1f(u.grow, k);
  };
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
  // pixel art: which tile each card has, a sheet of tiles as it comes, how far it shows
  draw.pixelSlots = (slots) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_slot);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, slots);
  };
  let sheets = 0;
  draw.pixelSheet = (layer, image) => {
    gl.useProgram(prog);
    gl.uniform1i(u.sheets, (sheets |= 1 << layer));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 1024, 1024, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.activeTexture(gl.TEXTURE0);
  };
  draw.pixelDetail = (slot, image) => {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detail);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot % 32) * 64, Math.floor(slot / 32) * 64, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.activeTexture(gl.TEXTURE0);
  };
  draw.pixelDetailOf = (i, slot) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_detail);
    gl.bufferSubData(gl.ARRAY_BUFFER, i * 4, new Float32Array([slot]));
  };
  draw.pixelMix = (k) => {
    gl.useProgram(prog);
    gl.uniform1f(u.pixel, k);
  };
  draw.dispose = () => {
    gl.deleteTexture(atlas);
    gl.deleteTexture(detail);
    Object.values(buffers).forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(vao);
    gl.deleteProgram(prog);
  };
  draw.near = (at, ids, alphas) => {
    gl.useProgram(prog);
    gl.uniform1f(u.nearAt, at);
    gl.uniform1iv(u.nearIds, ids);
    gl.uniform1fv(u.nearAlpha, alphas);
  };
  draw.hover = (i, pos, clear) => {
    gl.useProgram(prog);
    gl.uniform1i(u.hover, i);
    if (pos) gl.uniform3fv(u.hoverPos, pos);
    gl.uniform1f(u.hoverClear, clear);
  };
  draw.strips = strips;
  draw.star = (i, flash) => {
    stars[i] = flash;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_star);
    gl.bufferSubData(gl.ARRAY_BUFFER, i * 4, stars, i, 1);
  };
  draw.uploadStrips = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_strip);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, strips);
  };
  draw.move = (array) => {
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, array);
  };
  return draw;
}

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
  const clearButton = q("[data-clear]");
  const results = q("[data-results]");
  const intro = q("[data-intro]");

  let introWanted = true;
  try {
    introWanted = !localStorage.getItem("wall-intro-seen");
  } catch {}
  q("[data-intro-close]").addEventListener("click", () => {
    intro.hidden = true;
    try {
      localStorage.setItem("wall-intro-seen", "1");
    } catch {}
  });

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
  W = CARD_W * cardScale(n);
  H = CARD_H * cardScale(n);
  const showCount = () =>
    root.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = n.toLocaleString("en-US");
    });
  showCount();
  if (introWanted) intro.hidden = false;

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
  // the names in the 3D view; without them the HTML labels stay
  let texts = null;
  let textsFor = draw;
  try {
    texts = createLabelRenderer(draw.gl, { W: CARD_W, H: CARD_H, NEAR, FAR, NEAR_SLOTS });
    texts.scale = cardScale(n);
  } catch (e) {
    console.error(e);
  }
  const textInGL = () => texts && !opening && !spot && cellsMix <= 0 && !morph && !bang && !listShift;
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
  // ↑ ↑ ↓ ↓ ← → ← → B A: the space in pixel art. The atlas comes when first asked for, its
  // sheets one by one, each card its color until its sheet is in
  const pixelArt = { on: false, k: 0, index: null, slots: null, sheets: [], loading: null };
  async function pixelSlots() {
    const { index } = pixelArt;
    pixelArt.bySlug ??= new Map(index.slugs.map((slug, i) => [slug, i]));
    pixelArt.names ??= slugsOf((await getList("default")).items);
    const slots = new Float32Array(items.length);
    items.forEach((it, i) => (slots[i] = pixelArt.bySlug.get(pixelArt.names.get(it.name)) ?? -1));
    return slots;
  }
  async function loadPixelArt() {
    pixelArt.index = await fetch(`${PIXEL_ATLAS}index.json`).then((r) => r.json());
    pixelArt.slots = await pixelSlots();
    draw.pixelSlots(pixelArt.slots);
    await Promise.all(
      Array.from({ length: pixelArt.index.sheets }, async (_, n) => {
        const blob = await fetch(`${PIXEL_ATLAS}sheet-${n}.webp`).then((r) => r.blob());
        pixelArt.sheets[n] = await createImageBitmap(blob, { premultiplyAlpha: "none" });
        draw.pixelSheet(n, pixelArt.sheets[n]);
        request();
      }),
    );
  }
  // close up, every card bigger than DETAIL_PX on screen gets its full 64 × 64 tile, the
  // nearest first, a dozen fetched at a time; looked for a few times a second, whatever
  // the names do. When all slots are taken, the card seen longest ago gives its up
  const DETAIL_PX = 22;
  const detail = { of: new Map(), owner: new Int32Array(DETAIL_SLOTS).fill(-1), seen: new Float64Array(DETAIL_SLOTS), loading: new Set(), queue: [], busy: 0, round: 0, looked: 0 };
  function lookForDetail(time) {
    if (!pixelArt.on || !pixelArt.slots) return;
    // too soon: look once more after, in case the camera stops right now
    if (time - detail.looked < 120) {
      detail.later ||= setTimeout(() => {
        detail.later = 0;
        request();
      }, 130);
      return;
    }
    detail.looked = time;
    const queue = [];
    for (const { i } of onScreen(DETAIL_PX, DETAIL_SLOTS / 2)) {
      const slot = detail.of.get(i);
      if (slot !== undefined) detail.seen[slot] = time;
      else if (!detail.loading.has(i) && pixelArt.slots[i] >= 0) queue.push(i);
    }
    detail.queue = queue;
    fetchDetail();
  }
  function fetchDetail() {
    while (detail.busy < 12 && detail.queue.length) {
      const i = detail.queue.shift();
      detail.loading.add(i);
      const slug = pixelArt.index.slugs[pixelArt.slots[i]];
      const round = detail.round;
      detail.busy++;
      fetch(`${PIXEL_TILES}${slug}.png`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((blob) => createImageBitmap(blob, { premultiplyAlpha: "none" }))
        .then((image) => {
          if (round !== detail.round) return;
          let slot = detail.owner.indexOf(-1);
          if (slot < 0) {
            slot = 0;
            for (let k = 1; k < DETAIL_SLOTS; k++) if (detail.seen[k] < detail.seen[slot]) slot = k;
            const was = detail.owner[slot];
            detail.of.delete(was);
            draw.pixelDetailOf(was, -1);
          }
          detail.owner[slot] = i;
          detail.of.set(i, slot);
          detail.seen[slot] = performance.now();
          draw.pixelDetail(slot, image);
          draw.pixelDetailOf(i, slot);
          request();
        })
        .catch(() => {})
        .finally(() => {
          detail.loading.delete(i);
          detail.busy--;
          fetchDetail();
        });
    }
  }
  // a new list builds a new renderer: it gets the slots and sheets back, the close ones anew
  async function restorePixelArt() {
    if (!pixelArt.index) return;
    detail.round++;
    detail.of.clear();
    detail.loading.clear();
    detail.queue = [];
    detail.owner.fill(-1);
    pixelArt.slots = await pixelSlots();
    draw.pixelSlots(pixelArt.slots);
    pixelArt.sheets.forEach((sheet, n) => sheet && draw.pixelSheet(n, sheet));
    draw.pixelMix(pixelArt.k);
    request();
  }
  function togglePixelArt() {
    pixelArt.on = !pixelArt.on;
    if (pixelArt.on) pixelArt.loading ??= loadPixelArt().catch((e) => console.error(e));
    const from = pixelArt.k;
    const to = pixelArt.on ? 1 : 0;
    const start = performance.now();
    const step = (now) => {
      const t = reduceMotion ? 1 : Math.min(1, (now - start) / 600);
      pixelArt.k = from + (to - from) * t * t * (3 - 2 * t);
      draw.pixelMix(pixelArt.k);
      request();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konami = 0;
  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami < KONAMI.length) return;
    konami = 0;
    togglePixelArt();
  });

  function markStars() {
    glitter = [];
    items.forEach((it, i) => adoptedNames.has(it.name) && glitter.push({ i, cell: null, at: -1e9, rest: 0, flash: 0, turn: 0 }));
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
      const facet = Math.floor(((v[0] * a[0] + v[1] * a[1] + v[2] * a[2]) / len) * 24 + ((v[0] * a[2] - v[2] * a[0]) / len) * 15 + Math.log(len) * 6);
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
    adoptedNames = new Set(Object.entries(adopted).filter(([, a]) => a.amount >= 5).map(([slug]) => names.get(slug)));
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

  function onScreen(minPx = 0, limit = Infinity) {
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
      if (sp && i !== sp.i && z < sp.z && Math.abs(x - sp.x) < hw + sp.hw && Math.abs(y - sp.y) < hh + sp.hh) continue;
      if (x + hw < 0 || x - hw > view.w || y + hh < 0 || y - hh > view.h) continue;
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
    for (const [i, f] of fading) {
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

  function cardAt(sx, sy) {
    if (spot?.on) {
      const b = drawnBox(spot.i);
      if (Math.abs(sx - b.x) <= b.w / 2 && Math.abs(sy - b.y) <= (b.w * H) / 2) return spot.i;
    }
    if (cellsMix > 0.5) return cellAt(sx, sy);
    // the hovered card keeps the mouse while the cards in front of it are away
    if (clearing.i >= 0 && clearing.v > 0) {
      const p = project(posOf(clearing.i));
      if (Math.abs(sx - p.x) <= (W / 2) * p.s && Math.abs(sy - p.y) <= (H / 2) * p.s) return clearing.i;
    }
    for (const c of onScreen()) {
      if (c.near > 0.5 && sx >= c.x0 && sx <= c.x1 && sy >= c.y0 && sy <= c.y1) return c.i;
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
  const held = new Set();
  const letGo = () => held.clear();
  window.addEventListener("keyup", (e) => held.delete(FLY_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]));
  window.addEventListener("blur", letGo);
  // per 16 ms a key is held, fed into the same eased motion as the mouse
  function fly(dt) {
    const k = dt / 16;
    if (held.has("forward")) delta.zoom -= 0.025 * k;
    if (held.has("back")) delta.zoom += 0.025 * k;
    if (held.has("left")) pan(14 * k, 0);
    if (held.has("right")) pan(-14 * k, 0);
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
    lookForDetail(time);

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
      setAway(true);
      // damped like three.js OrbitControls
      const f = reduceMotion ? 1 : 1 - Math.pow(1 - DAMPING, dt / 16.7);
      cam.yaw += delta.yaw * f;
      cam.pitch += delta.pitch * f;
      cam.target = add(cam.target, scale(delta.pan, f));
      zoomBy(Math.exp(delta.zoom * f));
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
    // while a card opens or comes back, only it keeps its name; the rest fold theirs away
    const stripping = opening
      ? trackStrips(time, new Set([opening.i]))
      : textInGL()
        ? trackStrips(time, texts.ready)
        : false;
    const glittering = trackGlitter(time);
    render(time);
    placeLabels();
    placeMark();
    if (anim || moving() || idle || morph || opening || spot || bang || cellsFade || flip || listShift || fadingNear || stripping || rushing || clearingWay || held.size || glittering) request();
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
    const near = opening
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

  function flyTo(to, duration = 1100, done, easing = ease) {
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

  function focusCard(i) {
    marked = i;
    spot = { i, on: true, t: performance.now() };
    flyTo({ target: posOf(i), dist: distFor(FOCUS_PX) });
  }

  // the color asked for: the search's dot, its × and the address all follow it
  let chosen = null;
  let chosenText = "";
  function choose(hex, text) {
    chosen = hex;
    if (hex) colorPicker.value = hex;
    colorPicker.parentElement.style.background = hex || "";
    if (text !== undefined) search.value = text;
    chosenText = search.value;
    showClear();
    try {
      const url = new URL(location.href);
      if (hex) url.searchParams.set("c", hex.slice(1));
      else url.searchParams.delete("c");
      history.replaceState(history.state, "", url);
    } catch {}
  }
  const showClear = () => (clearButton.hidden = !search.value && !chosen);

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

  function drawnBox(i) {
    const p = project(posOf(i));
    return { x: p.x, y: p.y, w: W * p.s };
  }

  const pageCardWidth = () => clamp(view.w * 0.21, 208, 384);

  let pending = null;
  let slugs = null;
  // the closest name's own address, so a copied link previews; the hash keeps the color
  const toOwnURL = (it, hex = it.hex) => {
    if (!import.meta.env.PROD) return;
    slugs ??= getList("default").then((d) => slugsOf(d.items));
    slugs.then((s) => {
      const slug = s.get(it.name);
      if (slug && location.hash === `#${hex.slice(1)}`)
        history.replaceState(history.state, "", `${new URL(`${slug}/`, colorPageURL).href}#${hex.slice(1)}`);
    });
  };

  // the view a color page's close leads back to: model, list, A–Z or cells, all in the address
  function rememberView() {
    try {
      sessionStorage.setItem("wall-view", JSON.stringify({ href: location.href, at: Date.now() }));
    } catch {}
  }

  function open(i) {
    if (busy) return;
    busy = true;
    marked = -1;
    mark.hidden = true;
    tip.hidden = true;
    const it = items[i];
    const before = saveable();
    const task = (pending = { i, before, c: null, cancelled: false });
    spot = null;
    rememberView();
    // push now, so Back at any point on the way in returns to the wall
    history.pushState({ colorDepth: 1 }, "", colorURL(it.hex));
    toOwnURL(it);

    root.classList.add("is-opening");
    opening = { i, pos: posOf(i), t0: performance.now(), handed: false };
    zoomInto(i, pageCardWidth(), IN.fly);

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
        // the address is already the color page's, so load it on its own
        console.error(e);
        location.reload();
      }
    });
  }

  const later = (ms, fn) => setTimeout(fn, reduceMotion ? 0 : ms);

  let colorPage = null;
  let colorMarkup = null;
  // resolve now: once a card is opening, the address is the color page's
  const colorPageURL = siteURL("color/");
  const loadColorPage = () =>
    (colorMarkup ??= fetch(colorPageURL)
      .then((r) => r.text())
      .then((html) => new DOMParser().parseFromString(html, "text/html").querySelector("main")));
  const loadDetail = () => import("./detail.js");
  setTimeout(() => {
    loadColorPage().catch(() => (colorMarkup = null));
    loadDetail().catch(() => {});
  }, 1500);

  const wallTitle = document.title;
  const wallIcon = document.querySelector('link[rel="icon"]').href;

  async function showColorPage(hex, returnTo, copy, task) {
    const [main, detail] = await Promise.all([loadColorPage(), loadDetail()]);
    if (task.cancelled) return;
    pending = null;
    const layer = document.createElement("div");
    layer.className = "wall__page";
    layer.append(document.importNode(main, true));
    // links on the color page are relative to color/, the address may be color/<name>/
    for (const a of layer.querySelectorAll("a[href]")) a.href = new URL(a.getAttribute("href"), colorPageURL).href;
    for (const img of layer.querySelectorAll("img[src]")) img.src = new URL(img.getAttribute("src"), colorPageURL).href;
    document.documentElement.dataset.root = new URL("../", colorPageURL).href;
    root.append(layer);
    const controller = new AbortController();
    colorPage = { layer, controller, returnTo, hex, depth: 1 };
    detail.initDetailPage(layer, {
      embedded: true,
      signal: controller.signal,
      // back past every color visited since
      onClose: () => history.go(-colorPage.depth),
    });
    requestAnimationFrame(() => copy.remove());
  }

  // each neighbor visited is one more history entry
  addEventListener("hashchange", () => {
    if (!colorPage) return;
    colorPage.hex = normalizeHex(location.hash.slice(1)) || colorPage.hex;
    if (history.state?.colorDepth == null) {
      history.replaceState({ colorDepth: colorPage.depth + 1 }, "");
    }
    colorPage.depth = history.state.colorDepth;
    // a color picked on the page: its name in the address too
    toOwnURL(items[nearest(colorPage.hex)], colorPage.hex);
  });

  function closeColorPage() {
    const page = colorPage;
    colorPage = null;
    document.querySelector('link[rel="icon"]').href = wallIcon;
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
    // hide the page's own card so no second one lingers on the fading page
    slot.style.visibility = "hidden";

    page.controller.abort();
    delete document.documentElement.dataset.root;
    document.documentElement.classList.remove("is-arriving");
    document.title = wallTitle;

    anim = null;
    Object.assign(cam, {
      target: posOf(i),
      dist: distFor(pageCardWidth()),
      yaw: page.returnTo.yaw,
      pitch: page.returnTo.pitch,
    });
    update();

    page.layer.classList.add("is-leaving");
    later(OUT.leave, () => page.layer.remove());
    returnCard(c, i, page.returnTo, { repel: 1, fade: 1, clear: 1 });
  }

  async function returnCard(c, i, returnTo, from) {
    opening = { i, pos: posOf(i), reverse: true, t0: performance.now(), handed: true, from };
    request();
    // show the copy in place for a frame before it moves
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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
    if (task.c) {
      returnCard(task.c, task.i, task.before, from);
    } else {
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
    draw.focus(-1, null, 0, 0);
    labels.hidden = false;
    root.querySelectorAll(".wall__handoff").forEach((el) => el.remove());
    request();
  }

  addEventListener("popstate", () => {
    const onColor = /\/color\/([^/]+\/)?$/.test(location.pathname);
    if (pending && !onColor) cancelOpening();
    else if (colorPage && !onColor) closeColorPage();
    // forward into a color page that's no longer open: load it
    else if (!colorPage && !pending && onColor) location.reload();
  });

  // back from bfcache
  addEventListener("pageshow", (e) => {
    if (e.persisted && !colorPage) resetOpening();
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
  // through instead of stopping
  function zoomBy(k) {
    const kk = clamp(k, MIN_DIST / cam.dist, MAX_DIST / cam.dist);
    cam.dist *= kk;
    if (k < kk) cam.target = add(cam.target, scale(cam.fwd, -Math.log(k / kk) * THROUGH));
    // never further out than a little past the shape
    const { lo, hi } = boundsOf(model);
    cam.target = cam.target.map((v, j) => clamp(v, lo[j] - 20, hi[j] + 20));
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
    const hit = i < 0 ? null : onScreen().find((c) => c.i === i) || { i, ...boxRect(drawnBox(i)) };
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
    tip.hidden = false;
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
  const goHome = () =>
    !busy &&
    flyTo(home(), 1000, () => {
      idle = !reduceMotion;
      request();
    });

  q(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    if (colorPage) history.go(-colorPage.depth);
    else goHome();
  });
  q("[data-home]").addEventListener("click", () => (azOn ? setAz(false) : goHome()));
  canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (cardAt(e.clientX - rect.left, e.clientY - rect.top) < 0) goHome();
  });

  // held keys fly the camera: W S forward and back, A D sideways, the arrows turn it.
  // Never while typing, nor with a modifier, so shortcuts stay the browser's
  const typing = (t) => t.closest?.("input, textarea, select, [contenteditable]");
  window.addEventListener("keydown", (e) => {
    if (busy || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = FLY_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (key && !e.target.closest?.("[role=menu], [role=tablist], [role=listbox]")) {
      e.preventDefault();
      if (!held.has(key)) {
        held.add(key);
        anim = null;
        stopIdle();
        dropSpot();
        setAway(true);
        request();
      }
      return;
    }
    if (e.target.closest?.("button, a")) return;
    if (e.key === "+" || e.key === "=") step(1 / 1.8)();
    else if (e.key === "-") step(1.8)();
    else if (e.key === "0" || e.key === "Home") goHome();
    else if (e.key === "/") {
      e.preventDefault();
      search.focus();
    }
  });

  const cellsButton = q("[data-cells]");
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
      if (!opening && !morph && !bang && !listShift) sparkles?.draw(cam, dpr, canvas, glitter.filter((g) => g.flash > 0), positions, colors);
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
        if (hoverI >= 0 && !rushing && cellsMix <= 0.5 && !named.some((c) => c.i === hoverI)) named.unshift({ i: hoverI });
        texts.draw(cam, dpr, canvas, named, items, positions, {
          at: NEAR_AT,
          ids: nearIds,
          alphas: nearAlphas,
          hover: clearing.i >= 0 ? { i: clearing.i, pos: posOf(clearing.i), clear: easeInOut(clearing.v) } : null,
        }, draw.strips);
      }
      if (leaving) leaving(cam, dpr, { clear: false, keepAll: listShift?.leave ?? 0 });
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
      dim: Math.max(1 - cellsMix, opening?.now?.fade ?? 0, flipDim),
      fog: fogRange(),
      scale: Math.min(1, 1.25 / dpr) * (still ? 1 : 0.5),
    });
    const only = opening ? opening.i : spot ? spot.i : -1;
    if (cellsMix < 1) draw(cam, dpr, { clear: false, keepAll: 1 - cellsMix });
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
  cellsButton.addEventListener("click", () => {
    if (azOn) setAz(false);
    setCells(!cellsOn);
  });

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

  // on a phone the models, lists and zoom sit behind this button
  const menuButton = q("[data-menu]");
  const menuOpen = () => menuButton.getAttribute("aria-expanded") === "true";
  const toggleMenu = (open = !menuOpen()) => menuButton.setAttribute("aria-expanded", String(open));
  menuButton.addEventListener("click", () => toggleMenu());
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen() && !e.target.closest("[data-menu], .wall__dock, .wall__zoom")) toggleMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !menuOpen() || !listMenu.hidden) return;
    toggleMenu(false);
    menuButton.focus();
  });

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
      history.replaceState(history.state, "", url);
    } catch {}
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
      status.textContent = `The ${LISTS[key]} list didn’t load. Check your connection.`;
      setTimeout(() => (status.hidden = true), 3000);
      listKey = before;
      showListChoice();
    }

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
    draw = createRenderer(canvas, positions, colors, grow);
    cellsDraw?.dispose();
    cellsDraw = null;
    cellsMix = 0;
    for (const l of pool) l.i = -1;
    showCount();
    markStars();
    restorePixelArt();
    if (azOn) az?.open(items, search.value, 0);
  }

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

  // A–Z: the list as one long column instead of the space; the model stays as it was
  let azOn = false;
  let az = null;
  // the list starts as far below the top bar's controls as they are below the top
  const placeAz = () => {
    const list = root.querySelector(".az__list");
    if (!list) return;
    const find = q("[data-find]").getBoundingClientRect();
    const onTop = find.top < innerHeight / 2;
    const top = onTop ? find : q("[data-menu]").getBoundingClientRect();
    list.style.setProperty("--az-top", `${Math.round(top.bottom + top.top)}px`);
    // and room at the end for whatever floats at the bottom: the models and lists, or the search
    const below = [q(".wall__dock"), onTop ? null : q("[data-find]")]
      .map((el) => el?.getBoundingClientRect())
      .filter((b) => b && b.height && b.top > innerHeight / 2);
    const lowest = below.length ? Math.min(...below.map((b) => b.top)) : innerHeight;
    const gap = below.length ? innerHeight - Math.max(...below.map((b) => b.bottom)) : 0;
    list.style.setProperty("--az-bottom", `${Math.round(innerHeight - lowest + gap)}px`);
    // names start under the parrot, hexes end under GitHub (on a phone, the menu)
    const box = list.getBoundingClientRect();
    const logo = q(".wall__brand .brand__logo")?.getBoundingClientRect();
    // the text's own edge, the last 0 of the version, not the link's padded box
    const textBox = (el) => {
      if (!el?.offsetWidth) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const end = textBox(q(".wall__nav a")) || q("[data-menu]").getBoundingClientRect();
    if (logo?.width) list.style.setProperty("--az-left", `${Math.round(logo.left - box.left)}px`);
    if (end) list.style.setProperty("--az-right", `${Math.max(8, Math.round(box.left + list.clientWidth - end.right))}px`);
  };
  addEventListener("resize", () => azOn && placeAz());

  // pages are named by the full list's slugs, whichever list is shown
  let azSlugs = null;
  // the chip, the address and the list follow at once; the list fills once its names are in
  function setAz(on, restore = null) {
    if (on === azOn) return;
    azOn = on;
    root.classList.toggle("is-az", on);
    root.scrollLeft = 0;
    showModel();
    try {
      const url = new URL(location.href);
      if (on) url.searchParams.set("view", "az");
      else if (url.searchParams.get("view") === "az") url.searchParams.delete("view");
      history.replaceState(history.state, "", url);
    } catch {}
    if (!on) {
      az?.close();
      return request();
    }
    found = [];
    showResults();
    if (restore?.text) {
      search.value = restore.text;
      showClear();
    }
    getList("default").then((full) => {
      if (!azOn) return;
      azSlugs ||= slugsOf(full.items);
      az ||= createAz(q(".wall__dock"), {
        hrefOf: (it) => siteURL(`color/${azSlugs.get(it.name)}/`),
        // where the list was, for coming back from the color page
        onLeave: (scroll, href) => {
          try {
            sessionStorage.setItem("az-view", JSON.stringify({ text: search.value, scroll, page: new URL(href).pathname, at: Date.now() }));
          } catch {}
        },
      });
      az.open(items, search.value, restore?.scroll);
      placeAz();
    });
  }

  function setModel(key) {
    if (azOn) setAz(false);
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
    try {
      const url = new URL(location.href);
      url.searchParams.set("model", key);
      history.replaceState(null, "", url);
    } catch {}
    request();
  }

  const thumb = document.createElement("span");
  thumb.className = "wall__models-thumb";
  thumb.setAttribute("aria-hidden", "true");
  function showModel() {
    picker.querySelectorAll("[data-model], [data-az]").forEach((b) => {
      const on = azOn ? b.hasAttribute("data-az") : b.dataset.model === model;
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
    Object.assign(document.createElement("button"), { type: "button", textContent: "A–Z", title: "Every name, A to Z", onclick: () => setAz(true) }),
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
    const t = fold(text.trim());
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
      }),
    );
    results.hidden = !found.length;
  }

  function pick(k) {
    if (!found[k] || busy) return;
    choose(items[found[k].i].hex);
    focusCard(found[k].i);
    found = [];
    showResults();
  }

  clearButton.addEventListener("click", () => {
    if (azOn) {
      search.value = "";
      showClear();
      az?.filter("");
      return search.focus();
    }
    found = [];
    showResults();
    choose(null, "");
    dropSpot();
    goHome();
    search.focus();
  });

  // the hint shimmers until the search is first used, here or on an earlier visit
  const SEARCHED = "cn-searched";
  const hint = q("[data-hint]");
  try {
    if (!localStorage.getItem(SEARCHED)) hint.classList.add("is-new");
  } catch {}
  search.addEventListener(
    "input",
    () => {
      hint.classList.remove("is-new");
      try {
        localStorage.setItem(SEARCHED, "1");
      } catch {}
    },
    { once: true },
  );

  search.addEventListener("input", () => {
    showClear();
    if (azOn) return az?.filter(search.value);
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
      e.preventDefault();
      search.value = chosenText;
      showClear();
      found = [];
      showResults();
      search.blur();
    }
  });
  let pickTimer = 0;
  colorPicker.addEventListener("input", () => {
    if (azOn) {
      search.value = colorPicker.value;
      showClear();
      return az?.closest(colorPicker.value);
    }
    clearTimeout(pickTimer);
    found = [];
    showResults();
    choose(colorPicker.value, colorPicker.value);
    pickTimer = setTimeout(() => !busy && focusCard(nearest(colorPicker.value)), 180);
  });

  q("[data-find]").addEventListener("submit", (e) => {
    e.preventDefault();
    if (azOn) return;
    if (!found.length) found = find(search.value);
    pick(active);
  });
  results.hidden = true;

  if (import.meta.env.DEV) {
    window.__wall = {
      cam,
      state: () => ({ anim: !!anim, moving: moving(), idle, busy, marked, open: !!colorPage, list: listKey, n }),
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
    if (!colorPage && !pending) rememberView();
    if (busy) return; // opening a card already saved the view from before the click
    try {
      sessionStorage.setItem("wall-camera", JSON.stringify(saveable()));
    } catch {}
  });

  const start = normalizeHex(new URLSearchParams(location.search).get("c") || "");
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
  if (new URLSearchParams(location.search).get("view") === "az") {
    let was = null;
    try {
      if (nav === "back_forward" || returning || fromColorPage) was = JSON.parse(sessionStorage.getItem("az-view"));
    } catch {}
    setAz(true, was);
  }
  if (saved && Number.isFinite(saved.dist) && saved.target?.length === 3) {
    const { home: wasHome, ...restored } = saved;
    Object.assign(cam, restored);
    setAway(!wasHome);
    if (new URLSearchParams(location.search).get("view") === "cells") setCells(true);
    idle = false;
    if (start) {
      marked = nearest(start);
      spot = { i: marked, on: true, t: performance.now() };
    }
    request();
  } else {
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
      Object.assign(cam, { ...h, dist: h.dist * 0.07, yaw: cam.yaw - 0.6 });
      update();
      flyTo(h, BANG_MS);
      bang = { start: performance.now(), center: h.target, then };
      busy = true;
    }
    request();
  }
}
