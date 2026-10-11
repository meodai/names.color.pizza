/*
  Color Names — 3D color-space viewer.

  The one place real color appears. 31,912 named colors plotted as a point
  cloud, re-projected through any of fourteen color spaces. A modernised port
  of an old CodePen (three r110 + chroma + a mystery Color class) to current
  three + culori.

  The geometry maths is kept faithful to the original so the shapes match;
  only the data source (now culori + a few small helpers) and the three.js
  APIs (BufferGeometry, color management, addons) are new.
*/

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { converter } from "culori";
import { loadList } from "./api.js";

const CUBE = 100;

/* —————————————————————————————————————————————————————————
   Color-space definitions — which components map to which axis,
   and the range each component spans. Ported verbatim from the pen.
   ————————————————————————————————————————————————————————— */
const SPACES = {
  rgb: { func: "rgb", x: [0, 255], y: [1, 255], z: [2, 255] },
  xyz: { func: "xyz", x: [0, 95.047], y: [1, 100], z: [2, 108.883] },
  cat02: { func: "cat02", x: [0, 95.047], y: [1, 104], z: [2, 108.883] },
  jab: { func: "jzazbz", x: [0, 0.2], y: [1, 0.16, -0.16], z: [2, 0.16, -0.16] },
  luv: { func: "luv", x: [0, 100], y: [1, 224, -134], z: [2, 122, -140] },
  yuv: { func: "yuv", z: [0, 255], y: [1, 255], x: [2, 255] },
  lab: { func: "lab", z: [0, 100], y: [1, 127, -128], x: [2, 127, -128] },
  oklab: { func: "oklab", z: [0, 1], y: [1, 0.3, -0.3], x: [2, 0.35, -0.35] },
  lch: { func: "lch", z: [0, 100], y: [1, 100], x: [2, 0, 360] },
  hsv: { func: "hsv", x: [0, 360], y: [1, 1], z: [2, 1] },
  hsl: { func: "hsl", x: [0, 360], y: [1, 1], z: [2, 1] },
  hsi: { func: "hsi", x: [0, 360], y: [1, 1], z: [2, 1] },
  hwb: { func: "hwb", x: [0, 360], y: [1, 1], z: [2, 1] },
  hcg: { func: "hcg", x: [0, 360], y: [1, 1], z: [2, 1] },
};

/* —————————————————————————————————————————————————————————
   Color conversions — culori for the standard spaces, small
   helpers for the ones culori doesn't cover, returned in the
   same scale the original config was tuned for.
   ————————————————————————————————————————————————————————— */
const toRgb = converter("rgb");
const toHsl = converter("hsl");
const toHsv = converter("hsv");
const toLab = converter("lab");
const toLch = converter("lch");
const toLuv = converter("luv");
const toOklab = converter("oklab");
const toXyz = converter("xyz65");

const hue = (c) => (c.h == null || Number.isNaN(c.h) ? 0 : c.h);

