/*
  Art — works from the Harvard Art Museums whose colors are close to a
  color. The museums read the colors of each work's picture (fewer than 20,
  each with its share of the picture); a work matches a color when the
  colors of it close to that color make up a good part of the picture.

  The build picks each name's works from an index of the collection that
  scripts/art.mjs makes with the museums' API (its key stays in the nightly
  job), refreshed weekly: the museums ask that nothing from their API is
  kept longer than two weeks, so an older index isn't used at all. Images
  are shown from the address the API gives, each work links back to its
  page on the museums' site, and the section says where they come from, as
  the museums' terms ask.
*/

import { hexToRgb, rgbToOklab } from "./names.js";

const CLOSE = 0.06; // OKLab distance: the museums' colors are rounded, so a little room
const WIDER = 0.09; // how far to look when too few are that close
const SHARE = 0.05; // how much of the picture has to be the color
export const ART_COUNT = 6;
export const MAX_AGE_DAYS = 14; // the museums' terms: kept no longer than two weeks

// The index, as kept (gzipped JSON, small enough for the data branch):
//   [[id, title, artist, date, urn, ratio, "c8c8c8:56 c8afaf:37 …"], …]
// colors as hex and their share in percent, those of 3% or more
export const MIN_SHARE = 0.03;

export function packWork(record) {
  const image = record.images?.[0];
  const base = image?.baseimageurl || record.primaryimageurl || "";
  const urn = base.match(/urn-3:HUAM:[^/?#]+/i)?.[0];
  const colors = (record.colors || [])
    .filter((c) => c.percent >= MIN_SHARE && /^#[0-9a-f]{6}$/i.test(c.color))
    .map((c) => `${c.color.slice(1).toLowerCase()}:${Math.round(c.percent * 100)}`)
    .join(" ");
  if (!urn || !colors) return null;
  const ratio = image?.width && image?.height ? Math.round((image.width / image.height) * 1000) / 1000 : 1;
  const artist = record.people?.find((p) => p.role === "Artist")?.name || record.people?.[0]?.name || "";
  return [record.id, record.title || "", artist, record.dated || "", urn, ratio, colors];
}

// …and as the build uses it: each color also in OKLab, [L, A, B, share, hex]
export function unpackWork([id, title, artist, date, urn, ratio, colors]) {
  return {
    id,
    title,
    artist,
    date,
    url: `https://harvardartmuseums.org/collections/object/${id}`,
    image: urn,
    ratio,
    colors: colors.split(" ").map((c) => {
      const [hex, share] = c.split(":");
      return [...rgbToOklab(hexToRgb(`#${hex}`)), share / 100, `#${hex}`];
    }),
  };
}

// The museums round every color to a small palette (under 800 colors), and
// gray is in most works: so the works are listed by palette color, keeping
// for each the TOP where that color covers the most. A color then only
// looks at the lists of the palette colors near it. Returns the works with
// a color near (L, A, B).
const TOP = 300;
export function bucketed(works) {
  const lists = new Map(); // hex → { lab, works: [[share, work]] }
  for (const w of works) {
    for (const [L, A, B, share, hex] of w.colors) {
      if (!lists.has(hex)) lists.set(hex, { lab: [L, A, B], works: [] });
      lists.get(hex).works.push([share, w]);
    }
  }
  const palette = [...lists.values()];
  for (const p of palette) p.works = p.works.sort((x, y) => y[0] - x[0]).slice(0, TOP).map(([, w]) => w);
  return (L, A, B) => {
    const found = new Set();
    for (const p of palette) {
      if (Math.hypot(p.lab[0] - L, p.lab[1] - A, p.lab[2] - B) >= WIDER) continue;
      for (const w of p.works) found.add(w);
    }
    return [...found];
  };
}

// The works for a color: those where its colors within reach of this one
// cover the most of the picture, one work per artist; each with that share
// and the closest of its colors
export function pickArt(candidates, hex, count = ART_COUNT) {
  const [L, A, B] = rgbToOklab(hexToRgb(hex));
  const scored = (reach) =>
    candidates
      .map((w) => {
        let share = 0;
        let best = null;
        for (const c of w.colors) {
          const d = Math.hypot(c[0] - L, c[1] - A, c[2] - B);
          if (d >= reach) continue;
          share += c[3];
          if (!best || d < best.d) best = { d, hex: c[4] };
        }
        return best && share >= SHARE ? { w, share, best } : null;
      })
      .filter(Boolean)
      .sort((x, y) => y.share - x.share || x.best.d - y.best.d);
  let ranked = scored(CLOSE);
  if (ranked.length < count) ranked = scored(WIDER);
  const artists = new Set();
  const picked = [];
  for (const { w, share, best } of ranked) {
    const artist = w.artist || `#${w.id}`;
    if (artists.has(artist)) continue;
    artists.add(artist);
    const { colors: _colors, ...work } = w;
    picked.push({ ...work, share: Math.round(share * 100) / 100, color: best.hex });
    if (picked.length === count) break;
  }
  return picked;
}

// The picture at a size (IIIF: fitting in width×width). The API gives an
// nrs.harvard.edu address, a library service that has been refusing most
// requests since 2026 (github.com/harvardartmuseums/api-docs/issues/29);
// the same picture, by the same identifier, comes from the museums' own
// image server, the one their website uses
export function artImage(base, width = 600) {
  const urn = base.match(/urn-3:HUAM:[^/?#:]+/i)?.[0];
  return urn
    ? `https://images.harvardartmuseums.org/${urn}:IMAGE/full/!${width},${width}/0/default.jpg`
    : `${base}/full/!${width},${width}/0/default.jpg`;
}
