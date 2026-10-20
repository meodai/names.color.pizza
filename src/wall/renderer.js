import { DETAIL_IN_MS } from "../pixel-space.js";
import { sub } from "./math.js";

// the cards, every one in a single instanced draw
export const NEAR = 0.3;
export const FAR = 3000;
export const NEAR_SLOTS = 16;

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
in float a_detailAt; // when it came, so it can dither in over the small one
uniform float u_now;
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
flat out float v_detailK;
uniform int u_hover;            // the hovered card: the ones in front of it make way
uniform vec3 u_hoverPos;
uniform float u_hoverClear;
uniform float u_pixel;           // 0 the colors, 1 their pixel art
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
  v_detailK = clamp((u_now - a_detailAt) / ${DETAIL_IN_MS}.0, 0.0, 1.0);
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
      // in pixel art only the drawings count, smaller than their cards and with no name strip
      vec2 reach = (u_pixel > 0.5 ? vec2(u_size.x * 0.6) : u_size) * 0.5 * (1.0 / z + 1.0 / zh);
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
flat in float v_detailK;
uniform vec2 u_size;
uniform highp sampler2DArray u_atlas; // pixel art, 64 × 64 tiles to a layer
uniform float u_pixel;                // 0 the colors, 1 their pixel art
uniform highp sampler2D u_detail;     // full-size pixel art of the cards close by, 32 × 32 tiles
uniform int u_sheets;                 // which of the atlas's sheets have come, a bit each
out vec4 o;
void main() {
  // dithered, so it fades without sorting the cards
  if (v_near < 1.0) {
    float due = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (u_pixel > 0.5 && v_local.y < u_size.x) {
      // a retro dither dissolve: the drawing's own pixels (64 across once its full tile is
      // in, 16 till then) go in a 4 × 4 ordered (Bayer) pattern, a checker of its pixels
      vec2 cell = floor(clamp(v_local / u_size.x, 0.0, 0.999) * (v_detail >= 0.0 ? 64.0 : 16.0));
      int k = int(mod(cell.x, 4.0)) + int(mod(cell.y, 4.0)) * 4;
      int bayer[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      due = (float(bayer[k]) + 0.5) / 16.0;
    }
    if (due >= v_near) discard;
  }
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
    bool sheet = ((u_sheets >> int(layer)) & 1) == 1;
    bool there = v_detail >= 0.0 || sheet;
    if (there) {
      vec4 t;
      // the full-size drawing replaces the small one in the same ordered dither, in the small
      // one's coarse pixels, 16 across
      vec2 ditherCell = floor(inTile * 16.0);
      int dk = int(mod(ditherCell.x, 4.0)) + int(mod(ditherCell.y, 4.0)) * 4;
      int dbayer[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      bool sharp = v_detail >= 0.0 && (!sheet || (float(dbayer[dk]) + 0.5) / 16.0 < v_detailK);
      if (sharp) {
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

// size: a card's [width, height] in the space, for this list
export function createRenderer(canvas, positions, colors, grow = new Uint8Array(positions.length / 3), size) {
  const gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  // the program keeps what it needs; the shaders would only pile up, a pair per renderer
  for (const sh of gl.getAttachedShaders(prog)) {
    gl.detachShader(prog, sh);
    gl.deleteShader(sh);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = {};
  const attrib = (name, array, size, type, normalized, divisor) => {
    const loc = gl.getAttribLocation(prog, name);
    buffers[name] = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[name]);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      array,
      ["a_pos", "a_strip", "a_star"].includes(name) ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
    );
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
  attrib("a_detailAt", new Float32Array(positions.length / 3).fill(-1e9), 1, gl.FLOAT, false, 1);
  // the pixel art: a pixel each until pixel art is asked for (pixelInit), so the space
  // keeps its memory otherwise. The atlas's sheets as layers, and the full-size tiles of the
  // cards close by, swapped in and out as they come and go
  const texture = (target, unit, setup) => {
    const t = gl.createTexture();
    gl.activeTexture(unit);
    gl.bindTexture(target, t);
    setup();
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    return t;
  };
  const clear = new Uint8Array(4);
  const placeholder = (target, unit) =>
    texture(target, unit, () => {
      if (target === gl.TEXTURE_2D) gl.texImage2D(target, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, clear);
      else gl.texImage3D(target, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, clear);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    });
  let atlas = placeholder(gl.TEXTURE_2D_ARRAY, gl.TEXTURE1);
  let detail = placeholder(gl.TEXTURE_2D, gl.TEXTURE2);

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
    "now",
  ]) {
    u[k] = gl.getUniformLocation(prog, `u_${k}`);
  }
  gl.uniform1f(u.nearAt, 1e9);
  gl.uniform1i(u.hover, -1);
  gl.uniform1iv(u.nearIds, new Int32Array(NEAR_SLOTS).fill(-1));
  gl.uniform2f(u.size, ...size);
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
    gl.uniform1f(u.now, performance.now() % 1e6);
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
  draw.pixelInit = (layers) => {
    gl.deleteTexture(atlas);
    gl.deleteTexture(detail);
    atlas = texture(gl.TEXTURE_2D_ARRAY, gl.TEXTURE1, () => {
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 11, gl.RGBA8, 1024, 1024, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    });
    detail = texture(gl.TEXTURE_2D, gl.TEXTURE2, () => {
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 2048, 2048);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    });
  };
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
  draw.pixelDetailOf = (i, slot, at = -1e9) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_detail);
    gl.bufferSubData(gl.ARRAY_BUFFER, i * 4, new Float32Array([slot]));
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.a_detailAt);
    gl.bufferSubData(gl.ARRAY_BUFFER, i * 4, new Float32Array([at]));
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
