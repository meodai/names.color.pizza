/*
  Cells — the wall's other view: instead of a card per name, the space
  itself, filled. Every point of a model's shape belongs to the name
  closest to it in that model's own space (RGB distance in the RGB cube,
  OKLab distance in OKLab, and so on: a true Voronoi of the shape you see),
  as long as it's within r of it; past that it belongs to nobody and stays
  empty, so the unnamed parts of the space show as holes.

  A worker works out the owners on a grid over the shape, once per model;
  the GPU ray-marches it and settles the exact owner at the surface from
  the few names around it. As the camera closes in, what lies between it
  and the point it turns around is cut away, so you look into the space
  rather than at its skin. The same march runs on the CPU for the one
  pixel under the pointer, to say whose cell it is.
*/

const VOXEL = 1.3; // grid step, in the wall's world units
const NAMES_W = 256; // the names textures' width

// Which name owns each grid point over one model's shape, worked out in a
// worker. positions: the names' places in that model; r: how far a name
// reaches.
export function buildOwners(positions, bounds, r, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cells-worker.js", import.meta.url), { type: "module" });
    const n = positions.length / 3;
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const Z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = positions[i * 3];
      Y[i] = positions[i * 3 + 1];
      Z[i] = positions[i * 3 + 2];
    }
    const lo = bounds.lo;
    const dims = [0, 1, 2].map((k) => Math.ceil((bounds.hi[k] - lo[k]) / VOXEL));
    worker.onmessage = (e) => {
      if (e.data.progress != null) return onProgress?.(e.data.progress);
      worker.terminate();
      resolve({ owners: e.data.owners, X, Y, Z, lo, dims, r });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e);
    };
    worker.postMessage({ X, Y, Z, r, lo, voxel: VOXEL, dims });
  });
}

/* —— is a point inside the model's shape? ——
   The wall's MODELS place a color; undoing that tells whether a point is a
   color at all. The same in GLSL below. */

const E1 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
const E2 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const E3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
export const MODEL_IDS = { rgb: 0, oklab: 1, oklch: 2, hsl: 3 };

