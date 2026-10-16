import { hexToRgb, rgbToOklab } from "./names.js";

// OKLab distance, and the share of the picture the close colors need
const CLOSE = 0.05;
const SHARE = 0.05;
const MIN_SHARE = 0.03;
const STRONG = 0.15;
const FULL = 0.3;
const ENOUGH = 30;
const FEW = 12;
// fewer than this repeat too much in the strip: topped up from further out
const FILL = 60;
export const ART_COUNT = 100;
// as many again when the two closest distances already have enough
const CLOSE_COUNT = 200;

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
    // an album or a single, a game's system, a film's category
    ...(COVERS[coverKind(museum)] ? { kind: w.type } : {}),
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
  // within (a box of) reach cells; with a radius, only the cells that come within it
  return (L, A, B, reach = 1, radius = Infinity) => {
    const [l, a, b] = [L, A, B].map((v) => Math.floor(v / CLOSE));
    // how far the point is from a cell's nearest side along one axis
    const gap = (v, cell) => Math.max(cell * CLOSE - v, v - (cell + 1) * CLOSE, 0);
    const found = [];
    for (let i = -reach; i <= reach; i++) {
      const gi = gap(L, l + i) ** 2;
      for (let j = -reach; j <= reach; j++) {
        const gj = gi + gap(A, a + j) ** 2;
        for (let k = -reach; k <= reach; k++) {
          if (gj + gap(B, b + k) ** 2 >= radius * radius) continue;
          const list = cells.get(`${l + i},${a + j},${b + k}`);
          if (list) for (const entry of list) found.push(entry);
        }
      }
    }
    return found;
  };
}

// works with the most of the color, as close to it as there are enough of:
// first works full of it, from the tightest match outward, then works with
// only a little of it
export function pickArt(near, hex, count = ART_COUNT) {
  const [L, A, B] = rgbToOklab(hexToRgb(hex));
  const RADII = [CLOSE * 0.4, CLOSE * 0.6, CLOSE, CLOSE * 1.6, CLOSE * 2.4];
  // one look at the widest reach, each distance measured once; every ring then takes
  // its share in the same order a look of its own would have found them
  const reach = RADII.at(-1);
  const around = [];
  for (const [c, w] of near(L, A, B, Math.ceil(reach / CLOSE), reach)) {
    const d = Math.hypot(c[0] - L, c[1] - A, c[2] - B);
    if (d < reach) around.push([c, w, d]);
  }
  // every work's share in each ring, gathered in one pass in the order found; on equal
  // scores a ring keeps the order its works first came up in
  const per = new Map();
  for (let n = 0; n < around.length; n++) {
    const [c, w, d] = around[n];
    let s = per.get(w);
    if (!s) per.set(w, (s = { w, share: [0, 0, 0, 0, 0], best: [null, null, null, null, null], first: [-1, -1, -1, -1, -1] }));
    for (let t = RADII.length - 1; t >= 0 && d < RADII[t]; t--) {
      s.share[t] += c[3];
      if (!s.best[t] || d < s.best[t].d) s.best[t] = { d, hex: c[4] };
      if (s.first[t] < 0) s.first[t] = n;
    }
  }
  const tiers = RADII.map((radius, t) => {
    const ring = [];
    for (const s of per.values()) {
      if (s.first[t] < 0) continue;
      // a closer match counts for a little more
      ring.push({ w: s.w, share: s.share[t], best: s.best[t], score: s.share[t] * (1 - (0.5 * s.best[t].d) / radius), first: s.first[t] });
    }
    return ring.sort((x, y) => y.score - x.score || x.first - y.first);
  });
  // at each distance, works mostly of the color if there are enough of them
  const strong = tiers.flatMap((t) => [FULL, STRONG].map((min) => t.filter((s) => s.share >= min)));
  const at = strong.findIndex((t) => t.length >= ENOUGH);
  if (at >= 0 && at < 4) count = Math.max(count, CLOSE_COUNT);
  const picked = [
    ...(strong[at] ||
      tiers.map((t) => t.filter((s) => s.share >= SHARE)).find((t) => t.length >= FEW) ||
      tiers.at(-1).filter((s) => s.share >= SHARE)),
  ];
  if (at >= 0 && picked.length < FILL) {
    // measured at the close distance, so they line up after the close ones
    const close = new Map(tiers[Math.floor(at / 2)].map((s) => [s.w, s.share]));
    const have = new Set(picked.map((s) => s.w));
    for (const s of strong.slice(at + 1).flat()) {
      if (picked.length >= FILL) break;
      if (have.has(s.w)) continue;
      have.add(s.w);
      picked.push({ ...s, share: close.get(s.w) ?? 0 });
    }
  }
  return picked.slice(0, count).map(({ w: { colors: _colors, ...work }, share, best }) => ({
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
  games: { name: "libretro thumbnails", url: "https://github.com/libretro-thumbnails" },
  movies: { name: "TMDB", url: "https://www.themoviedb.org" },
  "movies-japan": { name: "TMDB", url: "https://www.themoviedb.org" },
  "movies-b": { name: "TMDB", url: "https://www.themoviedb.org" },
  "movies-italian": { name: "TMDB", url: "https://www.themoviedb.org" },
  "movies-hongkong": { name: "TMDB", url: "https://www.themoviedb.org" },
  "movies-horror": { name: "TMDB", url: "https://www.themoviedb.org" },
};

// what isn't a museum's: the credit for each kind of cover
const COVERS = {
  albums: (m) => `Album covers from the <a href="${m.url}" target="_blank" rel="noopener">Cover Art Archive</a>.`,
  games: (m) => `Box art from <a href="${m.url}" target="_blank" rel="noopener">libretro thumbnails</a>.`,
  movies: (m) =>
    `Posters from <a href="${m.url}" target="_blank" rel="noopener">TMDB</a>; this site uses the TMDB API but is not endorsed or certified by TMDB.`,
};
const coverKind = (folder) => folder.replace(/-.*/, "");

export function creditHTML(works) {
  const used = Object.entries(MUSEUMS).filter(([folder]) => works.some((w) => w.museum === folder));
  const museums = used.filter(([folder]) => !COVERS[coverKind(folder)]);
  const covers = [...new Map(used.filter(([f]) => COVERS[coverKind(f)]).map(([f, m]) => [coverKind(f), m]))]
    .map(([kind, m]) => ` ${COVERS[kind](m)}`)
    .join("");
  if (!museums.length) return covers.trim();
  const links = museums.map(
    ([, m]) => `the <a href="${m.url}" target="_blank" rel="noopener">${escapeHTML(m.name)}</a>`,
  );
  const list = links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links.at(-1)}` : links[0];
  return `From the open-access collection${museums.length > 1 ? "s" : ""} of ${list}.${covers}`;
}
