import { fold, normalizeHex, rgbToOklab, hexToRgb } from "./names.js";

// A–Z: the list as the first site had it, one bar per name in its own color, A to Z.
// Typing filters by name or hex; picking a color shows the names closest to it.
const ROW = 64; // px, as .az__row in the CSS
const CLOSEST = 60;

const escapeHTML = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// light text on dark colors, as the first site decided it
const isDark = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000 < 125;

export function createAz(before, { hrefOf }) {
  const el = document.createElement("section");
  el.className = "az";
  el.hidden = true;
  el.setAttribute("aria-label", "Every name, A to Z");
  el.innerHTML = `<div class="az__bar">
      <label class="az__pick" title="Pick a color: its closest names">
        <input type="color" value="#dd2233" aria-label="Pick a color to see its closest names" data-az-pick />
      </label>
      <input class="az__filter" type="search" placeholder="Name or hex" aria-label="Filter by name or hex" spellcheck="false" data-az-filter />
      <p class="az__count" aria-live="polite" data-az-count></p>
    </div>
    <div class="az__list" data-az-list tabindex="-1">
      <div class="az__sizer" data-az-sizer></div>
      <div class="az__rows" data-az-rows></div>
    </div>`;
  before.before(el);
  const filterEl = el.querySelector("[data-az-filter]");
  const pickEl = el.querySelector("[data-az-pick]");
  const countEl = el.querySelector("[data-az-count]");
  const scrollEl = el.querySelector("[data-az-list]");
  const sizerEl = el.querySelector("[data-az-sizer]");
  const rowsEl = el.querySelector("[data-az-rows]");

  let all = [];
  let shown = [];
  let frame = 0;

  const rowHTML = (it) =>
    `<a class="az__row${isDark(it.rgb) ? " is-dark" : ""}" href="${escapeHTML(hrefOf(it))}" style="--c:${it.hex}"><strong>${escapeHTML(it.name)}</strong><span>${it.hex}</span></a>`;

  function render() {
    frame = 0;
    const top = scrollEl.scrollTop;
    const start = Math.max(0, Math.floor(top / ROW) - 8);
    const end = Math.min(shown.length, Math.ceil((top + scrollEl.clientHeight) / ROW) + 8);
    rowsEl.style.transform = `translateY(${start * ROW}px)`;
    let html = "";
    for (let i = start; i < end; i++) html += rowHTML(shown[i]);
    rowsEl.innerHTML = html;
  }

  function show(list, label) {
    shown = list;
    sizerEl.style.height = `${list.length * ROW}px`;
    countEl.textContent = label;
    scrollEl.scrollTop = 0;
    render();
  }

  const count = (n) => n.toLocaleString("en-US");
  function filter() {
    const raw = filterEl.value.trim();
    if (!raw) return show(all, `${count(all.length)} names`);
    const q = fold(raw.replace(/^#/, ""));
    const found = all.filter((it) => it.lower.includes(q) || it.hex.includes(q));
    show(found, found.length ? `${count(found.length)} of ${count(all.length)}` : `No name has “${raw}” in it`);
  }

  function closest(hex, typed = false) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    const near = all
      .map((it) => [it, (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2])
      .sort((x, y) => x[1] - y[1])
      .slice(0, CLOSEST)
      .map(([it]) => it);
    if (!typed) filterEl.value = "";
    show(near, `The ${CLOSEST} closest to ${hex}`);
  }

  filterEl.addEventListener("input", () => {
    const hex = normalizeHex(filterEl.value);
    if (hex && filterEl.value.trim().replace("#", "").length === 6) return closest(hex, true);
    filter();
  });
  pickEl.addEventListener("input", () => closest(pickEl.value));
  scrollEl.addEventListener("scroll", () => (frame ||= requestAnimationFrame(render)), { passive: true });
  new ResizeObserver(() => !el.hidden && render()).observe(scrollEl);

  return {
    // items: the list in the wall, already prepared (name, hex, rgb, lower, OKLab)
    open(items) {
      all = [...items].sort((x, y) => x.lower.localeCompare(y.lower));
      el.hidden = false;
      filter();
      filterEl.focus({ preventScroll: true });
    },
    close() {
      el.hidden = true;
    },
  };
}
