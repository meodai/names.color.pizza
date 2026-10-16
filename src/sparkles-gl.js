// Glitter on the adopted colors: a four-pointed sparkle over each, the same size on
// screen however far the card is, flashing in short bursts at its own rhythm. Drawn at
// the card's depth, so nearer cards hide it; added to what's below, like light.

const VERT = `#version 300 es
in vec2 a_corner;
in vec4 a_spark; // card position, its own phase
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;
uniform vec2 u_view;
uniform vec2 u_clip;
uniform float u_time;
uniform float u_px; // the sparkle's size on screen, device px
uniform vec2 u_corner; // from the card's middle to where the sparkle sits
out vec2 v_p;
out float v_flash;
void main() {
  vec3 v = a_spark.xyz - u_eye;
  float z = dot(v, u_fwd);
  // two waves of flashes a little apart, so it glitters rather than blinks
  float t = u_time * 0.0016 + a_spark.w;
  float flash = pow(max(sin(t), 0.0), 40.0) + 0.7 * pow(max(sin(t * 1.7 + 2.1), 0.0), 60.0);
  v_flash = min(flash, 1.0);
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
out vec4 o;
void main() {
  vec2 a = abs(v_p);
  // long thin rays along the axes, shorter ones on the diagonals, a bright core
  float rays = exp(-a.x * 26.0) * exp(-a.y * 2.6) + exp(-a.y * 26.0) * exp(-a.x * 2.6);
  vec2 d = abs(vec2(v_p.x + v_p.y, v_p.x - v_p.y)) * 0.7071;
  float diag = 0.45 * (exp(-d.x * 30.0) * exp(-d.y * 5.0) + exp(-d.y * 30.0) * exp(-d.x * 5.0));
  float core = exp(-dot(v_p, v_p) * 18.0);
  float light = (rays + diag + core) * v_flash;
  o = vec4(vec3(light), light);
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
  for (const k of ["eye", "right", "up", "fwd", "fpx", "view", "clip", "time", "px", "corner"]) u[k] = gl.getUniformLocation(prog, `u_${k}`);
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
  gl.vertexAttribPointer(aSpark, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(aSpark, 1);
  gl.bindVertexArray(null);
  let data = new Float32Array(0);

  return {
    // the adopted cards' indices; positions of the whole list
    draw(cam, dpr, canvas, which, positions) {
      if (!which.length) return;
      if (data.length !== which.length * 4) data = new Float32Array(which.length * 4);
      which.forEach((i, k) => {
        data.set([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], ((i * 2.399963) % 6.2832)], k * 4);
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
      gl.uniform1f(u.time, performance.now() % 1e7);
      gl.uniform1f(u.px, 46 * dpr);
      gl.uniform2f(u.corner, W * 0.42, H * 0.44);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, which.length);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.bindVertexArray(null);
    },
  };
}
