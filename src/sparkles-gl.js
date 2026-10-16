// Glitter on the adopted colors: a four-pointed sparkle on each, the same size on
// screen however far the card is. Like glitter it catches the light only as you move:
// each card has its own tiny facets, so a turn or a zoom lights it now and then.
// Drawn at the card's depth, so nearer cards hide it; added to what's below, like light.

// how much of the light a card's facets throw toward the eye
export const GLINT = `
// (v: from the eye to the card); turning moves dir, zooming moves how far it is
float facet(vec3 v, float seed) {
  vec3 dir = normalize(v);
  vec3 a = normalize(vec3(sin(seed * 3.1), cos(seed * 5.7), sin(seed * 1.3 + 1.0)));
  vec3 b = normalize(cross(a, vec3(0.3, 0.9, 0.2)));
  return dot(dir, a) * 20.0 + dot(dir, b) * 13.0 + log(length(v)) * 6.0 + seed * 5.0;
}
float facetHash(float p, float seed, float salt) {
  return fract(sin((floor(p) + seed + salt) * 91.345) * 47453.5453);
}
// one facet after the other comes round; about half of them catch the light, like a
// photo flash far off: on at once, gone within a few frames however slowly the facet
// passes (was: from the eye a frame ago)
float glint(vec3 v, vec3 was, float seed) {
  float p = facet(v, seed);
  float step_ = p - facet(was, seed);
  float d = (fract(p) - 0.5) * sign(step_);
  float frames = d / max(abs(step_), 1e-3);
  return step(0.5, facetHash(p, seed, 0.0)) * step(0.0, d) * step(1e-3, abs(step_)) * exp(-frames * 0.7);
}`;

const VERT = `#version 300 es
in vec2 a_corner;
in vec4 a_spark; // card position, its own phase
in vec3 a_tint;  // the card's color
uniform vec3 u_eye;
uniform vec3 u_wasEye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;
uniform vec2 u_view;
uniform vec2 u_clip;
uniform float u_glint; // how much the camera moves, 0 when still
uniform float u_px; // the sparkle's size on screen, device px
uniform vec2 u_corner; // from the card's middle to where the sparkle sits
out vec2 v_p;
out float v_flash;
out vec3 v_tint;
out float v_turn;
${GLINT}
void main() {
  vec3 v = a_spark.xyz - u_eye;
  float z = dot(v, u_fwd);
  float flash = glint(v, a_spark.xyz - u_wasEye, a_spark.w) * u_glint;
  v_flash = min(flash, 1.0);
  // each facet throws its flash at its own angle
  v_turn = facetHash(facet(v, a_spark.w), a_spark.w, 17.0) * 1.5708;
  v_tint = a_tint / max(max(a_tint.r, a_tint.g), max(a_tint.b, 0.001));
  v_p = a_corner * 2.0 - 1.0;
  float n = u_clip.x, f = u_clip.y;
  // on the card's top right corner, a little inside it
  vec2 at = vec2(dot(v, u_right), dot(v, u_up)) + u_corner;
  vec2 center = at * u_fpx / (u_view * 0.5) / max(z, 0.001);
  vec2 size = vec2(u_px) * (0.6 + 0.6 * v_flash) / u_view;
  gl_Position = vec4((center + v_p * size) * z, (z * (f + n) - 2.0 * f * n) / (f - n) - 0.00002 * z, z);
  if (z <= n || v_flash < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_p;
in float v_flash;
in vec3 v_tint;
in float v_turn;
out vec4 o;
void main() {
  vec2 q = mat2(cos(v_turn), sin(v_turn), -sin(v_turn), cos(v_turn)) * v_p;
  vec2 a = abs(q);
  // long thin rays along the axes, shorter ones on the diagonals, a bright core
  float rays = exp(-a.x * 26.0) * exp(-a.y * 2.6) + exp(-a.y * 26.0) * exp(-a.x * 2.6);
  vec2 d = abs(vec2(q.x + q.y, q.x - q.y)) * 0.7071;
  float diag = 0.45 * (exp(-d.x * 30.0) * exp(-d.y * 5.0) + exp(-d.y * 30.0) * exp(-d.x * 5.0));
  float core = exp(-dot(q, q) * 18.0);
  float light = (rays + diag + core) * v_flash;
  // white at the heart, the rays a little in the card's own hue
  vec3 tint = mix(v_tint, vec3(1.0), 0.55 + 0.45 * min(core * 2.0, 1.0));
  o = vec4(tint * light, light);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function createSparkleRenderer(gl, { NEAR, FAR, W, H }) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = {};
  for (const k of ["eye", "wasEye", "right", "up", "fwd", "fpx", "view", "clip", "glint", "px", "corner"]) u[k] = gl.getUniformLocation(prog, `u_${k}`);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(prog, "a_corner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const sparkBuf = gl.createBuffer();
  const aSpark = gl.getAttribLocation(prog, "a_spark");
  gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
  gl.enableVertexAttribArray(aSpark);
  gl.vertexAttribPointer(aSpark, 4, gl.FLOAT, false, 28, 0);
  gl.vertexAttribDivisor(aSpark, 1);
  const aTint = gl.getAttribLocation(prog, "a_tint");
  gl.enableVertexAttribArray(aTint);
  gl.vertexAttribPointer(aTint, 3, gl.FLOAT, false, 28, 16);
  gl.vertexAttribDivisor(aTint, 1);
  gl.bindVertexArray(null);
  let data = new Float32Array(0);

  return {
    // the adopted cards' indices; positions and colors (bytes) of the whole list
    draw(cam, dpr, canvas, which, positions, colors) {
      if (!which.length) return;
      if (data.length !== which.length * 7) data = new Float32Array(which.length * 7);
      which.forEach((i, k) => {
        const p = i * 3;
        data.set([positions[p], positions[p + 1], positions[p + 2], (i * 2.399963) % 6.2832, colors[p] / 255, colors[p + 1] / 255, colors[p + 2] / 255], k * 7);
      });
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform3fv(u.eye, cam.eye);
      gl.uniform3fv(u.wasEye, cam.wasEye || cam.eye);
      gl.uniform3fv(u.right, cam.right);
      gl.uniform3fv(u.up, cam.up);
      gl.uniform3fv(u.fwd, cam.fwd);
      gl.uniform1f(u.fpx, cam.fpx * dpr);
      gl.uniform2f(u.view, canvas.width, canvas.height);
      gl.uniform2f(u.clip, NEAR, FAR);
      gl.uniform1f(u.glint, cam.glint || 0);
      gl.uniform1f(u.px, 30 * dpr);
      gl.uniform2f(u.corner, W * 0.42, H * 0.44);
      // leave the GL as found: the cards and their names blend their own way
      const was = {
        blend: gl.isEnabled(gl.BLEND),
        src: gl.getParameter(gl.BLEND_SRC_RGB),
        dst: gl.getParameter(gl.BLEND_DST_RGB),
        srcA: gl.getParameter(gl.BLEND_SRC_ALPHA),
        dstA: gl.getParameter(gl.BLEND_DST_ALPHA),
        depth: gl.getParameter(gl.DEPTH_FUNC),
        mask: gl.getParameter(gl.DEPTH_WRITEMASK),
      };
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, which.length);
      gl.blendFuncSeparate(was.src, was.dst, was.srcA, was.dstA);
      if (!was.blend) gl.disable(gl.BLEND);
      gl.depthMask(was.mask);
      gl.depthFunc(was.depth);
      gl.bindVertexArray(null);
    },
  };
}
