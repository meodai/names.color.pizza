import { convertRgbToOklab, convertOklabToRgb } from "culori";
import { loadList } from "./api.js";

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

// pages set <html data-root="../"> so links work in dev, in a build and under a subpath
export const siteURL = (path = "") =>
  new URL(path, new URL(document.documentElement.dataset.root || "./", location.href)).href;
export const colorURL = (hex) => siteURL(`color/#${hex.replace("#", "")}`);

// letters NFKD doesn't decompose
const LETTERS = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };
export const fold = (text) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (ch) => LETTERS[ch]);

export const baseSlug = (name) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "color";

const changed = (name, slug) => [...name.toLowerCase()].filter((ch) => !slug.includes(ch)).length;

// on a clash the fewest-changed name keeps the plain slug; others and hex-like slugs get -<hex>
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

// right of center, clear of where even a long name wraps
export function cardPlace() {
  const between = (a, b) => a + Math.random() * (b - a);
  return { x: between(0.6, 0.92), y: between(-0.55, 0.45), r: between(-14, 14) };
}

export const LISTS = {
  default: "Full",
  bestOf: "Best of",
  short: "Short",
  adopted: "Adopted",
};

// the colors patrons adopted, out of the full list (shines.js only in a browser: the
// build scripts read this file too)
async function adoptedColors() {
  const { loadAdoptions, ADOPT_FROM } = await import("./shines.js");
  const [adopted, all] = await Promise.all([loadAdoptions(), loadList("default")]);
  const kept = new Set(Object.entries(adopted).filter(([, a]) => a.amount >= ADOPT_FROM).map(([slug]) => slug));
  const slugs = slugsOf(all);
  return all.filter((c) => kept.has(slugs.get(c.name)));
}

// about one just-noticeable difference in OKLab
export const UNNAMED = 0.02;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

export const rgbToOklab = ([r, g, b]) => {
  const { l, a, b: bb } = convertRgbToOklab({ r: r / 255, g: g / 255, b: b / 255 });
  return [l, a, bb];
};

// hue turned half way; a very dark or very light color also flips its lightness
export const complementOf = ([L, a, b]) => [L < 0.3 || L > 0.85 ? 1 - L : L, -a, -b];

// a sense listing sub-senses keeps its lead line; one that repeats an
// earlier sense goes
export const tidySenses = (senses) =>
  senses
    .filter((d, i) => !senses.slice(0, i).some((e) => e.includes(d)))
    .map((d) => d.split("\n")[0].trim().replace(/:$/, "."));

export const oklabToRgb = (L, a, b) => {
  const { r, g, b: bb } = convertOklabToRgb({ l: L, a, b });
  return [r, g, bb].map((c) => Math.round(clamp(c, 0, 1) * 255));
};

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

function prepare(colors) {
  const items = colors.map(({ name, hex }) => {
    hex = hex.toLowerCase();
    const rgb = hexToRgb(hex);
    const [L, a, b] = rgbToOklab(rgb);
    return { hex, name, lower: fold(name), rgb, L, a, b };
  });
  return { items, byHex: new Map(items.map((i) => [i.hex, i])) };
}

const prepared = new Map();
const ready = new Map();
export const getList = (key) => {
  if (!prepared.has(key))
    prepared.set(
      key,
      (key === "adopted" ? adoptedColors() : loadList(key))
        .then(prepare)
        .then((d) => (ready.set(key, d), d)),
    );
  return prepared.get(key);
};
// the list if it has loaded already, so a name can show without waiting a frame
export const loadedList = (key) => ready.get(key);

