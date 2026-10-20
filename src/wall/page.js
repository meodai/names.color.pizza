import { getList, siteURL, colorURL, slugsOf, normalizeHex } from "../names.js";
import { withPixel } from "../pixel-mode.js";

// A color's page over the wall: its markup fetched once and laid over the space as a card
// opens into it, the wall out of reach beneath, the steps through its neighbors counted so
// close goes back past them all, and taken down again. The card's flight there and back is
// the wall's. wall: nameOf(hex) the name a hex is shown as, drawable(img) once a drawing can
// be drawn, shown() the moment the page takes over from the flight, onClose() when the page
// asks to be closed
export function createPage(root, wall) {
  let page = null;
  let markup = null;
  // resolve now: once a card is opening, the address is the color page's
  const pageURL = siteURL("color/");
  const loadMarkup = () =>
    (markup ??= fetch(pageURL)
      .then((r) => r.text())
      .then((html) => new DOMParser().parseFromString(html, "text/html").querySelector("main")));
  const loadDetail = () => import("../detail.js");
  setTimeout(() => {
    loadMarkup().catch(() => (markup = null));
    loadDetail().catch(() => {});
  }, 1500);

  const wallTitle = document.title;
  const wallIcon = document.querySelector('link[rel="icon"]').href;

  let slugs = null;
  // the closest name's own address, so a copied link previews; the hash keeps the color
  const toOwnURL = (it, hex = it.hex) => {
    if (!import.meta.env.PROD) return;
    slugs ??= getList("default").then((d) => slugsOf(d.items));
    slugs.then((s) => {
      const slug = s.get(it.name);
      if (slug && location.hash === `#${hex.slice(1)}`)
        history.replaceState(history.state, "", withPixel(`${new URL(`${slug}/`, pageURL).href}#${hex.slice(1)}`));
    });
  };

  // the view a color page's close leads back to: model, list, A–Z or cells, all in the address
  function rememberView() {
    try {
      sessionStorage.setItem("wall-view", JSON.stringify({ href: location.href, at: Date.now() }));
    } catch {}
  }

  // while a card opens into its page, and until it's back, the wall's own controls are out of
  // reach: unseen, they'd still take focus and clicks. The logo stays, it closes the page
  let focusBefore = null;
  function away(on) {
    for (const el of root.children) if (!el.matches(".brand, .wall__page, .wall__handoff")) el.inert = on;
    if (on) focusBefore = document.activeElement;
    else if (focusBefore?.isConnected && !focusBefore.closest("[inert]")) focusBefore.focus({ preventScroll: true });
  }

  // a card about to open: the address is its page's from now, so Back at any point on the way
  // in returns to the wall
  function enter(it) {
    rememberView();
    history.pushState({ colorDepth: 1 }, "", withPixel(colorURL(it.hex)));
    toOwnURL(it);
  }

  // the page, once the card has glided to its place; null if the opening was called off
  // meanwhile (task.cancelled)
  async function show(hex, returnTo, copy, task) {
    const [main, detail] = await Promise.all([loadMarkup(), loadDetail()]);
    if (task.cancelled) return null;
    wall.shown();
    const layer = document.createElement("div");
    layer.className = "wall__page";
    layer.append(document.importNode(main, true));
    // links on the color page are relative to color/, the address may be color/<name>/
    for (const a of layer.querySelectorAll("a[href]")) a.href = new URL(a.getAttribute("href"), pageURL).href;
    for (const img of layer.querySelectorAll("img[src]")) img.src = new URL(img.getAttribute("src"), pageURL).href;
    document.documentElement.dataset.root = new URL("../", pageURL).href;
    root.append(layer);
    // focus in the page, where reading it starts
    layer.tabIndex = -1;
    layer.focus({ preventScroll: true });
    const controller = new AbortController();
    page = { layer, controller, returnTo, hex, depth: 1 };
    detail.initDetailPage(layer, { embedded: true, signal: controller.signal, onClose: wall.onClose });
    // the copy stays over the page until the page's own card shows, its drawing decoded
    copy.classList.add("is-arriving");
    const own = layer.querySelector(".swatchcard__pixel--now");
    await wall.drawable(own);
    await own?.decode?.().catch(() => {});
    const card = layer.querySelector(".color-hero__card .swatchcard");
    const until = performance.now() + 600;
    while (card && !card.classList.contains("swatchcard--visible") && performance.now() < until)
      await new Promise((done) => requestAnimationFrame(done));
    requestAnimationFrame(() => requestAnimationFrame(() => copy.remove()));
    return page;
  }

  // each neighbor visited is one more history entry
  addEventListener("hashchange", () => {
    if (!page) return;
    page.hex = normalizeHex(location.hash.slice(1)) || page.hex;
    if (history.state?.colorDepth == null) {
      history.replaceState({ colorDepth: page.depth + 1 }, "");
    }
    page.depth = history.state.colorDepth;
    // a color picked on the page: its name in the address too
    toOwnURL(wall.nameOf(page.hex), page.hex);
  });

  // taken down: the wall's title and icon back, the page itself gone after `after` ms. What's
  // left to fly back: the color it showed last, where its card was and how it leaned
  function leave(after) {
    const left = page;
    page = null;
    document.querySelector('link[rel="icon"]').href = wallIcon;
    const slot = left.layer.querySelector(".color-hero__card");
    const b = slot.getBoundingClientRect();
    const card = {
      x: b.left + b.width / 2,
      y: b.top + b.height / 2,
      w: slot.firstElementChild.offsetWidth,
      tilt: parseFloat(slot.style.getPropertyValue("--r")) || 0,
      name: slot.querySelector("[data-card-name]")?.textContent,
    };
    // hide the page's own card so no second one lingers on the fading page
    slot.style.visibility = "hidden";
    left.controller.abort();
    delete document.documentElement.dataset.root;
    document.documentElement.classList.remove("is-arriving");
    document.title = wallTitle;
    left.layer.classList.add("is-leaving");
    setTimeout(() => left.layer.remove(), after);
    return { hex: left.hex, returnTo: left.returnTo, card };
  }

  return {
    isOpen: () => !!page,
    // back past every color visited since it opened
    depth: () => page?.depth ?? 0,
    rememberView,
    away,
    enter,
    show,
    leave,
  };
}