function oklabToLin(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (lin) => lin.every((c) => c > -0.0005 && c < 1.0005);

export function inside(p, model, geo) {
  const { LY, R, RGB_SIDE } = geo;
  const [x, y, z] = p;
  if (model === 0) {
    return [0, 1, 2].every((k) => {
      const c = (x * E1[k] + y * E2[k] + z * E3[k]) / RGB_SIDE + 0.5;
      return c >= 0 && c <= 1;
    });
  }
  if (model === 3) {
    const l = y / LY + 0.5;
    if (l < 0 || l > 1) return false;
    const m = (l < 0.5 ? l : 1 - l) * 2 * R;
    return Math.hypot(x, z) <= m;
  }
  let lab;
  if (model === 1) lab = [y / LY + 0.5, x / LY, -z / LY];
  else {
    const L = Math.hypot(x, z) / (R * 1.2);
    const C = ((y + LY * 0.25) / (LY * 0.55)) * 0.32;
    if (C < 0 || L > 1) return false;
    const h = Math.atan2(-z, x);
    lab = [L, C * Math.cos(h), C * Math.sin(h)];
  }
  return inGamut(oklabToLin(...lab));
}

// the exact owner of a point, from the names stored at the 8 grid points
// around it: { i, d1 } (i = -1 for nobody)
export function ownerOf(p, cells) {
  const { owners, X, Y, Z, lo, dims, r } = cells;
  const b = [0, 1, 2].map((k) => Math.floor((p[k] - lo[k]) / VOXEL - 0.5));
  let i = -1;
  let d1 = Infinity;
  for (let c = 0; c < 8; c++) {
    const x = Math.min(dims[0] - 1, Math.max(0, b[0] + (c & 1)));
    const y = Math.min(dims[1] - 1, Math.max(0, b[1] + ((c >> 1) & 1)));
    const z = Math.min(dims[2] - 1, Math.max(0, b[2] + ((c >> 2) & 1)));
    const id = owners[x + dims[0] * (y + dims[1] * z)] - 1;
    if (id < 0) continue;
    const d = Math.hypot(X[id] - p[0], Y[id] - p[1], Z[id] - p[2]);
    if (d < d1) {
      d1 = d;
      i = id;
    }
  }
  return d1 < r ? { i, d1 } : { i: -1, d1 };
}

// the grid point nearest a point: a quick "anyone here?"
function quickOwner(p, cells) {
  const { owners, lo, dims } = cells;
  const c = [0, 1, 2].map((k) => Math.round((p[k] - lo[k]) / VOXEL - 0.5));
  if (c.some((v, k) => v < 0 || v >= dims[k])) return 0;
  return owners[c[0] + dims[0] * (c[1] + dims[1] * c[2])];
}

// how far apart the march samples are, at a distance t from the eye: well
// under a cell's reach, a little longer far away
const stepAt = (t) => Math.min(1.2, Math.max(0.6, t * 0.004));

// The cell under a screen point: march the ray as the GPU does.
export function pick(ray, eye, bounds, cut, model, geo, cells) {
  const span = slab(eye, ray, bounds);
  if (!span) return -1;
  for (let t = Math.max(span[0], cut), k = 0; k < 1200 && t <= span[1]; k++, t += stepAt(t)) {
    const p = [eye[0] + ray[0] * t, eye[1] + ray[1] * t, eye[2] + ray[2] * t];
    if (!quickOwner(p, cells) || !inside(p, model, geo)) continue;
    const o = ownerOf(p, cells);
    if (o.i >= 0) return o.i;
  }
  return -1;
}

function slab(o, d, { lo, hi }) {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / d[k];
    let a = (lo[k] - o[k]) * inv;
    let b = (hi[k] - o[k]) * inv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/* —— the GPU side —— */

const VERT = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_ndc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler3D;
in vec2 v_ndc;
uniform usampler3D u_owners;
uniform highp sampler2D u_places; // each name's place in this model
uniform highp sampler2D u_colors; // each name's color
uniform vec3 u_gridLo;
uniform ivec3 u_dims;
uniform float u_r;            // how far a name reaches
uniform vec3 u_eye, u_right, u_up, u_fwd;
uniform float u_fpx;
uniform vec2 u_view;
uniform int u_model;
uniform vec3 u_lo, u_hi;      // the model's shape, to clip rays to
uniform float u_cut;          // nothing nearer than this is drawn
uniform float u_dim;          // 0–1 into the dark
uniform vec2 u_fog;
uniform vec3 u_geo;           // LY, R, RGB_SIDE
out vec4 o;

const float VOXEL = ${VOXEL};
const int NAMES_W = ${NAMES_W};

vec3 oklabToLin(vec3 lab) {
  float l = pow(lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z, 3.0);
  float m = pow(lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z, 3.0);
  float s = pow(lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z, 3.0);
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

// is a point inside the model's shape, a color at all?
bool inside(vec3 p) {
  float LY = u_geo.x, R = u_geo.y, S = u_geo.z;
  if (u_model == 0) {
    vec3 v = (p.x * vec3(0.70710678, -0.70710678, 0.0) + p.y * vec3(0.57735027) + p.z * vec3(0.40824829, 0.40824829, -0.81649658)) / S + 0.5;
    return all(greaterThanEqual(v, vec3(0.0))) && all(lessThanEqual(v, vec3(1.0)));
  }
  if (u_model == 3) {
    float l = p.y / LY + 0.5;
    if (l < 0.0 || l > 1.0) return false;
    return length(p.xz) <= (l < 0.5 ? l : 1.0 - l) * 2.0 * R;
  }
  vec3 lab;
  if (u_model == 1) {
    lab = vec3(p.y / LY + 0.5, p.x / LY, -p.z / LY);
  } else {
    float L = length(p.xz) / (R * 1.2);
    float C = (p.y + LY * 0.25) / (LY * 0.55) * 0.32;
    if (C < 0.0 || L > 1.0) return false;
    float h = atan(-p.z, p.x);
    lab = vec3(L, C * cos(h), C * sin(h));
  }
  vec3 lin = oklabToLin(lab);
  return all(greaterThan(lin, vec3(-0.0005))) && all(lessThan(lin, vec3(1.0005)));
}

vec3 gridOf(vec3 p) { return (p - u_gridLo) / VOXEL - 0.5; }

uint quickOwner(vec3 p) {
  ivec3 c = ivec3(floor(gridOf(p) + 0.5));
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, u_dims))) return 0u;
  return texelFetch(u_owners, c, 0).r;
}