function components(hex, func) {
  switch (func) {
    case "rgb": {
      const c = toRgb(hex);
      return [c.r * 255, c.g * 255, c.b * 255];
    }
    case "hsl": {
      const c = toHsl(hex);
      return [hue(c), c.s, c.l];
    }
    case "hsv": {
      const c = toHsv(hex);
      return [hue(c), c.s, c.v];
    }
    case "hsi": {
      const c = toRgb(hex);
      const i = (c.r + c.g + c.b) / 3;
      const m = Math.min(c.r, c.g, c.b);
      return [hue(toHsv(hex)), i === 0 ? 0 : 1 - m / i, i];
    }
    case "hwb": {
      const c = toHsv(hex);
      return [hue(c), (1 - c.s) * c.v, 1 - c.v];
    }
    case "hcg": {
      const c = toRgb(hex);
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      const chroma = max - min;
      return [hue(toHsv(hex)), chroma, chroma < 1 ? min / (1 - chroma) : 0];
    }
    case "lab": {
      const c = toLab(hex);
      return [c.l, c.a, c.b];
    }
    case "lch": {
      const c = toLch(hex);
      return [c.l, c.c, hue(c)];
    }
    case "luv": {
      const c = toLuv(hex);
      return [c.l, c.u, c.v];
    }
    case "oklab": {
      const c = toOklab(hex);
      return [c.l, c.a, c.b];
    }
    case "xyz": {
      const c = toXyz(hex);
      return [c.x * 100, c.y * 100, c.z * 100];
    }
    case "cat02": {
      const c = toXyz(hex);
      return xyz2cat02([c.x * 100, c.y * 100, c.z * 100]);
    }
    case "jzazbz": {
      const c = toXyz(hex);
      return jzazbz([c.x * 100, c.y * 100, c.z * 100]);
    }
    case "yuv": {
      const c = toRgb(hex);
      return yuv([c.r * 255, c.g * 255, c.b * 255]);
    }
    default:
      return [0, 0, 0];
  }
}

const pq = (X) => {
  const x = Math.pow(X * 1e-4, 0.1593017578125);
  return Math.pow((0.8359375 + 18.8515625 * x) / (1 + 18.6875 * x), 134.034375);
};

function jzazbz([X, Y, Z]) {
  const Lp = pq(0.674207838 * X + 0.38279934 * Y - 0.047570458 * Z);
  const Mp = pq(0.14928416 * X + 0.73962834 * Y + 0.0833273 * Z);
  const Sp = pq(0.07094108 * X + 0.174768 * Y + 0.67097002 * Z);
  const Iz = 0.5 * (Lp + Mp);
  const az = 3.524 * Lp - 4.066708 * Mp + 0.542708 * Sp;
  const bz = 0.199076 * Lp + 1.096799 * Mp - 1.295875 * Sp;
  const Jz = (0.44 * Iz) / (1 - 0.56 * Iz) - 1.6295499532821566e-11;
  return [Jz, az, bz];
}

function xyz2cat02([x, y, z]) {
  return [
    0.7328 * x + 0.4296 * y - 0.1624 * z,
    -0.7036 * x + 1.6975 * y + 0.0061 * z,
    0.003 * x + 0.0136 * y + 0.9834 * z,
  ];
}

function yuv([r, g, b]) {
  return [
    r * 0.299 + g * 0.587 + b * 0.114,
    r * -0.168736 + g * -0.331264 + b * 0.5 + 128,
    r * 0.5 + g * -0.418688 + b * -0.081312 + 128,
  ];
}

const translate = (value, low1, high1, low2, high2) =>
  low2 + (high2 - low2) * ((value - low1) / (high1 - low1));

/* —————————————————————————————————————————————————————————
   Public entry point
   ————————————————————————————————————————————————————————— */
