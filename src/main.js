import { initStacks } from "./stacks.js";

const hero = document.querySelector("#top");
if (hero) initStacks(hero);

function lazySection(selector, load) {
  const el = document.querySelector(selector);
  if (!el) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load(el);
    },
    { rootMargin: "300px" },
  );
  io.observe(el);
}

lazySection("#color-space", (el) => import("./color-space.js").then((m) => m.initColorSpace(el)));

if (new URLSearchParams(location.search).has("color")) {
  document.querySelector("#name-map")?.scrollIntoView();
}

lazySection("#name-map", (el) => import("./name-map.js").then((m) => m.initNameMap(el)));

lazySection("#submit", (el) => import("./submit.js").then((m) => m.initSubmit(el)));

lazySection("#explore", (el) => import("./explore.js").then((m) => m.initExplore(el)));
