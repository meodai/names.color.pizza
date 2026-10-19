// The cards' names drawn in the 3D view itself, at their card's depth, so a nearer
// card hides them exactly as it hides the card. Each name is drawn once into a slot
// of one texture; the nearest cards keep theirs, the farthest give theirs up.

const SLOT_W = 512;
const SLOT_H = 160;
const ATLAS = 4096;
const COLS = ATLAS / SLOT_W;
// new names drawn per frame, so a fast flight doesn't stutter
const PER_FRAME = 24;

const vert = ({ W, H, NEAR_SLOTS }, TALL) => `#version 300 es
in vec2 a_corner;
in vec4 a_label; // card position, slot
in vec2 a_card; // card, how far its strip is out
uniform vec3 u_eye;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform float u_fpx;
uniform vec2 u_view;
uniform vec2 u_clip;
uniform int u_hover;
uniform vec3 u_hoverPos;
uniform float u_hoverClear;
uniform float u_nearAt;
uniform float u_scale; // the cards' size, as the wall sets it for the list
uniform int u_nearIds[${NEAR_SLOTS}];
uniform float u_nearAlpha[${NEAR_SLOTS}];
out vec2 v_uv;
out float v_near;
out float v_show;
out float v_y;
void main() {
  vec3 v = a_label.xyz - u_eye;
  float z = dot(v, u_fwd);
  float px = max(z, 0.001) / u_fpx;
  // the strip under the swatch, as the card shader places it
  vec2 local = vec2(a_corner.x * ${W.toFixed(1)}, ${W.toFixed(1)} + a_corner.y * ${(H - W).toFixed(4)}) * u_scale;
  vec2 p = vec2(dot(v, u_right), dot(v, u_up)) + vec2(local.x - ${(W / 2).toFixed(4)} * u_scale, ${(H / 2).toFixed(4)} * u_scale - local.y);
  float n = u_clip.x, f = u_clip.y;
  gl_Position = vec4(p.x * u_fpx / (u_view.x * 0.5), p.y * u_fpx / (u_view.y * 0.5), (z * (f + n) - 2.0 * f * n) / (f - n), z);
  // a hair in front of its own card, never in front of the next
  gl_Position.z -= 0.00002 * z;
  float slot = a_label.w;
  vec2 cell = vec2(mod(slot, ${COLS.toFixed(1)}), floor(slot / ${COLS.toFixed(1)}));
  v_uv = (cell * vec2(${SLOT_W.toFixed(1)}, ${SLOT_H.toFixed(1)}) + a_corner * vec2(${SLOT_W.toFixed(1)}, ${((SLOT_W * (H - W)) / W).toFixed(2)})) / vec2(${ATLAS.toFixed(1)}, ${TALL.toFixed(1)});
  float near = ${W.toFixed(1)} * u_scale / px / min(u_view.x, u_view.y) > u_nearAt ? 0.0 : 1.0;
  int card = int(a_card.x + 0.5);
  // the hex comes as the strip is nearly out, the name just after
  v_show = a_card.y;
  v_y = a_corner.y / max(a_card.y, 0.001);
  for (int k = 0; k < ${NEAR_SLOTS}; k++) if (u_nearIds[k] == card) near = u_nearAlpha[k];
  // as the card shader clears the way to the hovered card
  if (u_hover >= 0 && card != u_hover && u_hoverClear > 0.0) {
    vec3 vh = u_hoverPos - u_eye;
    float zh = dot(vh, u_fwd);
    if (z > 0.0 && z < zh) {
      vec2 d = abs(vec2(dot(v, u_right), dot(v, u_up)) / z - vec2(dot(vh, u_right), dot(vh, u_up)) / zh);
      vec2 reach = vec2(${W.toFixed(1)}, ${H.toFixed(4)}) * u_scale * 0.5 * (1.0 / z + 1.0 / zh);
      if (d.x < reach.x && d.y < reach.y) near *= 1.0 - u_hoverClear;
    }
  }
  v_near = near;
}`;

