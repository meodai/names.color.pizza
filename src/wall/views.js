import { reduceMotion } from "./math.js";

// One button for how the space shows its names: as colors, as cells or as pixel art. It is
// the one shown; pressed, it opens into tabs of all three, and closes again once one's picked.
// now: the view shown; picking: the moment one is picked; pick: once the tabs are closed round
// it, the view to change to (turning to pixel art takes the page a moment, which would
// stutter the tabs)
export function createViewSwitch(root, { now, picking, pick }) {
  const modes = root.querySelector("[data-modes]");
  const modeList = root.querySelector("[data-mode-list]");
  // a black marker under the view shown while the tabs are open: picked, it slides to the new
  // one, that one turns active, the tabs close round it, and only then the marker fades
  const modeThumb = modeList.querySelector(".wall__mode-thumb");
  const MODE_MS = reduceMotion ? 0 : 350;
  const modeActive = () => modeList.querySelector('[aria-checked="true"]');
  function show() {
    const view = now();
    for (const b of modeList.querySelectorAll("[data-mode]")) {
      b.setAttribute("aria-checked", String(b.dataset.mode === view));
      if (!modes.classList.contains("is-marked")) b.classList.toggle("is-last", b.dataset.mode === view);
    }
  }
  // the marker sits inside its tab, a little smaller, so the tabs needn't grow round it
  const INSET = 4;
  const placeThumb = (b) => {
    modeThumb.style.translate = `${b.offsetLeft + INSET}px ${b.offsetTop + INSET}px`;
    modeThumb.style.inlineSize = `${Math.max(0, b.offsetWidth - 2 * INSET)}px`;
    modeThumb.style.blockSize = `${b.offsetHeight - 2 * INSET}px`;
  };
  // the marker keeps to its tab while the tabs open or close under it
  function followThumb(b, ms) {
    modes.classList.add("is-tracking");
    const until = performance.now() + ms + 40;
    const step = (t) => {
      placeThumb(b);
      if (t < until) requestAnimationFrame(step);
      else modes.classList.remove("is-tracking");
    };
    requestAnimationFrame(step);
  }
  // "View" beside the switch on every visit, until it's first opened: it glides into it and goes
  const modeHint = root.querySelector("[data-mode-hint]");
  modeHint.hidden = false;
  function dropModeHint() {
    if (modeHint.hidden || modeHint.classList.contains("is-leaving")) return;
    modeHint.classList.add("is-leaving");
    setTimeout(() => (modeHint.hidden = true), reduceMotion ? 0 : 350);
  }
  let modeTimer = 0;
  function openModes() {
    clearTimeout(modeTimer);
    dropModeHint();
    modes.classList.add("is-open", "is-marked");
    followThumb(modeActive(), MODE_MS);
  }
  // closing: the other two icons fade, the farther first, and the marker with them; then the
  // tabs fold into the one button. Once it's all still the view changes
  const FADE_MS = reduceMotion ? 0 : 260;
  function closeModes(then) {
    if (!modes.classList.contains("is-open")) return;
    const b = modeActive();
    const all = [...modeList.querySelectorAll("[data-mode]")];
    all
      .filter((o) => o !== b)
      .sort((x, y) => Math.abs(all.indexOf(y) - all.indexOf(b)) - Math.abs(all.indexOf(x) - all.indexOf(b)))
      .forEach((o, k) => o.style.setProperty("--fade-delay", `${k * 80}ms`));
    modes.classList.remove("is-marked");
    modes.classList.add("is-fading");
    clearTimeout(modeTimer);
    modeTimer = setTimeout(() => {
      modes.classList.remove("is-open", "is-fading");
      modeTimer = setTimeout(() => {
        then?.();
        show();
      }, MODE_MS);
    }, FADE_MS);
  }
  modeList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    if (!modes.classList.contains("is-open")) return openModes();
    if (b === modeActive()) return closeModes();
    picking();
    placeThumb(b);
    // its icon turns white as the marker comes under it
    modeList.querySelectorAll(".is-target").forEach((t) => t.classList.remove("is-target"));
    b.classList.add("is-target");
    modes.classList.add("is-picking");
    clearTimeout(modeTimer);
    modeTimer = setTimeout(() => {
      modes.classList.remove("is-picking");
      b.classList.remove("is-target");
      for (const o of modeList.querySelectorAll("[data-mode]")) o.setAttribute("aria-checked", String(o === b));
      const want = b.dataset.mode;
      closeModes(() => pick(want));
    }, MODE_MS);
  });
  document.addEventListener("pointerdown", (e) => !modes.contains(e.target) && closeModes());
  // its keys: the arrows go from view to view (picking one, which closes the tabs, is Enter or
  // Space), Escape closes them
  function keys(e) {
    if (e.key === "Escape" && modes.classList.contains("is-open")) {
      closeModes();
      return modeActive().focus();
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const b = e.target.closest("[data-mode]");
    if (!step || !b) return;
    e.preventDefault();
    const all = [...modeList.querySelectorAll("[data-mode]")].filter((o) => o.offsetParent);
    all[(all.indexOf(b) + step + all.length) % all.length]?.focus();
  }
  return { show, keys };
}
