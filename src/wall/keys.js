// The wall's keys. Held ones fly the camera: W S forward and back, A D sideways, the arrows
// turn it; + - zoom, 0 or Home go home, / goes to the search.
const FLY_KEYS = {
  w: "forward",
  s: "back",
  a: "left",
  d: "right",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  ArrowUp: "turnUp",
  ArrowDown: "turnDown",
};
const flyKey = (e) => FLY_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
const typing = (t) => t.closest?.("input, textarea, select, [contenteditable]");

// owners: listMenu(e) and views(e), the keys of those two controls; search, the search box
// (its input and its keys); busy(), while a color's page opens or is open; escapeMenu(), the
// phone menu closed on Escape if it's open (true then); list, the A–Z list (on() and keys);
// space: flying() as a held key starts to fly, zoom(factor), home(), toSearch()
export function createKeys(owners) {
  // the fly keys held now, read each frame
  const held = new Set();
  window.addEventListener("keyup", (e) => held.delete(flyKey(e)));
  window.addEventListener("blur", () => held.clear());

  function spaceKeys(e) {
    const key = flyKey(e);
    if (key) {
      e.preventDefault();
      if (!held.has(key)) {
        held.add(key);
        owners.space.flying();
      }
      return;
    }
    if (e.target.closest?.("button, a")) return;
    if (e.key === "+" || e.key === "=") owners.space.zoom(1 / 1.8);
    else if (e.key === "-") owners.space.zoom(1.8);
    else if (e.key === "0" || e.key === "Home") owners.space.home();
    else if (e.key === "/") {
      e.preventDefault();
      owners.space.toSearch();
    }
  }

  // Every key goes to one owner, decided here in this order: the control that has the focus
  // (the list menu, the views, the search); none while a color's page opens or is open, it
  // has its own; Escape closes the phone menu; other fields keep their keys; a modifier lets
  // go of held keys (⌘'s keyup never comes for them on a Mac); then the list when it's up,
  // else the space. From listen() on: before, the wall isn't all there to take them
  function route(e) {
    const t = e.target;
    if (t.closest?.("[data-list-menu]")) return owners.listMenu(e);
    if (t.closest?.("[data-modes]")) return owners.views(e);
    if (t === owners.search.input) return owners.search.keys(e);
    if (owners.busy()) return;
    if (e.key === "Escape" && owners.escapeMenu()) return;
    if (typing(t)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return held.clear();
    if (owners.list.on()) return owners.list.keys(e);
    spaceKeys(e);
  }

  return { held, listen: () => window.addEventListener("keydown", route) };
}
