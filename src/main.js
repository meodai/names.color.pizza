/*
  Color Names microsite — entry point.
  Content is static in index.html, design lives in CSS (linked in the head).

  The interactive pieces (the 3D color-space viewer, the name map and the
  searchable list) are heavy, so each loads lazily the first time its section
  nears the viewport — the rest of the page stays a couple of kilobytes.
*/

import { initStacks } from "./stacks.js";

// The hero is above the fold, so its piling color cards start right away.
const hero = document.querySelector("#top");
if (hero) initStacks(hero);

// Load a heavy module the first time its section nears the viewport, so the
// initial page stays tiny.
function lazySection(selector, load) {
  const el = document.querySelector(selector);
  if (!el) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load(el);
    },
    { rootMargin: "300px" }
  );
  io.observe(el);
}

lazySection("#color-space", (el) =>
  import("./color-space.js").then((m) => m.initColorSpace(el))
);

// A shared link to a color (?color=…) opens the name map right away.
if (new URLSearchParams(location.search).has("color")) {
  document.querySelector("#name-map")?.scrollIntoView();
}

lazySection("#name-map", (el) =>
  import("./name-map.js").then((m) => m.initNameMap(el))
);

lazySection("#submit", (el) =>
  import("./submit.js").then((m) => m.initSubmit(el))
);

lazySection("#explore", (el) =>
  import("./explore.js").then((m) => m.initExplore(el))
);
