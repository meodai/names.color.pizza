import { hexToRgb, rgbToOklab } from "./names.js";

// OKLab distance, and the share of the picture the close colors need
const CLOSE = 0.05;
const SHARE = 0.05;
const MIN_SHARE = 0.03;
export const ART_COUNT = 30;

// colors: [L, A, B, share, hex]
export const MEDIA = "https://media.color.pizza";

// only works with a copy on media.color.pizza
export function unpackWork(w, museum) {
  const colors = (w.palette || [])
    .filter((c) => c.share / 100 >= MIN_SHARE && /^#[0-9a-f]{6}$/i.test(c.hex))
    .map((c) => [...rgbToOklab(hexToRgb(c.hex)), c.share / 100, c.hex.toLowerCase()]);
  if (!w.thumb || !colors.length) return null;
  return {
    id: w.id,
    title: w.title || "",
    artist: (w.artist || "").replace(/\s*\(.*$/, ""),
    date: w.date || "",
    url: w.url,
    image: `${MEDIA}/${w.thumb}`,
    ...(w.source ? { source: w.source } : {}),
    ratio: w.width && w.height ? Math.round((w.width / w.height) * 1000) / 1000 : 1,
    museum,
    palette: (w.palette || []).map((c) => [c.hex.toLowerCase(), c.share]),
    colors,
  };
}

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

export const paletteHTML = (palette = [], match) =>
  palette.length
    ? `<span class="art__palette">${palette
        .map(
          ([hex, share], i) =>
            `<a href="#${hex.slice(1)}"${hex === match ? ' class="is-match"' : ""} style="flex-grow:${share};background:${hex};--i:${i}" aria-label="${hex}"></a>`,
        )
        .join("")}</span>`
    : "";

// OKLab grid of cells CLOSE wide, each capped to the TOP largest shares
// (grays are in most works)
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

export const MUSEUMS = {
  "chicago-art": { name: "Art Institute of Chicago", url: "https://www.artic.edu/open-access/open-access-images" },
  "cleveland-art": { name: "Cleveland Museum of Art", url: "https://www.clevelandart.org/open-access" },
  "met-art": { name: "Metropolitan Museum of Art", url: "https://www.metmuseum.org/hubs/open-access" },
  "pdia-art": { name: "Public Domain Image Archive", url: "https://pdimagearchive.org" },
  albums: { name: "Cover Art Archive", url: "https://coverartarchive.org" },
};

export function creditHTML(works) {
  const museums = Object.entries(MUSEUMS).filter(
    ([folder]) => folder !== "albums" && works.some((w) => w.museum === folder),
  );
  const covers = works.some((w) => w.museum === "albums")
    ? ` Album covers from the <a href="${MUSEUMS.albums.url}" target="_blank" rel="noopener">Cover Art Archive</a>.`
    : "";
  if (!museums.length) return covers.trim();
  const links = museums.map(
    ([, m]) => `the <a href="${m.url}" target="_blank" rel="noopener">${escapeHTML(m.name)}</a>`,
  );
  const list = links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links.at(-1)}` : links[0];
  return `From the open-access collection${museums.length > 1 ? "s" : ""} of ${list}.${covers}`;
}
