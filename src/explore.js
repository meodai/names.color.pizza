import { converter, differenceEuclidean } from "culori";
import { loadList } from "./api.js";
import { fold } from "./names.js";

const ROW = 44; // px — must match .explore__row height in CSS
const toHsl = converter("hsl");
const distance = differenceEuclidean("oklab");
const fmt = (n) => n.toLocaleString("en-US");

const escapeHTML = (s) =>
  s.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );

export function initExplore(root) {
  const searchEl = root.querySelector("[data-search]");
  const pickEl = root.querySelector("[data-pick]");
  const resetEl = root.querySelector("[data-reset]");
  const countEl = root.querySelector("[data-count]");
  const scrollEl = root.querySelector("[data-list]");
  const sizerEl = root.querySelector("[data-sizer]");
  const rowsEl = root.querySelector("[data-rows]");

  let all = [];
  let byHue = [];
  let list = [];
  let query = "";
  let picked = null;

  function rowHTML(c) {
    return `<button type="button" class="explore__row" data-hex="${c.hex}" style="--swatch:${c.hex}">
      <span class="explore__swatch" aria-hidden="true"></span>
      <span class="explore__name">${escapeHTML(c.name)}</span>
      <span class="explore__hex">${c.hex}</span>
    </button>`;
  }

  let rafPending = false;
  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderRows();
    });
  }

  function renderRows() {
    const scrollTop = scrollEl.scrollTop;
    const viewport = scrollEl.clientHeight || 1;
    const start = Math.max(0, Math.floor(scrollTop / ROW) - 6);
    const end = Math.min(list.length, Math.ceil((scrollTop + viewport) / ROW) + 6);
    rowsEl.style.transform = `translateY(${start * ROW}px)`;
    let html = "";
    for (let i = start; i < end; i++) html += rowHTML(list[i]);
    rowsEl.innerHTML = html;
  }

  function setList(next, label) {
    list = next;
    sizerEl.style.height = `${next.length * ROW}px`;
    countEl.textContent = label;
    scrollEl.scrollTop = 0;
    renderRows();
  }

  function update() {
    if (query) {
      const q = fold(query);
      const found = byHue.filter((c) => fold(c.name).includes(q));
      setList(found, `${fmt(found.length)} of ${fmt(all.length)}`);
    } else if (picked) {
      const ranked = all
        .map((c) => ({ c, d: distance(picked, c.hex) }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.c);
      setList(ranked, `Closest to ${picked}`);
    } else {
      setList(byHue, `${fmt(all.length)} names`);
    }
  }

  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim();
    if (query) picked = null;
    update();
  });

  pickEl.addEventListener("input", () => {
    picked = pickEl.value;
    query = "";
    searchEl.value = "";
    update();
  });

  resetEl.addEventListener("click", () => {
    query = "";
    picked = null;
    searchEl.value = "";
    update();
  });

  rowsEl.addEventListener("click", (event) => {
    const row = event.target.closest("[data-hex]");
    if (!row) return;
    picked = row.dataset.hex;
    pickEl.value = picked;
    query = "";
    searchEl.value = "";
    update();
  });

  scrollEl.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", renderRows);

  loadList("default").then((colors) => {
    all = colors;
    for (const c of all) {
      const h = toHsl(c.hex);
      // achromatic colours have no hue: float them to the top
      c._h = h.h == null || Number.isNaN(h.h) ? -1 : h.h;
      c._l = h.l == null ? 0 : h.l;
    }
    byHue = [...all].sort((a, b) => a._h - b._h || a._l - b._l);
    update();
  });
}
