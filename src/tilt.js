import parrot from "./favicon.svg?raw";
import { SHINES } from "./shines.js";

// the color's card tilts towards the pointer, or with the phone; an adopted
// color's card (10 or more) is holo: it catches the light in its own kind of
// foil, throws sparks from behind while it moves, and left alone sways a little
const previewing = new URLSearchParams(location.search).get("holo");
// ?holo or ?holo=<kind> previews one, VITE_HOLO=all every color, the kind then by the hex
export function previewShine(hex) {
  if (previewing == null && import.meta.env.VITE_HOLO !== "all") return null;
  if (SHINES.includes(previewing)) return previewing;
  return SHINES[[...hex].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SHINES.length];
}
const SPARK_COLORS = ["#fff", "hsl(2 100% 80%)", "hsl(52 100% 76%)", "hsl(176 100% 78%)", "hsl(286 100% 80%)"];
const PARROT_MASK = (() => {
  const [eye] = parrot.match(/<circle[^>]*>/);
  const shape = parrot
    .replace(/<circle[^>]*>/, "")
    .replace(
      /<svg([^>]*)>/,
      `<svg$1><mask id="e"><rect x="0" y="0" width="200" height="200" fill="#fff"/>${eye.replace(/fill="[^"]*"/, 'fill="#000"')}</mask><g mask="url(#e)">`,
    )
    .replace("</svg>", "</g></svg>");
  return `url("data:image/svg+xml,${encodeURIComponent(shape)}")`;
})();

export function tiltCard(card) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hero = card.closest("section") || card;
  card.classList.toggle("swatchcard--tilt", !calm);
  let kind = null;
  let sparks = null;
  let art = null;
  let held = false;
  let frame = 0;
  let last = { px: 0.5, py: 0.5, t: 0 };
  const clamp = (v) => Math.min(1, Math.max(0, v));

  // from behind an edge, out and away
  function spark() {
    if (!kind || calm || sparks.childElementCount > 40) return;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const side = Math.floor(Math.random() * 4);
    const along = Math.random();
    const [x, y, ox, oy] = [
      [along * w, 0, 0, -1],
      [w, along * h, 1, 0],
      [along * w, h, 0, 1],
      [0, along * h, -1, 0],
    ][side];
    const el = document.createElement("i");
    el.className = "holo-spark";
    const size = 10 + Math.random() * 18;
    el.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;background:${
      SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)]
    }`;
    sparks.append(el);
    const reach = 50 + Math.random() * 110;
    const spread = (Math.random() - 0.5) * reach;
    const dx = ox * reach + (oy ? spread : 0) - ox * 18;
    const dy = oy * reach + (ox ? spread : 0) - oy * 18;
    el.animate(
      [
        { transform: `translate(${-ox * 18}px, ${-oy * 18}px) scale(0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1) rotate(90deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.2) rotate(180deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 700, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    ).finished.then(() => el.remove(), () => el.remove());
  }

  const set = (px, py, shine) => {
    card.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    card.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    card.style.setProperty("--rx", `${((px - 0.5) * 26).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${((0.5 - py) * 26).toFixed(2)}deg`);
    card.style.setProperty("--shine", shine);
    card.style.setProperty("--tilt", Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2).toFixed(3));
    card.parentElement.style.setProperty("--lean-x", `${((px - 0.5) * 8).toFixed(1)}px`);
    card.parentElement.style.setProperty("--lean-y", `${((py - 0.5) * 8).toFixed(1)}px`);
  };
  // moved by hand or by tilt: the faster, the more sparks
  const move = (px, py) => {
    const now = performance.now();
    const speed = Math.hypot(px - last.px, py - last.py) / Math.max(16, now - last.t);
    for (let n = Math.min(4, Math.floor(speed * 260 + Math.random())); n > 0; n--) spark();
    last = { px, py, t: now };
    set(px, py, 0.95);
  };
  const sway = (t) => {
    if (!held) set(0.5 + 0.32 * Math.sin(t / 1700), 0.5 + 0.22 * Math.cos(t / 2300), 0.7);
    frame = requestAnimationFrame(sway);
  };

  if (!calm) {
    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const r = card.getBoundingClientRect();
      held = true;
      card.classList.add("is-tilting");
      move(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
    });
    hero.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      held = false;
      card.classList.remove("is-tilting");
      if (!kind) set(0.5, 0.5, 0);
    });
  }

  // the phone's tilt, from how it was held when it started
  let level = null;
  let gyro = false;
  const tilted = (e) => {
    if (e.gamma == null || e.beta == null) return;
    gyro = true;
    level ??= e.beta;
    held = true;
    card.classList.add("is-tilting");
    move(clamp(0.5 + e.gamma / 50), clamp(0.5 + (e.beta - level) / 50));
  };
  if (!calm) addEventListener("deviceorientation", tilted);
  // iOS only sends it once asked, and asking needs a tap
  if (!calm && typeof DeviceOrientationEvent?.requestPermission === "function")
    hero.addEventListener("pointerdown", () => DeviceOrientationEvent.requestPermission().catch(() => {}), {
      once: true,
    });

  // a finger: a tap throws sparks; without the phone's tilt, the card follows the
  // finger while held (sideways; up and down still scrolls the page)
  let finger = null;
  const at = (e) => {
    const r = card.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  const letGo = (e) => {
    if (e.pointerId !== finger) return;
    finger = null;
    held = false;
    card.classList.remove("is-tilting");
    if (!kind) set(0.5, 0.5, 0);
  };
  if (!calm) {
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      for (let n = 0; n < 8; n++) spark();
      if (gyro) return;
      finger = e.pointerId;
      held = true;
      card.classList.add("is-tilting");
      last = { px: 0.5, py: 0.5, t: performance.now() };
      move(...at(e));
    });
    card.addEventListener("pointermove", (e) => e.pointerId === finger && move(...at(e)));
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) card.addEventListener(type, letGo);
  }

  // a kind of foil, or null for a plain card
  function holo(next) {
    if (next === kind) return;
    kind = next;
    card.classList.toggle("swatchcard--holo", !!kind);
    if (!kind) {
      delete card.dataset.shine;
      cancelAnimationFrame(frame);
      frame = 0;
      sparks?.remove();
      art?.remove();
      sparks = art = null;
      if (!held) set(0.5, 0.5, 0);
      return;
    }
    card.dataset.shine = kind;
    if (!sparks) {
      sparks = Object.assign(document.createElement("div"), { className: "holo-sparks" });
      card.parentElement.prepend(sparks);
      art = Object.assign(document.createElement("div"), { className: "holo-parrot" });
      art.style.setProperty("--parrot", PARROT_MASK);
      card.querySelector(".swatchcard__upper").append(art);
    }
    if (!calm && !frame) frame = requestAnimationFrame(sway);
  }

  return {
    holo,
    stop() {
      holo(null);
      removeEventListener("deviceorientation", tilted);
    },
  };
}
