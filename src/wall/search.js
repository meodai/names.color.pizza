import { normalizeHex, fold } from "../names.js";
import { writeAddress } from "../address.js";

// The search: a name or a hex typed, its results, the color wheel beside it and its ×. The
// color asked for is its own: the dot, the × and the address all follow it.
// wall: items() the names shown, nearest(hex) the closest one's index, focusCard(i),
// dropSpot(), goHome(), busy(), listUp() whether the A–Z list is up, list() the list itself
export function createSearch(root, wall) {
  const q = (s) => root.querySelector(s);
  const search = q("[data-search]");
  const colorPicker = q("[data-picker]");
  const clearButton = q("[data-clear]");
  const results = q("[data-results]");

  let chosen = null;
  let chosenText = "";
  function choose(hex, text) {
    chosen = hex;
    if (hex) colorPicker.value = hex;
    colorPicker.parentElement.style.background = hex || "";
    if (text !== undefined) search.value = text;
    chosenText = search.value;
    showClear();
    writeAddress({ c: hex ? hex.slice(1) : null });
  }
  const showClear = () => (clearButton.hidden = !search.value && !chosen);

  let found = [];
  let active = 0;

  function find(text) {
    const items = wall.items();
    const hex = normalizeHex(text);
    if (hex) {
      const i = wall.nearest(hex);
      return [{ i, note: items[i].hex === hex ? "" : `closest to ${hex}` }];
    }
    const t = fold(text.trim());
    if (t.length < 2) return [];
    const starts = [];
    const within = [];
    for (let i = 0; i < items.length && starts.length < 8; i++) {
      const at = items[i].lower.indexOf(t);
      if (at === 0) starts.push({ i });
      else if (at > 0 && within.length < 8) within.push({ i });
    }
    return [...starts, ...within].slice(0, 8);
  }

  function showResults() {
    const items = wall.items();
    results.replaceChildren(
      ...found.map(({ i, note }, k) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wall__result";
        b.setAttribute("aria-selected", String(k === active));
        b.innerHTML = `<i class="wall__result-swatch"></i><span class="wall__result-name"></span><span class="wall__result-hex"></span>`;
        b.firstChild.style.background = items[i].hex;
        b.children[1].textContent = items[i].name;
        b.children[2].textContent = note || items[i].hex;
        b.addEventListener("click", () => pick(k));
        li.append(b);
        return li;
      }),
    );
    results.hidden = !found.length;
  }
  function clearResults() {
    found = [];
    showResults();
  }

  function pick(k) {
    if (!found[k] || wall.busy()) return;
    const it = wall.items()[found[k].i];
    choose(it.hex, it.name);
    wall.focusCard(found[k].i);
    clearResults();
  }

  clearButton.addEventListener("click", () => {
    if (wall.listUp()) {
      choose(null, "");
      wall.list()?.filter("");
      return search.focus();
    }
    clearResults();
    choose(null, "");
    wall.dropSpot();
    wall.goHome();
    search.focus();
  });

  // the hint shimmers until the search is first used, here or on an earlier visit
  const SEARCHED = "cn-searched";
  const hint = q("[data-hint]");
  try {
    if (!localStorage.getItem(SEARCHED)) hint.classList.add("is-new");
  } catch {}
  search.addEventListener(
    "input",
    () => {
      hint.classList.remove("is-new");
      try {
        localStorage.setItem(SEARCHED, "1");
      } catch {}
    },
    { once: true },
  );

  // what's typed decides the color: none once it's empty, a whole hex at once; in the list,
  // where typing is the search itself, a name has none either
  const typedHex = (text) => (text.replace("#", "").trim().length === 6 ? normalizeHex(text) : null);
  search.addEventListener("input", () => {
    const hex = typedHex(search.value);
    // and a card found for another color lets go
    if (!search.value.trim() || hex) {
      choose(hex);
      wall.dropSpot();
    } else if (wall.listUp()) choose(null);
    showClear();
    if (wall.listUp()) return wall.list()?.filter(search.value);
    found = find(search.value);
    active = 0;
    showResults();
  });
  // its keys: up and down through its results (in the list, through the list), Escape back
  // to what was chosen
  function keys(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // typing in the list's search: up and down go through the list itself
      if (wall.listUp()) return wall.list()?.scrollKey(e.key);
      if (!found.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
      showResults();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // the list follows each keystroke, so there's nothing to go back to
      if (wall.listUp()) return search.blur();
      search.value = chosenText;
      showClear();
      clearResults();
      search.blur();
    }
  }

  let pickTimer = 0;
  let listPicking = 0;
  colorPicker.addEventListener("input", () => {
    if (wall.listUp()) {
      choose(colorPicker.value, colorPicker.value);
      // a drag sends many a value a frame: the list follows the last of them
      if (!listPicking)
        listPicking = requestAnimationFrame(() => {
          listPicking = 0;
          if (wall.listUp()) wall.list()?.closest(colorPicker.value);
        });
      return;
    }
    clearTimeout(pickTimer);
    clearResults();
    choose(colorPicker.value, colorPicker.value);
    pickTimer = setTimeout(() => !wall.busy() && wall.focusCard(wall.nearest(colorPicker.value)), 180);
  });

  q("[data-find]").addEventListener("submit", (e) => {
    e.preventDefault();
    if (wall.listUp()) return;
    if (!found.length) found = find(search.value);
    pick(active);
  });
  results.hidden = true;

  return {
    input: search,
    choose,
    chosen: () => chosen,
    clearResults,
    // the text a list was left with, back as it was
    restoreText(text) {
      search.value = text;
      showClear();
    },
    keys,
  };
}
