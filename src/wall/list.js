import { getList, siteURL, slugsOf } from "../names.js";
import { createAz } from "../az.js";
import { reduceMotion, clamp, easeInOut } from "./math.js";

// into the A–Z list: the camera pulls all the way out as the space fades, then the rows come
export const AZ_MS = 700;

// The A–Z list: the names as one long column instead of the space; the model stays as it was.
// wall: items(), search (the search box), saveable() the camera as it is, flyTo(to, ms), home(),
// busy(), stopIdle(), request(), showModel(), showView(), pixelOn(), pixelOf(i), maxDist
export function createList(root, wall) {
  const q = (s) => root.querySelector(s);
  let on = false;
  let az = null;
  // how far the space has faded for it, 0 to 1
  let mix = 0;
  let fade = null;
  // the camera from before it, to go back to after it
  let from = null;

  // advanced each frame, by the space's drawing
  function step(time) {
    if (!fade) return;
    const k = reduceMotion ? 1 : clamp((time - fade.t0) / AZ_MS, 0, 1);
    mix = fade.from + (fade.to - fade.from) * easeInOut(k);
    if (k >= 1) fade = null;
  }

  // it starts as far below the top bar's controls as they are below the top; where a bar
  // rests, from its layout: the bars slide in on every arrival, and a rect would catch them
  // on the way
  const rest = (el) => {
    let top = 0;
    for (let e = el; e; e = e.offsetParent) top += e.offsetTop;
    return { top, bottom: top + el.offsetHeight, height: el.offsetHeight };
  };
  const place = () => {
    const list = root.querySelector(".az__list");
    if (!list) return;
    const find = rest(q("[data-find]"));
    const onTop = find.top < innerHeight / 2;
    const top = onTop ? find : rest(q("[data-menu]"));
    list.style.setProperty("--az-top", `${Math.round(top.bottom + top.top)}px`);
    // and room at the end for whatever floats at the bottom: the models and lists, or the search
    const below = [q(".wall__dock"), onTop ? null : q("[data-find]")]
      .map((el) => el && rest(el))
      .filter((b) => b && b.height && b.top > innerHeight / 2);
    const lowest = below.length ? Math.min(...below.map((b) => b.top)) : innerHeight;
    const gap = below.length ? innerHeight - Math.max(...below.map((b) => b.bottom)) : 0;
    list.style.setProperty("--az-bottom", `${Math.round(innerHeight - lowest + gap)}px`);
    // names start under the parrot, hexes end under GitHub (on a phone, the menu)
    const box = list.getBoundingClientRect();
    const logo = q(".wall__brand .brand__logo")?.getBoundingClientRect();
    // the text's own edge, the last 0 of the version, not the link's padded box
    const textBox = (el) => {
      if (!el?.offsetWidth) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const end = textBox(q(".wall__nav a")) || q("[data-menu]").getBoundingClientRect();
    if (logo?.width) list.style.setProperty("--az-left", `${Math.round(logo.left - box.left)}px`);
    if (end)
      list.style.setProperty("--az-right", `${Math.max(8, Math.round(box.left + list.clientWidth - end.right))}px`);
  };
  addEventListener("resize", () => on && place());

  // pages are named by the full list's slugs, whichever list is shown
  let slugs = null;
  let index = {};
  // the chip, the address and the list follow at once; the list fills once its names are in.
  // The space fades out under it as the camera pulls all the way out, and back after to where
  // it was; a page that opens on the list (restore) has it there at once
  function set(next, restore = null) {
    if (next === on) return;
    on = next;
    root.classList.toggle("is-az", on);
    root.scrollLeft = 0;
    wall.showModel();
    wall.showView();
    const t0 = performance.now();
    fade = restore || reduceMotion ? null : { from: mix, to: on ? 1 : 0, t0 };
    if (!fade) mix = on ? 1 : 0;
    if (!on) {
      az?.close();
      if (!wall.busy()) wall.flyTo(from ?? wall.home(), AZ_MS);
      from = null;
      return wall.request();
    }
    wall.stopIdle();
    if (!restore) from = wall.saveable();
    if (fade && !wall.busy()) wall.flyTo({ dist: wall.maxDist }, AZ_MS);
    wall.request();
    wall.search.clearResults();
    if (restore?.text) wall.search.restoreText(restore.text);
    getList("default").then((full) => {
      if (!on) return;
      slugs ||= slugsOf(full.items);
      az ||= createAz(q(".wall__dock"), {
        hrefOf: (it) => siteURL(`color/${slugs.get(it.name)}/`),
        // in pixel art, each name with its drawing in front
        iconOf: (it) => {
          if (!wall.pixelOn()) return null;
          const items = wall.items();
          if (index.items !== items) index = { items, at: new Map(items.map((x, i) => [x, i])) };
          // a name not drawn yet keeps the room, so the names stay in line
          return wall.pixelOf(index.at.get(it))?.src ?? "";
        },
        // where the list was, for coming back from the color page
        onLeave: (scroll, href) => {
          try {
            sessionStorage.setItem(
              "az-view",
              JSON.stringify({ text: wall.search.input.value, scroll, page: new URL(href).pathname, at: Date.now() }),
            );
          } catch {}
        },
      });
      // the rows start coming in soon after the space starts to fade; at once when the page
      // opens on the list
      az.open(
        wall.items(),
        wall.search.input.value,
        restore?.scroll,
        fade ? Math.max(0, AZ_MS * 0.25 - (performance.now() - t0)) : -1,
      );
      place();
    });
  }

  // its keys: the arrows, Page and Home End move it, from a row as from anywhere else
  function keys(e) {
    if (az?.scrollKey(e.key)) return e.preventDefault();
    if (e.key === "/" && !e.target.closest?.("button, a")) {
      e.preventDefault();
      wall.search.input.focus();
    }
  }

  return {
    on: () => on,
    mix: () => mix,
    fading: () => !!fade,
    step,
    set,
    keys,
    az: () => az,
    // its rows drawn again, say once their drawings are known
    refresh: () => on && az?.refresh(),
    // another list of names, from the top
    reopen: () => on && az?.open(wall.items(), wall.search.input.value, 0),
  };
}
