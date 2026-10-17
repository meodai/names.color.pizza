// ↑ ↑ ↓ ↓ ← → ← → B A: the site in pixel art, for the rest of the visit. The wall shows its
// drawings instead of the colors; on a color's page every card wears its drawing.

const KEY = "cn-pixel";
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const TILES = "https://media.color.pizza/pixel/";

let on = false;
try {
  on = sessionStorage.getItem(KEY) === "1";
} catch {}
document.documentElement.classList.toggle("is-pixel", on);

export const pixelMode = () => on;

function set(next) {
  on = next;
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {}
  document.documentElement.classList.toggle("is-pixel", on);
  if (on) pixelCards(document);
  window.dispatchEvent(new CustomEvent("pixelmode", { detail: on }));
}

let step = 0;
window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select")) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  step = key === KONAMI[step] ? step + 1 : key === KONAMI[0] ? 1 : 0;
  if (step < KONAMI.length) return;
  step = 0;
  set(!on);
});

// each card that knows its color's slug gets its drawing on top, once pixel art is on
export function pixelCards(root) {
  if (!on) return;
  for (const card of root.querySelectorAll(".swatchcard[data-slug]")) {
    const upper = card.querySelector(".swatchcard__upper");
    const had = upper?.querySelector(".swatchcard__pixel");
    if (!upper || had?.dataset.slug === card.dataset.slug) continue;
    had?.remove();
    const img = Object.assign(document.createElement("img"), {
      className: "swatchcard__pixel",
      src: `${TILES}${card.dataset.slug}.png`,
      alt: "",
      decoding: "async",
    });
    img.dataset.slug = card.dataset.slug;
    img.addEventListener("error", () => img.remove(), { once: true });
    upper.append(img);
  }
}
