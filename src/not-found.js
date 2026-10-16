import { getList, slugsOf, siteURL, rgbToOklab } from "./names.js";

// a page that isn't there: #404404 in the middle of a spiral of names, each where its
// color sits on the hue wheel (hue around, lightness outwards), none used twice
const SVG = "http://www.w3.org/2000/svg";
const C = 500;
const INNER = 160;
const OUTER = 480;
const SIZE = 22;
const PITCH = SIZE * 1.18;
const SEP = " —— ";
// a little less saturated now and then, the wheel turned some way: other names each visit
const SAT = 0.6 + Math.random() * 0.4;
const TURN = Math.random() * 360;

const missing = document.querySelector("[data-missing]");
const asked = location.pathname.match(/\/color\/([^/]+)\/?$/);
if (asked) {
  const name = decodeURIComponent(asked[1])
    .replace(/[-_]+/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  missing.textContent = `No color is called “${name}” yet.`;
  missing.hidden = false;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
}

// the spiral as points, its length, and the point at any length along it
function spiral() {
  const turns = (OUTER - INNER) / PITCH;
  const n = Math.ceil(turns * 90);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = 2 * Math.PI * turns * t;
    const r = INNER + (OUTER - INNER) * t;
    pts.push([C + r * Math.cos(a), C + r * Math.sin(a)]);
  }
  const at = [0];
  for (let i = 1; i < pts.length; i++) at[i] = at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let k = 0;
  return {
    d: pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(""),
    total: at.at(-1),
    point(pos) {
      if (at[k] > pos) k = 0;
      while (k < at.length - 2 && at[k + 1] < pos) k++;
      const f = (pos - at[k]) / (at[k + 1] - at[k] || 1);
      return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f];
    },
  };
}

async function wheel() {
  const [best, all] = await Promise.all([getList("bestOf"), getList("default"), document.fonts?.load(`600 ${SIZE}px Inter`).catch(() => {})]);
  const slugs = slugsOf(all.items);
  const items = best.items;
  const used = new Uint8Array(items.length);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `600 ${SIZE}px Inter`;
  const ahead = (ctx.measureText("aeiosrntl").width / 9) * 5;
  const sepW = ctx.measureText(SEP).width;
  const path = spiral();

  const picks = [];
  for (let pos = 0; pos < path.total && picks.length < 2000; ) {
    const [x, y] = path.point(Math.min(pos + ahead, path.total));
    const hue = ((Math.atan2(y - C, x - C) * 180) / Math.PI + TURN + 360) % 360;
    const [L, A, B] = rgbToOklab(hslToRgb(hue, SAT, Math.min(1, Math.hypot(x - C, y - C) / OUTER)));
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const d = (items[i].L - L) ** 2 + (items[i].a - A) ** 2 + (items[i].b - B) ** 2;
      if (d < bd) [bd, best] = [d, i];
    }
    if (best < 0) break;
    const w = ctx.measureText(items[best].name).width;
    if (pos + w > path.total) break;
    used[best] = 1;
    picks.push(items[best]);
    pos += w + sepW;
  }

  const p = document.createElementNS(SVG, "path");
  p.id = "wheel-path";
  p.setAttribute("d", path.d);
  document.querySelector("[data-wheel-defs]").append(p);
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("font-size", SIZE);
  const along = document.createElementNS(SVG, "textPath");
  along.setAttribute("href", "#wheel-path");
  picks.forEach((it, k) => {
    const a = document.createElementNS(SVG, "a");
    a.setAttribute("href", siteURL(`color/${slugs.get(it.name)}/`));
    a.style.setProperty("--k", k);
    const name = document.createElementNS(SVG, "tspan");
    name.setAttribute("fill", it.hex);
    name.textContent = it.name;
    a.append(name);
    along.append(a);
    if (k < picks.length - 1) {
      const sep = document.createElementNS(SVG, "tspan");
      sep.setAttribute("fill", it.hex);
      sep.style.setProperty("--k", k);
      sep.textContent = SEP;
      along.append(sep);
    }
  });
  text.append(along);
  document.querySelector("[data-wheel-names]").append(text);
  // a frame later, so the names start hidden and come in one by one
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector("[data-wheel]").classList.add("is-in")));
}
wheel();