ivec2 at(int i) { return ivec2(i % NAMES_W, i / NAMES_W); }
vec3 place(int i) { return texelFetch(u_places, at(i), 0).xyz; }

// the exact owner, from the names at the 8 grid points around the point
int ownerOf(vec3 p, out float d1) {
  ivec3 b = ivec3(floor(gridOf(p)));
  d1 = 1e9;
  int best = -1;
  for (int c = 0; c < 8; c++) {
    ivec3 q = clamp(b + ivec3(c & 1, (c >> 1) & 1, (c >> 2) & 1), ivec3(0), u_dims - 1);
    int id = int(texelFetch(u_owners, q, 0).r) - 1;
    if (id < 0) continue;
    float d = distance(place(id), p);
    if (d < d1) { d1 = d; best = id; }
  }
  return d1 < u_r ? best : -1;
}

// the same, from the 27 grid points around it: surer at the surface,
// where the color is settled. Once a pixel.
int ownerWide(vec3 p, out float d1) {
  ivec3 b = ivec3(floor(gridOf(p) + 0.5));
  d1 = 1e9;
  int best = -1;
  for (int c = 0; c < 27; c++) {
    ivec3 q = clamp(b + ivec3(c % 3 - 1, (c / 3) % 3 - 1, c / 9 - 1), ivec3(0), u_dims - 1);
    int id = int(texelFetch(u_owners, q, 0).r) - 1;
    if (id < 0 || id == best) continue;
    float d = distance(place(id), p);
    if (d < d1) { d1 = d; best = id; }
  }
  return d1 < u_r ? best : -1;
}

bool owned(vec3 p) {
  if (quickOwner(p) == 0u || !inside(p)) return false;
  float d;
  return ownerOf(p, d) >= 0;
}

