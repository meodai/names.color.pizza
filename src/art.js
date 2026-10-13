/*
  Art — works from museums' open-access (CC0) collections whose colors are
  close to a color. Their palettes come from the art-colors data
  (github.com/meodai/art-colors): for each work its colors, each with its
  share of the picture; a work matches a color when the colors of it close
  to that color make up a good part of the picture.

  The build picks each name's works from that data (scripts/pages.mjs);
  the works are in the public domain, so the pictures are shown straight
  from the museums' servers, and each links back to its page there.
*/

import { hexToRgb, rgbToOklab } from "./names.js";

// A work is close to a color when it has a color within CLOSE of it in
// OKLab (a difference you can see, but the same color) that takes up at
// least SHARE of the picture
const CLOSE = 0.05;
const SHARE = 0.05;
const MIN_SHARE = 0.03; // colors smaller than this aren't looked at
export const ART_COUNT = 12; // at most, those where the color takes up the most

// A work of art-colors' works.json, as the build uses it: each color also
// in OKLab, [L, A, B, share, hex]
export function unpackWork(w, museum) {
  const colors = (w.palette || [])
    .filter((c) => c.share / 100 >= MIN_SHARE && /^#[0-9a-f]{6}$/i.test(c.hex))
    .map((c) => [...rgbToOklab(hexToRgb(c.hex)), c.share / 100, c.hex.toLowerCase()]);
  if (!w.image || !colors.length) return null;
  return {
    id: w.id,
    title: w.title || "",
    // "Camille Pissarro (French, 1830–1903)": the name is enough here
    artist: (w.artist || "").replace(/\s*\(.*$/, ""),
    date: w.date || "",
    url: w.url,
    image: w.image,
    ratio: w.width && w.height ? Math.round((w.width / w.height) * 1000) / 1000 : 1,
    museum,
    // the whole palette, for the strip under the picture: [hex, share in %]
    palette: (w.palette || []).map((c) => [c.hex.toLowerCase(), c.share]),
    colors,
  };
}

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// The strip of a work's palette, under its picture: each color as wide as
// the share of the picture it takes up, and a way to that color's page; the
// one close to the page's color (match) stands out
const paletteHTML = (palette = [], match) =>
  palette.length
    ? `<span class="art__palette">${palette
        .map(
          ([hex, share], i) =>
            `<a href="#${hex.slice(1)}"${hex === match ? ' class="is-match"' : ""} style="flex-grow:${share};background:${hex};--i:${i}" aria-label="${hex}"></a>`
        )
        .join("")}</span>`
    : "";

// A work as the page shows it: in a frame (tilted and hung by `style`), its
// palette under the picture; the picture and what it is lead to its page
// at the museum, each color of the palette to that color's page
export const workHTML = (w, style = "") => {
  const museum = `href="${escapeHTML(w.url)}" target="_blank" rel="noopener"`;
  return `<div class="art__work" style="${style}">
    <span class="art__frame"><a class="art__picture" ${museum}><img src="${escapeHTML(w.image)}" alt="${escapeHTML(w.title)}"
      loading="lazy" decoding="async" style="aspect-ratio:${w.ratio}" /></a>${paletteHTML(w.palette, w.color)}</span>
    <a class="art__caption" ${museum}>
      <span class="art__title"><span class="art__dot" style="background:${w.color}"></span>${escapeHTML(w.title)}</span>
      <span class="art__by">${escapeHTML([w.artist, w.date].filter(Boolean).join(", "))}</span>
    </a>
  </div>`;
};

// The colors of all works, in cells of OKLab as wide as CLOSE: a color
// then only looks at the cells around it, keeping in each the TOP colors
// that cover the most of their picture (the grays are in most works).
// Returns the works' colors within reach of (L, A, B), as [color, work].
const TOP = 400;
export function bucketed(works) {
  const key = (L, A, B) => `${Math.floor(L / CLOSE)},${Math.floor(A / CLOSE)},${Math.floor(B / CLOSE)}`;
  const cells = new Map();
  for (const w of works) {
    for (const c of w.colors) {
      const k = key(c[0], c[1], c[2]);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push([c, w]);
    }
  }
  for (const [k, list] of cells) cells.set(k, list.sort((x, y) => y[0][3] - x[0][3]).slice(0, TOP));
  return (L, A, B) => {
    const [l, a, b] = [L, A, B].map((v) => Math.floor(v / CLOSE));
    const found = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = cells.get(`${l + i},${a + j},${b + k}`);
          if (list) found.push(...list);
        }
    return found;
  };
}

// The works for a color: those with colors close to it, by how much of
// the picture those colors take up; each with that share and the closest
// of its colors
export function pickArt(near, hex, count = ART_COUNT) {
  const [L, A, B] = rgbToOklab(hexToRgb(hex));
  const byWork = new Map();
  for (const [c, w] of near(L, A, B)) {
    const d = Math.hypot(c[0] - L, c[1] - A, c[2] - B);
    if (d >= CLOSE) continue;
    const s = byWork.get(w) || { w, share: 0, best: null };
    s.share += c[3];
    if (!s.best || d < s.best.d) s.best = { d, hex: c[4] };
    byWork.set(w, s);
  }
  return [...byWork.values()]
    .filter((s) => s.share >= SHARE)
    .sort((x, y) => y.share - x.share || x.best.d - y.best.d)
    .slice(0, count)
    .map(({ w: { colors: _colors, ...work }, share, best }) => ({
      ...work,
      share: Math.round(share * 100) / 100,
      color: best.hex,
    }));
}

// For a color without a name: of the works picked for the nearest name,
// those with a color close to this one too, the closest of them as theirs
export function artNear(works, hex) {
  const [L, A, B] = rgbToOklab(hexToRgb(hex));
  return works.flatMap((w) => {
    let best = null;
    for (const [h] of w.palette || []) {
      const [l, a, b] = rgbToOklab(hexToRgb(h));
      const d = Math.hypot(l - L, a - A, b - B);
      if (d < CLOSE && (!best || d < best.d)) best = { d, hex: h };
    }
    return best ? [{ ...w, color: best.hex }] : [];
  });
}

// The museums whose works are in the data, by its folder, for the credit
export const MUSEUMS = {
  "chicago-art": { name: "Art Institute of Chicago", url: "https://www.artic.edu/open-access/open-access-images" },
  "cleveland-art": { name: "Cleveland Museum of Art", url: "https://www.clevelandart.org/open-access" },
};

// Where the works shown come from: "From the open-access collections of
// the Art Institute of Chicago and the Cleveland Museum of Art."
export function creditHTML(works) {
  const museums = Object.entries(MUSEUMS).filter(([folder]) => works.some((w) => w.museum === folder));
  if (!museums.length) return "";
  const links = museums.map(
    ([, m]) => `the <a href="${m.url}" target="_blank" rel="noopener">${escapeHTML(m.name)}</a>`
  );
  const list = links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links.at(-1)}` : links[0];
  return `From the open-access collection${museums.length > 1 ? "s" : ""} of ${list}.`;
}
