// Glitter on the adopted colors: a four-pointed sparkle on each card's corner, the same
// size on screen however far the card is. When it flashes, how bright and at what angle
// is worked out per card by the wall; this only draws it, at the card's depth so nearer
// cards hide it, added to what's below, like light.

const VERT = `#version 300 es
in vec2 a_corner;
in vec4 a_spark; // card position, how bright it flashes now
in vec4 a_tint;  // the card's color, the flash's angle
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;
uniform vec2 u_view;
uniform vec2 u_clip;
uniform float u_px; // the sparkle's size on screen, device px
uniform vec2 u_corner; // from the card's middle to where the sparkle sits
out vec2 v_p;
out float v_flash;
out vec3 v_tint;
out float v_turn;
void main() {
  vec3 v = a_spark.xyz - u_eye;
  float z = dot(v, u_fwd);
  v_flash = a_spark.w;
  v_tint = a_tint.rgb / max(max(a_tint.r, a_tint.g), max(a_tint.b, 0.001));
  v_turn = a_tint.a;
  v_p = a_corner * 2.0 - 1.0;
  float n = u_clip.x, f = u_clip.y;
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
  for (const k of ["eye", "right", "up", "fwd", "fpx", "view", "clip", "px", "corner"]) u[k] = gl.getUniformLocation(prog, `u_${k}`);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(prog, "a_corner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const sparkBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
  for (const [name, offset] of [["a_spark", 0], ["a_tint", 16]]) {
    const at = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 4, gl.FLOAT, false, 32, offset);
    gl.vertexAttribDivisor(at, 1);
  }
  gl.bindVertexArray(null);
  let data = new Float32Array(0);

  return {
    // flashes: [{ i, flash, turn }]; positions and colors (bytes) of the whole list
    draw(cam, dpr, canvas, flashes, positions, colors) {
      if (!flashes.length) return;
      if (data.length !== flashes.length * 8) data = new Float32Array(flashes.length * 8);
      flashes.forEach(({ i, flash, turn }, k) => {
        const p = i * 3;
        data.set([positions[p], positions[p + 1], positions[p + 2], flash, colors[p] / 255, colors[p + 1] / 255, colors[p + 2] / 255, turn], k * 8);
      });
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform3fv(u.eye, cam.eye);
      gl.uniform3fv(u.right, cam.right);
      gl.uniform3fv(u.up, cam.up);
      gl.uniform3fv(u.fwd, cam.fwd);
      gl.uniform1f(u.fpx, cam.fpx * dpr);
      gl.uniform2f(u.view, canvas.width, canvas.height);
      gl.uniform2f(u.clip, NEAR, FAR);
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
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, flashes.length);
      gl.blendFuncSeparate(was.src, was.dst, was.srcA, was.dstA);
      if (!was.blend) gl.disable(gl.BLEND);
      gl.depthMask(was.mask);
      gl.depthFunc(was.depth);
      gl.bindVertexArray(null);
    },
  };
}