void main() {
  vec2 px = v_ndc * u_view * 0.5 / u_fpx;
  vec3 dir = normalize(u_fwd + u_right * px.x + u_up * px.y);
  // only where the ray crosses the shape's box
  vec3 inv = 1.0 / dir;
  vec3 ta = (u_lo - u_eye) * inv, tb = (u_hi - u_eye) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(max(tmin.x, tmin.y), tmin.z), max(u_cut, 0.3));
  float t1 = min(min(tmax.x, tmax.y), tmax.z);

  float hitT = -1.0;
  float last = t0;
  for (float t = t0; t <= t1; t += clamp(t * 0.004, 0.6, 1.2)) {
    if (owned(u_eye + dir * t)) { hitT = t; break; }
    last = t;
  }
  // the surface, between the last empty sample and the first owned one
  if (hitT > t0) {
    float a = last, b = hitT;
    for (int k = 0; k < 6; k++) {
      float m = 0.5 * (a + b);
      if (owned(u_eye + dir * m)) b = m; else a = m;
    }
    hitT = b;
  }

  vec3 color = vec3(0.0);
  float d1 = u_r;
  if (hitT > 0.0) {
    int id = ownerWide(u_eye + dir * hitT, d1);
    if (id >= 0) color = texelFetch(u_colors, at(id), 0).rgb;
  }
  // no outlines: each cell is a little lighter at its name and darker at
  // its rim, which is enough to tell one from the next
  color *= 1.0 - 0.22 * pow(clamp(d1 / u_r, 0.0, 1.0), 2.0);
  float z0 = max(hitT * dot(dir, u_fwd), 0.001);
  color = mix(color, vec3(0.0), smoothstep(u_fog.x, u_fog.y, z0));
  o = vec4(color * (1.0 - u_dim), 1.0);
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform sampler2D u_image;
out vec4 o;
void main() { o = texture(u_image, v_ndc * 0.5 + 0.5); }`;

function program(gl, vert, frag) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vert));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function nearestTexture(gl, target) {
  const t = gl.createTexture();
  gl.bindTexture(target, t);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(target, p, gl.NEAREST);
  return t;
}

// The cells, drawn into the wall's WebGL context. colors: each name's
// sRGB as bytes. Each model's owners are added once they're worked out.
// It renders at a fraction of the canvas's resolution while things move,
// then once in full.
export function createCellsRenderer(gl, canvas, colors, geo) {
  const march = program(gl, VERT, FRAG);
  const blit = program(gl, VERT, BLIT_FRAG);
  const vao = gl.createVertexArray();
  const u = {};
  for (const k of ["owners", "places", "colors", "gridLo", "dims", "r", "eye", "right", "up", "fwd", "fpx", "view", "model", "lo", "hi", "cut", "dim", "fog", "geo"]) {
    u[k] = gl.getUniformLocation(march, `u_${k}`);
  }
  const n = colors.length / 3;
  const rows = Math.ceil(n / NAMES_W);

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.activeTexture(gl.TEXTURE4);
  const colorTex = nearestTexture(gl, gl.TEXTURE_2D);
  const rgba = new Uint8Array(NAMES_W * rows * 4);
  for (let i = 0; i < n; i++) rgba.set([colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], 255], i * 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, NAMES_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.activeTexture(gl.TEXTURE0);

  // per model: who owns each grid point, and where each name sits
  const models = {};
  function add(key, cells) {
    gl.activeTexture(gl.TEXTURE1);
    const owners = nearestTexture(gl, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16UI, ...cells.dims, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, cells.owners);
    gl.activeTexture(gl.TEXTURE2);
    const places = nearestTexture(gl, gl.TEXTURE_2D);
    const data = new Float32Array(NAMES_W * rows * 4);
    for (let i = 0; i < n; i++) data.set([cells.X[i], cells.Y[i], cells.Z[i], 1], i * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, NAMES_W, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.activeTexture(gl.TEXTURE0);
    models[key] = { owners, places, cells };
  }

  // the picture, before it's scaled up to the canvas
  gl.activeTexture(gl.TEXTURE3);
  const image = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  const fbo = gl.createFramebuffer();
  let size = [0, 0];

  const draw = ({ cam, dpr, key, model, bounds, cut, dim, fog, scale }) => {
    const m = models[key];
    if (!m) return false;
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, image);
    if (w !== size[0] || h !== size[1]) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
      size = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(march);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, m.owners);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, m.places);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.uniform1i(u.owners, 1);
    gl.uniform1i(u.places, 2);
    gl.uniform1i(u.colors, 4);
    gl.uniform3fv(u.gridLo, m.cells.lo);
    gl.uniform3iv(u.dims, m.cells.dims);
    gl.uniform1f(u.r, m.cells.r);
    gl.uniform3fv(u.eye, cam.eye);
    gl.uniform3fv(u.right, cam.right);
    gl.uniform3fv(u.up, cam.up);
    gl.uniform3fv(u.fwd, cam.fwd);
    gl.uniform1f(u.fpx, cam.fpx * dpr);
    gl.uniform2f(u.view, canvas.width, canvas.height);
    gl.uniform1i(u.model, model);
    gl.uniform3fv(u.lo, bounds.lo);
    gl.uniform3fv(u.hi, bounds.hi);
    gl.uniform1f(u.cut, cut);
    gl.uniform1f(u.dim, dim);
    gl.uniform2f(u.fog, fog[0], fog[1]);
    gl.uniform3f(u.geo, geo.LY, geo.R, geo.RGB_SIDE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // up to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(blit);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, image);
    gl.uniform1i(gl.getUniformLocation(blit, "u_image"), 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    return true;
  };
  draw.add = add;
  draw.has = (key) => !!models[key];
  // done with it: another list's cells replace these
  draw.dispose = () => {
    for (const m of Object.values(models)) {
      gl.deleteTexture(m.owners);
      gl.deleteTexture(m.places);
    }
    [colorTex, image].forEach((t) => gl.deleteTexture(t));
    gl.deleteFramebuffer(fbo);
    gl.deleteVertexArray(vao);
    [march, blit].forEach((p) => gl.deleteProgram(p));
  };
  return draw;
}
