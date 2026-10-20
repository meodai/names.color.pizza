import { fold, normalizeHex, rgbToOklab, hexToRgb } from "./names.js";

// A–Z: the list as the first site had it, one bar per name in its own color, A to Z.
// The wall's own search filters it by name or hex; its color picker shows the names
// closest to a color.
const ROW = 64; // px, as .az__row in the CSS
const CLOSEST = 60;

const escapeHTML = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// light text on dark colors, as the first site decided it
const isDark = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000 < 125;
const count = (n) => n.toLocaleString("en-US");

export function createAz(before, { hrefOf, onLeave }) {
  const el = document.createElement("section");
  el.className = "az";
  el.hidden = true;
  el.setAttribute("aria-label", "Every name, A to Z");
  el.innerHTML = `<p class="az__said" aria-live="polite" data-az-count></p>
    <div class="az__list" data-az-list tabindex="-1">
      <div class="az__sizer" data-az-sizer></div>
      <div class="az__rows" data-az-rows></div>
    </div>
    <div class="az__none" data-az-none hidden>
      <p class="az__none-title" data-az-none-title></p>
      <a class="az__none-link" href="https://github.com/meodai/color-names/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">Then name it yourself</a>
    </div>`;
  before.before(el);
  const countEl = el.querySelector("[data-az-count]");
  const scrollEl = el.querySelector("[data-az-list]");
  const sizerEl = el.querySelector("[data-az-sizer]");
  const rowsEl = el.querySelector("[data-az-rows]");
  const noneEl = el.querySelector("[data-az-none]");
  const noneTitle = el.querySelector("[data-az-none-title]");

  let all = [];
  let shown = [];
  let frame = 0;

  const rowHTML = (it, i) =>
    `<a class="az__row${isDark(it.rgb) ? " is-dark" : ""}" href="${escapeHTML(hrefOf(it))}" data-i="${i}" style="--c:${it.hex}"><strong>${escapeHTML(it.name)}</strong><span>${it.hex}</span></a>`;

  function render() {
    frame = 0;
    const top = scrollEl.scrollTop;
    const start = Math.max(0, Math.floor(top / ROW) - 8);
    const end = Math.min(shown.length, Math.ceil((top + scrollEl.clientHeight) / ROW) + 8);
    rowsEl.style.transform = `translateY(${start * ROW}px)`;
    let html = "";
    for (let i = start; i < end; i++) html += rowHTML(shown[i], i);
    rowsEl.innerHTML = html;
  }

  // scroll: where to be in the list (a number), or keep where it is (true)
  function show(list, label, scroll = 0) {
    shown = list;
    sizerEl.style.height = `${list.length * ROW}px`;
    countEl.textContent = label;
    noneEl.hidden = list.length > 0;
    if (scroll !== true) scrollEl.scrollTop = scroll || 0;
    render();
  }

  function closest(hex, keepScroll) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    const near = all
      .map((it) => [it, (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2])
      .sort((x, y) => x[1] - y[1])
      .slice(0, CLOSEST)
      .map(([it]) => it);
    show(near, `The ${CLOSEST} closest to ${hex}`, keepScroll);
  }

  // text from the search: a whole hex shows its closest names, anything else filters
  function filter(text = "", keepScroll = false) {
    const raw = text.trim();
    if (!raw) return show(all, `${count(all.length)} names, A to Z`, keepScroll);
    const hex = normalizeHex(raw);
    if (hex && raw.replace("#", "").length === 6) return closest(hex, keepScroll);
    const q = fold(raw.replace(/^#/, ""));
    const found = all.filter((it) => it.lower.includes(q) || it.hex.includes(q));
    // nothing found: the whole count, and a way to add the missing one
    if (!found.length) noneTitle.textContent = `${count(all.length)} colors and you can’t find the one?!`;
    show(
      found,
      found.length ? `${count(found.length)} of ${count(all.length)} with “${raw}”` : `No name has “${raw}” in it`,
      keepScroll,
    );
  }

  // a name opens its page; the list remembers where it was for the way back
  rowsEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (row) onLeave?.(scrollEl.scrollTop, row.href);
  });
  scrollEl.addEventListener("scroll", () => (frame ||= requestAnimationFrame(render)), { passive: true });
  new ResizeObserver(() => !el.hidden && render()).observe(scrollEl);

  return {
    // items: the list in the wall, already prepared (name, hex, rgb, lower, OKLab)
    open(items, text, keepScroll = true) {
      all = [...items].sort((x, y) => x.lower.localeCompare(y.lower));
      el.hidden = false;
      filter(text, keepScroll);
    },
    close() {
      el.hidden = true;
    },
    filter,
    closest,
  };
}