export function initColorSpace(root) {
  const canvasEl = root.querySelector("[data-canvas]");
  const modelSel = root.querySelector("[data-model]");
  const listSel = root.querySelector("[data-list]");
  const readout = root.querySelector("[data-readout]");

  const ink = "#000000";
  const paper = "#ffffff";
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let width = canvasEl.clientWidth || 1;
  let height = canvasEl.clientHeight || 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ink);
  scene.fog = new THREE.Fog(ink, CUBE * 1.5, CUBE * 3);

  const camera = new THREE.PerspectiveCamera(75, width / height, 1, 500);
  camera.position.z = CUBE * 1.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  canvasEl.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enableZoom = false; // let the page keep scrolling
  controls.enablePan = false;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 1.4;

  // wireframe of the color space
  const cubeMat = new THREE.LineBasicMaterial({ color: paper });
  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)),
    cubeMat
  );
  scene.add(cube);

  // shared round-point sprite
  const sprite = makeDiscTexture();

  let points = null;
  let colors = []; // the current list, for hover lookups

  function clearPoints() {
    if (!points) return;
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
    points = null;
  }

  function build(spaceKey) {
    clearPoints();
    if (!colors.length) return;

    const space = SPACES[spaceKey];
    const n = colors.length;
    const positions = new Float32Array(n * 3);
    const vColors = new Float32Array(n * 3);
    const tmp = new THREE.Color();

    let dotSize = (255 / Math.sqrt(n / 3)) * 0.4;
    dotSize = Math.max(Math.min(dotSize, 4), 1.25);

    for (let i = 0; i < n; i++) {
      const comp = components(colors[i].hex, space.func);

      let pX = translate(comp[space.x[0]], space.x[2] || 0, space.x[1], -CUBE * 0.5, CUBE * 0.5);
      let pY = translate(comp[space.y[0]], space.y[2] || 0, space.y[1], -CUBE * 0.5, CUBE * 0.5);
      const pZ = translate(comp[space.z[0]], space.z[2] || 0, space.z[1], -CUBE * 0.5, CUBE * 0.5);

      const f = space.func;
      if (f === "hsl" || f === "hsv" || f === "hsi" || f === "hcg") {
        const theta = (Math.PI * comp[space.x[0]]) / 180;
        let r = comp[space.y[0]] * CUBE;
        if (f === "hsi") r *= comp[space.z[0]] * 0.75;
        else if (f === "hsv") r *= comp[space.z[0]] * 0.5;
        else if (f === "hcg") r *= 0.5;
        else r *= comp[space.z[0]] < 0.5 ? comp[space.z[0]] : 1 - comp[space.z[0]];
        pY = r * Math.cos(theta);
        pX = r * Math.sin(theta);
      }

      if (f === "lch") {
        const theta = (Math.PI * comp[space.x[0]]) / 180;
        const r = translate(comp[space.y[0]], 0, space.y[1], 0, CUBE * 0.5);
        pY = r * Math.cos(theta);
        pX = r * Math.sin(theta);
      }

      positions[i * 3] = pX;
      positions[i * 3 + 1] = pY;
      positions[i * 3 + 2] = pZ;

      tmp.setStyle(colors[i].hex, THREE.SRGBColorSpace);
      vColors[i * 3] = tmp.r;
      vColors[i * 3 + 1] = tmp.g;
      vColors[i * 3 + 2] = tmp.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(vColors, 3));

    const material = new THREE.PointsMaterial({
      size: dotSize,
      map: sprite,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);
    raycaster.params.Points.threshold = dotSize;
  }

  /* —— interaction: hover to read a name —— */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverQueued = false;
  let resumeTimer;

  function onPointerMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!hoverQueued) {
      hoverQueued = true;
      requestAnimationFrame(pickColor);
    }
  }

  function pickColor() {
    hoverQueued = false;
    if (!points) return;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(points, false);
    const hit = hits.find((h) => h.distance > camera.near);
    if (!hit) return;
    const c = colors[hit.index];
    if (!c) return;
    readout.innerHTML = `<span class="result">${c.name}</span><span class="label">${c.hex}</span>`;
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!reduceMotion) controls.autoRotate = true;
    }, 2500);
  }

  renderer.domElement.addEventListener("pointermove", onPointerMove);

  /* —— sizing —— */
  function resize() {
    width = canvasEl.clientWidth || 1;
    height = canvasEl.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasEl);

  /* —— render only while on screen —— */
  let visible = false;
  let rafId = null;

  function loop() {
    rafId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  function start() {
    if (rafId == null) loop();
  }
  function stop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start();
      else stop();
    },
    { threshold: 0.01 }
  );
  io.observe(root);

  /* —— data —— */
  async function showList(name) {
    colors = await loadList(name);
    build(modelSel.value);
  }

  modelSel.addEventListener("change", () => build(modelSel.value));
  listSel.addEventListener("change", () => showList(listSel.value));

  showList(listSel.value || "default");
}

/* a soft white disc, used as the point sprite */
function makeDiscTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
