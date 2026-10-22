import { fold, normalizeHex, rgbToOklab, hexToRgb } from "./names.js";
import { reduceMotion, easeInOut } from "./wall/math.js";

// A–Z: the list as the first site had it, one bar per name in its own color, A to Z.
// The wall's own search filters it by name or hex; its color picker shows the names
// closest to a color.
const ROW = 64; // px, as .az__row in the CSS
const CLOSEST = 60;
// rows coming in: each one 30ms after the one above it, each taking this long
const ROW_IN_MS = 420;
const REVEAL_MS = 700;

const escapeHTML = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// light text on dark colors, as the first site decided it
const isDark = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000 < 125;
const count = (n) => n.toLocaleString("en-US");

export function createAz(before, { hrefOf, iconOf, onLeave }) {
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
  let first = 0;
  let entering = 0;
  // the row the dice landed on, and the scroll there
  let picked = -1;
  let glide = 0;

  const rowHTML = (it, i) => {
    const icon = iconOf?.(it);
    return `<a class="az__row${isDark(it.rgb) ? " is-dark" : ""}${i === picked ? " is-picked" : ""}" href="${escapeHTML(hrefOf(it))}" data-i="${i}" style="--c:${it.hex};--i:${Math.max(0, i - first)}">${icon ? `<img class="az__icon" src="${escapeHTML(icon)}" alt="" decoding="async">` : icon === "" ? `<i class="az__icon"></i>` : ""}<strong>${escapeHTML(it.name)}</strong><span>${it.hex}</span></a>`;
  };

  function render() {
    frame = 0;
    const top = scrollEl.scrollTop;
    first = Math.floor(top / ROW);
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
    picked = -1;
    sizerEl.style.height = `${list.length * ROW}px`;
    countEl.textContent = label;
    noneEl.hidden = list.length > 0;
    if (scroll !== true) scrollEl.scrollTop = scroll || 0;
    render();
  }

  function closest(hex, keepScroll) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    // the closest few in one pass, kept in order as it goes: no sorting all of them
    const best = [];
    for (const it of all) {
      const d = (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2;
      if (best.length === CLOSEST && d >= best[CLOSEST - 1][1]) continue;
      let k = best.length;
      while (k > 0 && best[k - 1][1] > d) k--;
      best.splice(k, 0, [it, d]);
      if (best.length > CLOSEST) best.pop();
    }
    const near = best.map(([it]) => it);
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
  // the rows' entrance is over once someone takes the list in hand: rows drawn again after
  // that would only start it over
  const settle = () => {
    cancelAnimationFrame(glide);
    clearTimeout(entering);
    el.classList.remove("is-entering");
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"])
    scrollEl.addEventListener(type, settle, { passive: true });
  new ResizeObserver(() => !el.hidden && render()).observe(scrollEl);

  return {
    // items: the list in the wall, already prepared (name, hex, rgb, lower, OKLab)
    // delay: when the rows start coming in, one after another; none, they're simply there
    open(items, text, keepScroll = true, delay = -1) {
      all = [...items].sort((x, y) => x.lower.localeCompare(y.lower));
      el.hidden = false;
      settle();
      el.classList.toggle("is-entering", delay >= 0);
      el.style.setProperty("--az-delay", `${Math.max(0, delay)}ms`);
      filter(text, keepScroll);
      if (delay >= 0) {
        const rows = Math.ceil(scrollEl.clientHeight / ROW);
        entering = setTimeout(() => el.classList.remove("is-entering"), delay + rows * 30 + ROW_IN_MS);
      }
    },
    close() {
      settle();
      el.hidden = true;
    },
    filter: (text, keepScroll) => {
      settle();
      filter(text, keepScroll);
    },
    closest: (hex, keepScroll) => {
      settle();
      closest(hex, keepScroll);
    },
    // a name, from the whole list, scrolled to the middle quickly and marked
    reveal(name) {
      settle();
      filter("", true);
      const at = shown.findIndex((it) => it.name === name);
      if (at < 0) return;
      picked = at;
      const from = scrollEl.scrollTop;
      const to = Math.max(
        0,
        Math.min(at * ROW - (scrollEl.clientHeight - ROW) / 2, shown.length * ROW - scrollEl.clientHeight),
      );
      const t0 = performance.now();
      const step = (now) => {
        const t = reduceMotion ? 1 : Math.min(1, (now - t0) / REVEAL_MS);
        scrollEl.scrollTop = from + (to - from) * easeInOut(t);
        if (t < 1) glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    },
    // drawn again as they are, say once their drawings are known
    refresh: () => !el.hidden && render(),
    // the keys that move through a list, wherever the focus is; true if it was one of them
    scrollKey(key) {
      if (el.hidden) return false;
      const page = scrollEl.clientHeight - ROW;
      const by = { ArrowDown: ROW, ArrowUp: -ROW, PageDown: page, PageUp: -page }[key];
      if (by) scrollEl.scrollBy({ top: by });
      else if (key === "Home") scrollEl.scrollTo({ top: 0 });
      else if (key === "End") scrollEl.scrollTo({ top: scrollEl.scrollHeight });
      else return false;
      settle();
      return true;
    },
  };
}
