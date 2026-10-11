/*
  Hero stacks — named color cards that fly in and pile up on the title.

  A port of the "Color Name Stacks" pen. Cards are appended over the hero and
  removed after a while so the DOM never grows unbounded. Adding pauses while
  the hero is off-screen, and the whole thing is skipped under reduced motion.
*/

import { loadList } from "./api.js";
import { colorURL } from "./names.js";

const INTERVAL = 2500; // ms between new cards
const LIFETIME = INTERVAL * 22; // how long a card lingers before it's removed

const rnd = () => -1 + Math.random() * 2;
const between = (min, max) => min + Math.random() * (max - min);

// Pick a landing spot that tends to avoid the centre text: the right third,
// the top ~10%, or the bottom ~10%. Values past ±1 push cards to the very
// edges (the transform multiplies y by 30vh). Once in a while it lands
// anywhere, so it reads as a tendency, not a hard rule.
function landingSpot() {
  if (Math.random() < 0.2) return [rnd(), rnd()];
  switch (Math.floor(Math.random() * 3)) {
    case 0:
      return [between(0.35, 1), rnd()]; // right third
    case 1:
      return [rnd(), between(-1.5, -1.25)]; // top ~10%
    default:
      return [rnd(), between(1.25, 1.5)]; // bottom ~10%
  }
}
const escapeHTML = (s) =>
  s.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );

function createCard(hex, name) {
  const card = document.createElement("a");
  card.className = "stack-card";
  card.href = colorURL(hex);
  const [landX, landY] = landingSpot();
  card.style.setProperty("--color", hex);
  card.style.setProperty("--rnd", rnd().toFixed(3));
  card.style.setProperty("--rnd2", rnd().toFixed(3));
  card.style.setProperty("--rnd3", landX.toFixed(3));
  card.style.setProperty("--rnd4", landY.toFixed(3));

  const swatch = document.createElement("div");
  swatch.className = "stack-card__swatch";

  const bottom = document.createElement("header");
  bottom.className = "stack-card__bottom";

  const nameEl = document.createElement("h2");
  nameEl.className = "stack-card__name";
  if (name.length > 20) nameEl.classList.add("stack-card__name--verylong");
  else if (name.length > 14) nameEl.classList.add("stack-card__name--long");
  nameEl.innerHTML = [...name]
    .map((ch, i) => {
      const heavy = ch === ch.toUpperCase() && /[A-Z]/.test(ch) ? " heavy" : "";
      return `<i class="${heavy.trim()}" style="--i:${(i / name.length).toFixed(
        3
      )}">${escapeHTML(ch)}</i>`;
    })
    .join("");

  const value = document.createElement("var");
  value.className = "stack-card__value";
  value.textContent = hex;

  bottom.append(nameEl, value);
  card.append(bottom, swatch);
  return card;
}

export function initStacks(root) {
  const wrap = root.querySelector("[data-wrap]");
  if (!wrap) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let colors = [];
  let visible = false;
  let timer = null;

  function addOne() {
    if (!colors.length) return;
    const { name, hex } = colors[Math.floor(Math.random() * colors.length)];
    const card = createCard(hex, name);
    wrap.appendChild(card);
    setTimeout(() => card.remove(), LIFETIME);
  }

  function start() {
    visible = true;
    if (timer == null) timer = setInterval(addOne, INTERVAL);
    addOne();
  }

  function stop() {
    visible = false;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) start();
    else stop();
  }).observe(root);

  loadList("bestOf").then((list) => {
    colors = list;
    if (visible) addOne();
  });
}
