// The site in pixel art, switched by the wall's pixel button, for the rest of the visit: the
// wall shows its drawings instead of the colors; on a color's page every card wears its own.
import { blankURL } from "./pixel-blank.js";

const KEY = "cn-pixel";
// the bucket; a local preview reads it through its own server (vite.config.js), as only the
// site may read it into WebGL (CORS)
const MEDIA = location.hostname === "localhost" ? `${location.origin}/media/` : "https://media.color.pizza/";

// off unless turned on for the visit or asked for by the address (?view=pixel); the address
// asking for the colors or the cells has the last word
const view = new URLSearchParams(location.search).get("view");
let on = view === "pixel";
try {
  if (on) sessionStorage.setItem(KEY, "1");
  else if (view !== "colors" && view !== "cells") on = sessionStorage.getItem(KEY) === "1";
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
    sessionStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  document.documentElement.classList.toggle("is-pixel", on);
  if (on) pixelCards(document);
  window.dispatchEvent(new CustomEvent("pixelmode", { detail: on }));
}

// a color's address says so while pixel art is on, so a link passed along opens it the same way;
// once it's off, no longer, or the address would turn it back on
export function withPixel(href) {
  const url = new URL(href, location.href);
  if (on) url.searchParams.set("view", "pixel");
  else if (url.searchParams.get("view") === "pixel") url.searchParams.delete("view");
  return url.href;
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
    const hex = card.style.getPropertyValue("--c-color");
    if (!upper || (i === undefined && !hex) || had?.dataset.slug === card.dataset.slug) continue;
    had?.remove();
    const img = Object.assign(document.createElement("img"), {
      className: "swatchcard__pixel",
      src: i === undefined ? blankURL(hex) : a.tileURL(i),
      alt: "",
      decoding: "async",
    });
    img.dataset.slug = card.dataset.slug;
    upper.append(img);
  }
}