// where the name's line starts, as a share of the strip's height (see paint)
const NAME_AT = ((0.2475 + 0.55 * 1.2 - 0.05 * 0.27) * 0.205 * SLOT_W) / (SLOT_W * 0.3);

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_near;
in float v_show;
in float v_y;
uniform sampler2D u_atlas;
out vec4 o;
void main() {
  // the same dither as the cards', so a dissolving card takes its name along
  if (v_near < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= v_near) discard;
  if (v_y > 1.0) discard;
  // the name sits below ${NAME_AT} of the strip
  float show = v_y * v_show < ${NAME_AT} ? smoothstep(0.45, 0.8, v_show) : smoothstep(0.7, 1.0, v_show);
  float a = texture(u_atlas, v_uv).r * show;
  if (a < 0.01) discard;
  o = vec4(0.0, 0.0, 0.0, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// as .wall__label: padding 0.3em, hex 0.55em bold, name 0.27em light, in em of 0.205 × the card's width
function paint(ctx, font, hex, name) {
  const f = SLOT_W * 0.205;
  const pad = f * 0.3;
  const room = SLOT_W - pad * 2;
  const fit = (text) => {
    if (ctx.measureText(text).width <= room) return text;
    let t = text;
    while (t && ctx.measureText(`${t}…`).width > room) t = t.slice(0, -1);
    return `${t}…`;
  };
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SLOT_W, SLOT_H);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  const hexSize = f * 0.55;
  const hexTop = f * 0.2475;
  ctx.font = `700 ${hexSize}px ${font}`;
  ctx.fillText(fit(hex), pad, hexTop + hexSize * 0.6);
  const nameSize = f * 0.27;
  const nameTop = hexTop + hexSize * 1.2 - nameSize * 0.05;
  ctx.font = `300 ${nameSize}px ${font}`;
  ctx.fillText(fit(name), pad, nameTop + nameSize * 0.6);
}

export function createLabelRenderer(gl, geo) {
  // twice as tall where the GPU allows it, for twice the names
  const TALL = Math.min(ATLAS * 2, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const SLOTS = COLS * Math.floor(TALL / SLOT_H);
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vert(geo, TALL)));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = {};
  for (const k of [
    "eye",
    "right",
    "up",
    "fwd",
    "fpx",
    "view",
    "clip",
    "nearAt",
    "nearIds",
    "nearAlpha",
    "atlas",
    "hover",
    "hoverPos",
    "hoverClear",
    "scale",
  ])
    u[k] = gl.getUniformLocation(prog, `u_${k}`);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(prog, "a_corner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const labelData = new Float32Array(SLOTS * 4);
  const cardData = new Float32Array(SLOTS * 2);
  const labelBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, labelBuf);
  gl.bufferData(gl.ARRAY_BUFFER, labelData.byteLength, gl.DYNAMIC_DRAW);
  const aLabel = gl.getAttribLocation(prog, "a_label");
  gl.enableVertexAttribArray(aLabel);
  gl.vertexAttribPointer(aLabel, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(aLabel, 1);
  const cardBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cardData.byteLength, gl.DYNAMIC_DRAW);
  const aCard = gl.getAttribLocation(prog, "a_card");
  gl.enableVertexAttribArray(aCard);
  gl.vertexAttribPointer(aCard, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(aCard, 1);
  gl.bindVertexArray(null);

  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(TALL)) + 1, gl.R8, ATLAS, TALL);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const scratch = document.createElement("canvas");
  scratch.width = SLOT_W;
  scratch.height = SLOT_H;
  const ctx = scratch.getContext("2d", { willReadFrequently: false });
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  // which card each slot holds, and when it was last wanted
  const slotOf = new Map();
  const cardIn = new Int32Array(SLOTS).fill(-1);
  const wanted = new Float64Array(SLOTS);
  let tick = 0;
  const reset = () => {
    slotOf.clear();
    cardIn.fill(-1);
    wanted.fill(0);
  };
  // names painted before the font arrived are painted again
  document.fonts?.ready.then(reset);

  // cards: [{ i, near }] nearest first; items: the list; positions: their places
  return {
    slots: SLOTS,
    reset,
    scale: 1,
    // the cards that have their name ready, for their strips to come out
    ready: new Set(),
    draw(cam, dpr, canvas, cards, items, positions, near, strips) {
      tick++;
      const ready = this.ready;
      ready.clear();
      let drawn = 0;
      let count = 0;
      let painted = 0;
      for (const c of cards) {
        if (count >= SLOTS) break;
        let slot = slotOf.get(c.i);
        if (slot === undefined) {
          if (painted >= PER_FRAME) continue;
          let oldest = 0;
          for (let s = 1; s < SLOTS; s++) if (wanted[s] < wanted[oldest]) oldest = s;
          if (wanted[oldest] === tick) continue;
          if (cardIn[oldest] >= 0) slotOf.delete(cardIn[oldest]);
          slot = oldest;
          cardIn[slot] = c.i;
          slotOf.set(c.i, slot);
          paint(ctx, font, items[c.i].hex, items[c.i].name);
          gl.bindTexture(gl.TEXTURE_2D, atlas);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            (slot % COLS) * SLOT_W,
            Math.floor(slot / COLS) * SLOT_H,
            gl.RED,
            gl.UNSIGNED_BYTE,
            scratch,
          );
          painted++;
        }
        wanted[slot] = tick;
        ready.add(c.i);
        if (strips[c.i] <= 0) continue;
        labelData.set([positions[c.i * 3], positions[c.i * 3 + 1], positions[c.i * 3 + 2], slot], count * 4);
        cardData[count * 2] = c.i;
        cardData[count * 2 + 1] = strips[c.i];
        count++;
      }
      if (painted) {
        gl.bindTexture(gl.TEXTURE_2D, atlas);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      if (!count) return drawn;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, labelBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, labelData, 0, count * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, cardBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cardData, 0, count * 2);
      gl.uniform3fv(u.eye, cam.eye);
      gl.uniform3fv(u.right, cam.right);
      gl.uniform3fv(u.up, cam.up);
      gl.uniform3fv(u.fwd, cam.fwd);
      gl.uniform1f(u.fpx, cam.fpx * dpr);
      gl.uniform2f(u.view, canvas.width, canvas.height);
      gl.uniform2f(u.clip, geo.NEAR, geo.FAR);
      gl.uniform1f(u.nearAt, near.at);
      gl.uniform1f(u.scale, this.scale);
      gl.uniform1iv(u.nearIds, near.ids);
      gl.uniform1fv(u.nearAlpha, near.alphas);
      gl.uniform1i(u.hover, near.hover?.i ?? -1);
      if (near.hover) {
        gl.uniform3fv(u.hoverPos, near.hover.pos);
        gl.uniform1f(u.hoverClear, near.hover.clear);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.atlas, 0);
      // at the card's own depth: drawn where its strip won, hidden where a nearer card did
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.bindVertexArray(null);
      return count;
    },
  };
}
