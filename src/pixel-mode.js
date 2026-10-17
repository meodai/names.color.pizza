// The site in pixel art, switched by the wall's pixel button, for the rest of the visit: the
// wall shows its drawings instead of the colors; on a color's page every card wears its own.
import { siteURL } from "./names.js";

const KEY = "cn-pixel";
// the bucket; a local preview can't read it into WebGL (CORS), so it's served a copy
const MEDIA = location.hostname === "localhost" ? siteURL("pixel-mirror/") : "https://media.color.pizza/";

let on = false;
try {
  on = sessionStorage.getItem(KEY) === "1";
} catch {}
document.documentElement.classList.toggle("is-pixel", on);

export const pixelMode = () => on;

// the atlas's index, once: which slug sits in which slot, each drawing's version, the
// sheets of small drawings by name (art-colors-runner/pixel/publish.py)
let atlas = null;
export function pixelAtlas() {
  atlas ??= fetch(`${MEDIA}data/pixel-atlas.json`, { cache: "no-cache" })
    .then((r) => r.json())
    .then((a) => ({
      ...a,
      slot: new Map(a.slugs.map((slug, i) => [slug, i])),
      sheetURL: (n) => `${MEDIA}pixel-atlas/${a.sheets[n]}`,
      tileURL: (i) => `${MEDIA}pixel/${a.slugs[i]}.webp?v=${a.v[i]}`,
    }));
  return atlas;
}

export function setPixelMode(next) {
  if (next === on) return;
  on = next;
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {}
  document.documentElement.classList.toggle("is-pixel", on);
  if (on) pixelCards(document);
  window.dispatchEvent(new CustomEvent("pixelmode", { detail: on }));
}

// each card that knows its color's slug gets its drawing on top, once pixel art is on
export async function pixelCards(root) {
  if (!on) return;
  const a = await pixelAtlas().catch(() => null);
  if (!a) return;
  for (const card of root.querySelectorAll(".swatchcard[data-slug]")) {
    const upper = card.querySelector(".swatchcard__upper");
    const had = upper?.querySelector(".swatchcard__pixel");
    const i = a.slot.get(card.dataset.slug);
    if (!upper || i === undefined || had?.dataset.slug === card.dataset.slug) continue;
    had?.remove();
    const img = Object.assign(document.createElement("img"), { className: "swatchcard__pixel", src: a.tileURL(i), alt: "", decoding: "async" });
    img.dataset.slug = card.dataset.slug;
    upper.append(img);
  }
}
