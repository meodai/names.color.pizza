/*
  Names — the lists, prepared once and shared by the name map and the
  submission form: parsed into OKLab, bucketed on a 3D grid for fast
  closest-name lookups, and the color conversions both need.
*/

import { loadList } from "./api.js";

// The site's root, wherever a page sits: each page says how far up it is
// (<html data-root="../">), so links work in development, in a build and
// under a subpath.
// The list's latest release on npm, written into each [data-version]
// ("GitHub v14.51.0"); asked for once per page, and if npm can't be
// reached the links just say GitHub
let release;
export function showVersion(root = document) {
  release ??= fetch("https://registry.npmjs.org/color-name-list/latest")
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => p?.version ?? null)
    .catch(() => null);
  release.then((v) => {
    if (v) root.querySelectorAll("[data-version]").forEach((el) => (el.textContent = ` v${v}`));
  });
}

export const siteURL = (path = "") =>
  new URL(path, new URL(document.documentElement.dataset.root || "./", location.href)).href;
export const colorURL = (hex) => siteURL(`color/#${hex.replace("#", "")}`);

// A named color also has a page of its own, at color/<slug>/ (built from
// the list, for search engines and sharing): "Red-Handed" → red-handed.
// Two names that come out the same ("Rose", "Rosé") leave the plain one to
// the name with the fewest letters changed; the other, like any slug that
// reads as a hex (Façade → facade), gets its hex added: rose-f7c9d4.
export const baseSlug = (name) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "color";

const changed = (name, slug) => [...name.toLowerCase()].filter((ch) => !slug.includes(ch)).length;

export function slugsOf(items) {
  const groups = new Map();
  for (const it of items) {
    const base = baseSlug(it.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(it);
  }
  const slugs = new Map();
  for (const [base, group] of groups) {
    group.sort((a, b) => changed(a.name, base) - changed(b.name, base) || (a.name < b.name ? -1 : 1));
    group.forEach((it, k) => {
      const plain = k === 0 && !/^[0-9a-f]{6}$/.test(base);
      slugs.set(it.name, plain ? base : `${base}-${it.hex.replace("#", "")}`);
    });
  }
  return slugs;
}

// Where the color page's card lands on its hero: center + x·32vw, y·30vh,
// a little tilted, and on the right, clear of where even a long name wraps.
// The wall picks it too, to fly a card there before opening its page.
export function cardPlace() {
  const between = (a, b) => a + Math.random() * (b - a);
  return { x: between(0.6, 0.92), y: between(-0.55, 0.45), r: between(-14, 14) };
}
import { toLinear, toGamma, linearToOklab, oklabToLinear } from "./okhsl.js";

export const LISTS = {
  default: "Full",
  bestOf: "Best of",
  short: "Short",
};

// OKLab distance beyond which a color counts as unnamed: about one
// just-noticeable difference, so it looks different from every name.
export const UNNAMED = 0.02;
const G = UNNAMED; // grid cell size; must be >= UNNAMED for the 3x3x3 search
const AB = 0.36; // OKLab a/b extent covered by the grid (sRGB peaks near 0.32)

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* —— color helpers —— */

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb) =>
  "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

export const rgbToOklab = (rgb) =>
  linearToOklab(...rgb.map((v) => toLinear(v / 255)));

export const oklabToRgb = (L, a, b) =>
  oklabToLinear(L, a, b).map((c) =>
    Math.round(clamp(toGamma(clamp(c, 0, 1)), 0, 1) * 255)
  );

export function oklchString(L, a, b) {
  const C = Math.hypot(a, b);
  const h = C < 0.0005 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${h.toFixed(1)})`;
}

export function normalizeHex(input) {
  const m = String(input ?? "")
    .trim()
    .replace(/^#/, "")
    .match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return "#" + h;
}

/* —— data: each list bucketed on a 3D OKLab grid —— */

const GL = Math.ceil(1 / G) + 1;
const GA = Math.ceil((2 * AB) / G);
const cellIndex = (L, a, b) =>
  (clamp(Math.floor(L / G), 0, GL - 1) * GA +
    clamp(Math.floor((a + AB) / G), 0, GA - 1)) *
    GA +
  clamp(Math.floor((b + AB) / G), 0, GA - 1);

function prepare(colors) {
  const items = colors.map(({ name, hex }) => {
    hex = hex.toLowerCase();
    const rgb = hexToRgb(hex);
    const [L, a, b] = rgbToOklab(rgb);
    return { hex, name, lower: name.toLowerCase(), rgb, L, a, b };
  });
  const n = items.length;
  const pL = new Float32Array(n);
  const pA = new Float32Array(n);
  const pB = new Float32Array(n);
  const cells = new Int32Array(n);
  const start = new Int32Array(GL * GA * GA + 1);
  items.forEach((it, k) => {
    pL[k] = it.L;
    pA[k] = it.a;
    pB[k] = it.b;
    cells[k] = cellIndex(it.L, it.a, it.b);
    start[cells[k] + 1]++;
  });
  for (let c = 0; c < GL * GA * GA; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1);
  const order = new Int32Array(n);
  for (let k = 0; k < n; k++) order[fill[cells[k]]++] = k;
  return {
    items,
    pL,
    pA,
    pB,
    start,
    order,
    byHex: new Map(items.map((i) => [i.hex, i])),
  };
}

const prepared = new Map();
export const getList = (key) => {
  if (!prepared.has(key)) prepared.set(key, loadList(key).then(prepare));
  return prepared.get(key);
};

// Index of the closest name within UNNAMED of an OKLab color, or -1.
// Scans the color's own grid cell first, then only those neighbor cells
// that could still hold something closer than the best match so far.
const NEIGHBORS = [0, -1, 1];
export function nearestIndex(d, L, a, b) {
  const fl = L / G;
  const fa = (a + AB) / G;
  const fb = (b + AB) / G;
  const li = Math.floor(fl);
  const ai = Math.floor(fa);
  const bi = Math.floor(fb);
  // distance from the color to its cell's lower and upper faces, per axis
  const gl = [0, (fl - li) * G, (li + 1 - fl) * G];
  const ga = [0, (fa - ai) * G, (ai + 1 - fa) * G];
  const gb = [0, (fb - bi) * G, (bi + 1 - fb) * G];
  const { start, order, pL, pA, pB } = d;
  let best = -1;
  let bd = UNNAMED * UNNAMED;
  for (let i = 0; i < 3; i++) {
    const x = li + NEIGHBORS[i];
    if (x < 0 || x >= GL) continue;
    const dx = gl[i] * gl[i];
    if (dx >= bd) continue;
    for (let j = 0; j < 3; j++) {
      const y = ai + NEIGHBORS[j];
      if (y < 0 || y >= GA) continue;
      const dxy = dx + ga[j] * ga[j];
      if (dxy >= bd) continue;
      const row = (x * GA + y) * GA;
      for (let k = 0; k < 3; k++) {
        const z = bi + NEIGHBORS[k];
        if (z < 0 || z >= GA || dxy + gb[k] * gb[k] >= bd) continue;
        const c = row + z;
        for (let s = start[c], e = start[c + 1]; s < e; s++) {
          const n = order[s];
          const dl = pL[n] - L;
          const da = pA[n] - a;
          const db = pB[n] - b;
          const dd = dl * dl + da * da + db * db;
          if (dd < bd) {
            bd = dd;
            best = n;
          }
        }
      }
    }
  }
  return best;
}
