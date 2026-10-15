import { converter, formatHex, wcagLuminance } from "culori";
import ColorDescription from "color-description";
import {
  hexToRgb,
  rgbToOklab,
  oklchString,
  normalizeHex,
  getList,
  siteURL,
  cardPlace,
  showVersion,
  slugsOf,
  tidySenses,
} from "./names.js";
import { lookupName, lookupPictures, isWhole, baseTitle } from "./lookup.js";
import { paletteHTML, MEDIA, MUSEUMS } from "./art.js";
import { rampOf, complementHex } from "./ramp.js";
import parrot from "./favicon.svg?raw";

const toLab = converter("lab");
const toRgb = converter("rgb");
const toHsl = converter("hsl");

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const pct = (v) => `${Math.round(v * 100)}%`;
const round = (v) => Math.round(v);

const FORMATS = {
  hex: { label: "Hex", fn: (c) => c },
  rgb: {
    label: "RGB",
    fn: (c) => {
      const { r, g, b } = toRgb(c);
      return `${round(r * 255)} ${round(g * 255)} ${round(b * 255)}`;
    },
  },
  hsl: {
    label: "HSL",
    fn: (c) => {
      const { h = 0, s, l } = toHsl(c);
      return `${round(h || 0)}° ${pct(s)} ${pct(l)}`;
    },
  },
  oklch: {
    label: "OKLCH",
    fn: (c) => oklchString(...rgbToOklab(hexToRgb(c))).replace(/^oklch\(|\)$/g, ""),
  },
  lab: {
    label: "LAB",
    fn: (c) => {
      const { l, a, b } = toLab(c);
      return `${round(l)} ${round(a)} ${round(b)}`;
    },
  },
  cmyk: {
    label: "CMYK",
    fn: (c) => {
      const { r, g, b } = toRgb(c);
      const k = 1 - Math.max(r, g, b);
      if (k === 1) return "0% 0% 0% 100%";
      return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(pct).join(" ");
    },
  },
};

function shade(hex, amount) {
  const lab = toLab(hex);
  return formatHex({ ...lab, l: Math.max(0, Math.min(100, lab.l + amount)) });
}

function closestAny(data, hex) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  let best = null;
  let bd = Infinity;
  for (const it of data.items) {
    const d = (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2;
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return { item: best, distance: Math.sqrt(bd) };
}

function neighbors(data, hex, count = 12) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return data.items
    .filter((it) => it.hex !== hex)
    .map((it) => ({ it, d: (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2 }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count)
    .map(({ it }) => it);
}

function playButton(term, src) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "play";
  btn.setAttribute("aria-label", `Play how “${term}” sounds`);
  const audio = new Audio(src);
  const set = (playing) => btn.classList.toggle("play--playing", playing);
  btn.addEventListener("click", () => {
    if (audio.paused) {
      audio.currentTime = 0;
      audio.play().catch(() => set(false));
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", () => set(true));
  audio.addEventListener("pause", () => set(false));
  audio.addEventListener("ended", () => set(false));
  return btn;
}

function addPronunciations(root, entries, sounds, title) {
  const probe = document.createElement("audio");
  for (const e of entries) {
    const src = (sounds[e.term] || []).find((s) => s.type && probe.canPlayType(s.type))?.src;
    const head = title && isWhole(entries) ? title : root.querySelector(`[data-term="${CSS.escape(e.term)}"]`);
    if (src) head?.append(playButton(e.term, src));
  }
}

const dictionaryHTML = (entries) =>
  `<div class="dictionary dictionary--whole">` +
  entries.map((e) => `<div class="dictionary__entry">${sensesHTML(e)}</div>`).join("") +
  `</div>`;

const blocksHTML = (blocks) =>
  blocks
    .map((b) =>
      b.items ? `<ul>${b.items.map((i) => `<li>${escapeHTML(i)}</li>`).join("")}</ul>` : `<p>${escapeHTML(b.text)}</p>`,
    )
    .join("");

const slugMaps = new WeakMap();
function slugFor(data, name) {
  if (!slugMaps.has(data)) slugMaps.set(data, slugsOf(data.items));
  return slugMaps.get(data).get(name);
}

const COPY = /<script type="application\/json" id="color-data">([\s\S]*?)<\/script>/;
const builtPage = (() => {
  try {
    return JSON.parse(document.getElementById("color-data")?.textContent || "null");
  } catch {
    return null;
  }
})();

async function savedLookup(name, slug) {
  if (builtPage?.name === name) return builtPage;
  if (!slug) return null;
  try {
    const res = await fetch(siteURL(`color/${slug}/`));
    if (!res.ok) return null;
    const json = (await res.text()).match(COPY)?.[1];
    const copy = json && JSON.parse(json);
    return copy?.name === name ? copy : null;
  } catch {
    return null;
  }
}

const page = {};
let current = null;

const formatsHTML = (hex) =>
  Object.entries(FORMATS)
    .filter(([key]) => key !== "hex")
    .map(([, f]) => {
      const value = escapeHTML(f.fn(hex));
      return `<div><dt class="label">${f.label}</dt>
        <dd><button type="button" class="color-specs__copy" data-copy="${value}"
          title="Copy ${f.label}">${value}</button></dd></div>`;
    })
    .join("");

// the dataset is written from a western perspective: associations ("often"), not facts
function wordsHTML(lore) {
  return [
    ["Often means", lore.meanings],
    ["Can make you", lore.effects],
    ["Fits", lore.usage],
  ]
    .filter(([, words]) => words?.length)
    .map(([title, words]) => {
      const w = words.slice(0, 8);
      const said = w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w.at(-1)}` : w[0];
      return `<div>
        <dt class="label">${title}</dt>
        <dd>${escapeHTML(said)}</dd>
      </div>`;
    })
    .join("");
}

function wordsTitle(lore) {
  const [noun] = lore.nouns;
  const top = lore.meanings.slice(0, 3);
  if (!noun || !top.length) return "What it can say.";
  const list = top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0];
  return `${noun[0].toUpperCase()}${noun.slice(1)} often stands for ${list}.`;
}

let added = null;
async function addedOn(name) {
  added ??= fetch(siteURL("added.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const data = await added;
  const at = data?.names?.[name];
  if (at == null) return null;
  const [hash, day, by, github] = data.commits[at];
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return { hash, date, by, github };
}

function cardVars(hex) {
  const dark = wcagLuminance(hex) < 0.5;
  return {
    "--c-color": hex,
    "--c-shade0": shade(hex, dark ? 25 : -25),
    "--c-shade1": shade(hex, dark ? 12 : -12),
  };
}

const cardStyle = (hex) =>
  Object.entries(cardVars(hex))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

const neighborsHTML = (items, data) =>
  items
    .map(
      (it, i) => `<a class="neighbor" style="--rnd:${between(-1, 1).toFixed(2)}" href="${
        import.meta.env.PROD ? siteURL(`color/${slugFor(data, it.name)}/`) : `#${it.hex.slice(1)}`
      }" aria-label="${escapeHTML(it.name)}, ${it.hex}">
        <div class="swatchcard" style="${cardStyle(it.hex)};--anim-appear-delay:${i * 75}ms">
          <div class="swatchcard__upper">
            <i class="swatchcard__swatch" aria-hidden="true">
              <i class="swatchcard__shade"></i><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i>
            </i>
          </div>
          <div class="swatchcard__label">
            <div class="swatchcard__info">
              <span class="swatchcard__row1">${it.hex}</span>
              <span class="swatchcard__row2">${escapeHTML(it.name)}</span>
            </div>
          </div>
        </div>
      </a>`,
    )
    .join("");

const named = (data, steps) => steps.map((step) => ({ hex: step, name: closestAny(data, step).item.name }));

let neighborWatch = null;
function revealNeighbors() {
  neighborWatch?.disconnect();
  neighborWatch = new IntersectionObserver(
    (entries) => {
      for (const e of entries.filter((e) => e.isIntersecting)) {
        neighborWatch.unobserve(e.target);
        e.target.querySelectorAll(".swatchcard").forEach((card) => card.classList.add("swatchcard--visible"));
      }
    },
    { threshold: 0.2 },
  );
  [page.neighbors, page.complements, page.ramp].forEach((grid) => neighborWatch.observe(grid));
}

const capital = (t) => t[0].toUpperCase() + t.slice(1);

const sensesHTML = (word) =>
  word.parts
    .map(
      (p) => `<p class="label">${escapeHTML(p.part)}</p>
        <ol class="dictionary__senses">${tidySenses(p.definitions)
          .map((d) => `<li><span>${escapeHTML(d)}</span></li>`)
          .join("")}</ol>`,
    )
    .join("") +
  `<a class="dictionary__source" href="${escapeHTML(word.link)}" target="_blank" rel="noopener">Wiktionary</a>`;

function indexHTML(words, entries) {
  const wordFor = new Map(words.map((w) => [w.term.toLowerCase(), w]));
  const placed = new Set();
  const block = (title, term, word, image, article) => `<article class="wiki-index__row">
      <h3${term ? ` data-term="${escapeHTML(term)}"` : ""}><span>${escapeHTML(title)}</span></h3>
      ${word ? `<div class="wiki-index__words">${sensesHTML(word)}</div>` : ""}
      ${
        article
          ? `<div class="wiki-index__body">
        ${image ? `<img class="wiki-index__picture" src="${escapeHTML(image)}" alt="" loading="lazy" />` : ""}
        <div class="wiki-index__text">${article}</div>
      </div>`
          : ""
      }
    </article>`;
  const rows = entries.map((e) => {
    const word = wordFor.get(baseTitle(e.title));
    const mine = word && !placed.has(word) ? word : null;
    if (mine) placed.add(mine);
    const opening = e.blocks.find((b) => b.text) || e.blocks[0];
    return block(
      e.title,
      mine?.term,
      mine,
      e.image,
      (opening ? blocksHTML([opening]) : "") +
        (e.link ? `<a href="${escapeHTML(e.link)}" target="_blank" rel="noopener">Read on Wikipedia</a>` : ""),
    );
  });
  for (const word of words) {
    if (placed.has(word)) continue;
    rows.push(block(capital(word.term), word.term, word, null, ""));
  }
  return rows.length ? `<div class="wiki-index">${rows.join("")}</div>` : "";
}

const between = (a, b) => a + Math.random() * (b - a);
async function copy(text, btn, done) {
  try {
    await navigator.clipboard.writeText(text);
    const was = btn.textContent;
    btn.textContent = done;
    setTimeout(() => (btn.textContent = was), 1500);
  } catch {
    // clipboard blocked
  }
}

// counts only visible slides, so a hidden one never puts two alike side by side
function alternate() {
  [...page.root.querySelectorAll("[data-slide]")]
    .filter((el) => !el.hidden)
    .forEach((el, i) => el.classList.toggle("slide--invert", i % 2 === 0));
}

function fitTitle() {
  const el = page.name;
  el.style.fontSize = "";
  const fit = () => {
    let size = parseFloat(getComputedStyle(el).fontSize);
    for (let k = 0; k < 30 && el.scrollWidth > el.clientWidth + 1; k++) {
      size *= 0.94;
      el.style.fontSize = `${size}px`;
    }
  };
  fit();
  document.fonts?.ready.then(() => {
    el.style.fontSize = "";
    fit();
  });
}

function placeCard(place = cardPlace()) {
  page.place.style.setProperty("--x", place.x.toFixed(3));
  page.place.style.setProperty("--y", place.y.toFixed(3));
  page.place.style.setProperty("--r", `${place.r.toFixed(1)}deg`);
}

// what Wikipedia and Wiktionary say; a page built for the name has it already
function showMeaning(name, { definitions = [], entries = [], sounds = [] }) {
  if (!definitions.length && !entries.length) return false;
  page.meaningTitle.textContent = name;
  const whole = isWhole(definitions) && !entries.some((e) => baseTitle(e.title) === definitions[0].term.toLowerCase());
  page.dictionary.innerHTML = whole ? dictionaryHTML(definitions) : "";
  page.wiki.innerHTML = indexHTML(whole ? [] : definitions, entries);
  addPronunciations(whole ? page.dictionary : page.wiki, definitions, sounds, whole ? page.meaningTitle : null);
  page.meaningSlide.hidden = false;
  alternate();
  return true;
}

async function render(hex) {
  const { card } = page;
  (page.embedded ? page.root : window).scrollTo(0, 0);

  // restart the entrance from its first frame (forced reflow)
  card.classList.add("swatchcard--reset");
  card.classList.remove("swatchcard--visible");
  void card.offsetWidth;
  card.classList.remove("swatchcard--reset");
  for (const [k, v] of Object.entries(cardVars(hex))) card.style.setProperty(k, v);
  // handed over from the wall: show it at once where it landed, so the page change doesn't show
  let handoff = null;
  try {
    handoff = JSON.parse(sessionStorage.getItem("card-handoff"));
    sessionStorage.removeItem("card-handoff");
  } catch {}
  const handedOver = handoff?.hex === hex;
  placeCard(handedOver && handoff.place ? handoff.place : undefined);
  if (handedOver) {
    card.classList.add("swatchcard--reset", "swatchcard--visible");
    document.documentElement.classList.add("is-arriving");
    requestAnimationFrame(() => requestAnimationFrame(arrived));
  }
  current = { hex };
  page.value.textContent = hex;
  page.cardName.textContent = handedOver ? handoff.name : "";
  page.name.textContent = handedOver ? handoff.name : hex;
  fitTitle();
  page.intro.replaceChildren();
  page.stats.replaceChildren();
  page.formats.innerHTML = formatsHTML(hex);
  page.fillHex.textContent = hex;
  page.fill.style.setProperty("--fill", hex);
  page.colophon.style.setProperty("--fill", hex);
  page.colophonColor.textContent = handedOver ? `${handoff.name} · ${hex}` : hex;
  // colors the scrollbar
  (page.embedded ? page.root : document.documentElement).style.setProperty("--page-color", hex);
  page.ink.replaceChildren();
  page.mix.replaceChildren();
  page.about.replaceChildren();
  page.neighbors.replaceChildren();
  page.complements.replaceChildren();
  page.ramp.replaceChildren();
  page.neighborsSlide.hidden = true;
  page.dictionary.replaceChildren();
  page.wiki.replaceChildren();
  page.wordsSlide.hidden = true;
  gallery = [];
  closePicture(true);
  page.meaningSlide.hidden = true;
  page.artSlide.hidden = true;
  page.art.replaceChildren();
  alternate();
  document.title = `${hex} — Color Names`;
  document.querySelector('link[rel="icon"]').href =
    `data:image/svg+xml,${encodeURIComponent(parrot.replace(/fill="(?!#fff")[^"]*"/g, `fill="${hex}"`))}`;

  const lore = new ColorDescription(hex);
  const mix = lore.percentageWords();

  const early = builtPage?.hex === hex && builtPage.looked ? showMeaning(builtPage.name, builtPage.looked) : false;

  const data = await getList("default");
  if (current?.hex !== hex) return; // a newer color took over
  const exact = data.byHex.get(hex);
  // link previews and search engines only see a named color's own page
  if (exact && import.meta.env.PROD && !page.embedded && builtPage?.hex !== hex) {
    if (handedOver) sessionStorage.setItem("card-handoff", JSON.stringify(handoff));
    location.replace(siteURL(`color/${slugFor(data, exact.name)}/`));
    return;
  }
  const near = exact || closestAny(data, hex).item;
  if (!exact && import.meta.env.PROD && !page.embedded && builtPage?.name !== near.name) {
    location.replace(`${siteURL(`color/${slugFor(data, near.name)}/`)}#${hex.slice(1)}`);
    return;
  }
  current.name = near.name;

  page.cardName.textContent = exact ? near.name : `≈ ${near.name}`;
  page.name.textContent = near.name;
  page.colophonColor.textContent = `${near.name} · ${hex}`;
  fitTitle();
  document.title = `${near.name}: ${hex} — Color Names`;

  const [noun, alt] = lore.nouns;
  const adjective = /^(black|white)$/.test(noun) ? "" : lore.descriptiveWords[0]; // no "very dark black"
  const kind = [adjective, noun].filter(Boolean).join(" ");
  const article = /^[aeiou]/i.test(kind) ? "an" : "a";
  const lines = [
    kind && `${near.name} is ${article} ${kind}${alt ? `, close to ${alt}` : ""}.`,
    `It can be described as ${lore.getDescriptiveList(false, 4)}.`,
  ].filter(Boolean);
  const leads = (texts) =>
    texts.map((t) => Object.assign(document.createElement("p"), { className: "lead", textContent: t }));
  const describe = (said) => page.intro.replaceChildren(...leads(said ? [said] : lines));
  describe(builtPage?.name === current.name ? builtPage.description : null);

  page.stats.replaceChildren(Object.assign(document.createElement("span"), { textContent: hex }));
  // "by" is only set when someone other than the list's maintainer added it
  addedOn(current.name).then((added) => {
    if (!added || current?.hex !== hex) return;
    const link = (href, text, title) =>
      Object.assign(document.createElement("a"), {
        href,
        textContent: text,
        title,
        target: "_blank",
        rel: "noopener",
      });
    const line = document.createElement("span");
    line.append(
      link(`https://github.com/meodai/color-names/commit/${added.hash}`, `Added ${added.date}`, `Commit ${added.hash}`),
    );
    if (added.by) {
      line.append(" by ");
      line.append(
        added.github ? link(`https://github.com/${added.github}`, added.by, `@${added.github} on GitHub`) : added.by,
      );
    }
    page.stats.append(line);
  });

  const ink = lore.bestContrast === "white" ? "#fff" : "#000";
  page.fill.style.setProperty("--fill-ink", ink);
  page.colophon.style.setProperty("--fill-ink", ink);
  page.ink.replaceChildren(
    ...leads([...lines, `Set in ${lore.bestContrast}, because ${lore.bestContrast} reads best on it.`]),
  );
  const print = lore.percentageWords("cmyk");
  const light = lore.temperatureWords;
  page.mix.innerHTML = [
    ["On screen", `${mix[0]} red, ${mix[1]} green and ${mix[2]} blue`],
    ["In print", `${print[0]} cyan, ${print[1]} magenta, ${print[2]} yellow and ${print[3]} black`],
    ["As light", `about ${light.value.toLocaleString("en-US")} K, ${light.descriptive.join(", ")}`],
  ]
    .map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${escapeHTML(v)}</dd></div>`)
    .join("");

  page.about.innerHTML = lore.description.map((t) => `<p>${escapeHTML(t)}</p>`).join("");
  page.wordsTitle.textContent = wordsTitle(lore);
  page.words.innerHTML = wordsHTML(lore);
  const saved = savedLookup(current.name, slugFor(data, current.name));
  if (builtPage?.name !== current.name)
    saved.then((c) => c?.description && current?.hex === hex && describe(c.description));
  showPictures(hex, [current.name, lore.nouns[0]], saved);
  showArt(hex, saved);
  page.neighbors.innerHTML = neighborsHTML(neighbors(data, hex), data);
  page.complements.innerHTML = neighborsHTML(named(data, rampOf(complementHex(hex))), data);
  page.ramp.innerHTML = neighborsHTML(named(data, rampOf(hex)), data);
  page.neighborsSlide.hidden = false;
  revealNeighbors();
  page.wordsSlide.hidden = !page.words.innerHTML.trim();

  const own = exact && import.meta.env.PROD ? new URL(siteURL(`color/${slugFor(data, current.name)}/`)) : location;
  page.pageLink.href = own.href;
  page.pageLink.textContent = `${own.host}${own.pathname}${own.hash}`;
  page.outro.textContent = "Share it.";
  alternate();

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      card.classList.remove("swatchcard--reset");
      card.classList.add("swatchcard--visible");
    }),
  );

  const looked = (await saved)?.looked || (await lookupName(current.name));
  if (current?.hex !== hex) return;
  if (!early) showMeaning(current.name, looked);
  const { images = [] } = looked;
  addToGallery(
    hex,
    images.map((img) => ({
      kind: "wiki",
      image: img.src,
      srcset: img.srcset,
      ratio: img.ratio,
      title: img.alt,
      by: "On Wikipedia",
      credit: img.credit,
      palette: img.palette,
      link: img.link,
    })),
  );
}

async function showPictures(hex, terms, saved) {
  const pictures = (await saved)?.looked?.pictures ?? (await lookupPictures(hex, terms));
  if (current?.hex !== hex || !pictures.length) return;
  addToGallery(
    hex,
    pictures.map((p) => ({
      kind: "picture",
      image: p.image,
      ratio: p.ratio,
      title: p.title,
      by: `${Math.round(p.share * 100)}% close to ${hex}, on Wikimedia Commons`,
      share: p.share,
      credit: p.credit,
      palette: p.palette,
      link: p.link,
    })),
  );
}

async function showArt(hex, saved) {
  const list = (await saved)?.list;
  let art = [];
  try {
    if (list) art = await (await fetch(new URL(list, location.href))).json();
  } catch {}
  addToGallery(
    hex,
    art.map((w) => ({
      kind: "art",
      image: w.image,
      ratio: w.ratio,
      title: w.title,
      by: [w.artist, w.kind, w.date, w.source && `via ${w.source}`].filter(Boolean).join(", "),
      link: w.url,
      palette: w.palette,
      color: w.color,
      share: w.share,
      work: w,
    })),
  );
}

let gallery = [];
const galleryRows = () => 6;

function addToGallery(hex, items) {
  // TEMPORARY: or from Commons, until wikimedia-art has a copy of every picture
  items = items.filter(
    (it) =>
      it.image?.startsWith(`${MEDIA}/`) ||
      /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(it.image),
  );
  if (current?.hex !== hex || !items.length) return;
  // most of the color first, whatever the source
  gallery = [...gallery, ...items].sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  // shown first: a hidden strip has no width to measure
  if (page.artSlide.hidden) {
    page.artSlide.hidden = false;
    alternate();
  }
  layoutGallery();
}

// An endless strip: each row repeats its own pictures at its own length, so
// there are no blocks; only the tiles near the window are drawn. The title
// sits once in a middle row, which runs on from it both ways.
const strip = { offset: 0, rows: [], title: null, tiles: new Map(), frame: 0 };

function layoutGallery() {
  const n = galleryRows();
  const rows = Array.from({ length: n }, () => ({ width: 0, items: [] }));
  // every work in the rows that show in full; the cut-off rows at the top and
  // bottom repeat them, out of step
  const inner = rows.slice(1, -1);
  for (const it of gallery) {
    const row = inner.reduce((a, b) => (b.width < a.width ? b : a));
    row.width += it.ratio || 1;
    row.items.push(it);
  }
  inner.forEach((r, k) => {
    if (!r.items.length) r.items.push(gallery[k % gallery.length]);
  });
  // the strongest at each row's start and end, so on both sides of the title
  for (const r of inner) {
    const head = [];
    const tail = [];
    r.items.forEach((it, i) => (i % 2 ? tail : head).push(it));
    r.items = [...head, ...tail.reverse()];
  }
  const rotate = (items, by) => [...items.slice(by % items.length), ...items.slice(0, by % items.length)];
  rows[0].items = rotate(inner.at(-1).items, 2);
  rows.at(-1).items = rotate(inner[0].items, 3);
  page.art.replaceChildren();
  strip.tiles = new Map();
  const title = document.createElement("div");
  title.className = "gallery__title";
  title.innerHTML = `<div class="gallery__swatch" aria-hidden="true">
      <div class="swatchcard" style="${cardStyle(current.hex)}">
        <div class="swatchcard__upper"><i class="swatchcard__swatch"><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i></i></div>
        <div class="swatchcard__label"><div class="swatchcard__info">
          <span class="swatchcard__row1">${current.hex}</span>
        </div></div>
      </div>
    </div>
    <h2 class="display gallery__name">${escapeHTML(current.name)},<br />in pictures.</h2>`;
  page.art.append(title);
  strip.title = title;
  const shown = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      shown.disconnect();
      title.querySelector(".swatchcard").classList.add("swatchcard--visible");
    },
    { threshold: 0.3 },
  );
  shown.observe(title);
  measureStrip(rows);
  strip.offset = strip.titleWidth / 2 - page.art.clientWidth / 2;
  strip.entered = false;
  page.art.classList.remove("is-in");
  drawStrip();
  // the pictures come in from the back once the strip is in view, outward from the title
  const seen = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      seen.disconnect();
      page.art.classList.add("is-in");
      setTimeout(() => (strip.entered = true), 1300);
    },
    { threshold: 0.25 },
  );
  seen.observe(page.art);
}

function measureStrip(rows = strip.rows) {
  const gap = parseFloat(getComputedStyle(page.art).rowGap) || 16;
  const row = (page.art.clientHeight - (rows.length - 1) * gap) / rows.length;
  strip.row = row;
  strip.gap = gap;
  strip.middle = Math.floor((rows.length - 1) / 2);
  strip.title.style.height = `${row}px`;
  strip.title.style.gap = `${gap}px`;
  // the swatch card is as tall as a row, like a picture
  const swatch = strip.title.querySelector(".gallery__swatch");
  swatch.style.width = "100px";
  swatch.style.width = `${(row * 100) / swatch.firstElementChild.offsetHeight}px`;
  strip.title.style.width = "max-content";
  strip.titleWidth = Math.max(strip.title.offsetWidth, swatch.offsetWidth + gap + row * 2.8);
  strip.title.style.width = `${strip.titleWidth}px`;
  strip.rows = rows.map((r, k) => {
    let x = 0;
    const tiles = r.items.map((it) => {
      const w = (it.ratio || 1) * row;
      const t = { it, x, w };
      x += w + gap;
      return t;
    });
    return { tiles, period: x, phase: 0 };
  });
  strip.title.style.top = `${strip.middle * (row + gap)}px`;
}

// the tiles of one row between world x a and b; the middle row runs from the
// title's end to the right and from its start to the left
function* rowTiles(r, k, a, b) {
  const { period, tiles, phase } = r;
  if (!period) return;
  if (k !== strip.middle) {
    for (let c = Math.floor((a - phase) / period) - 1; c * period + phase < b; c++)
      for (const [i, t] of tiles.entries()) yield [`${k}:${c}:${i}`, t, c * period + phase + t.x];
    return;
  }
  const right = strip.titleWidth + strip.gap;
  for (let c = Math.max(0, Math.floor((a - right) / period) - 1); c * period + right < b; c++)
    for (const [i, t] of tiles.entries()) yield [`${k}:r${c}:${i}`, t, right + c * period + t.x];
  for (let c = Math.max(0, Math.floor(-b / period) - 1); -(c + 1) * period > a - period; c++)
    for (const [i, t] of tiles.entries()) yield [`${k}:l${c}:${i}`, t, -(c + 1) * period + t.x];
}

function drawStrip() {
  const a = strip.offset - strip.row * 3;
  const b = strip.offset + page.art.clientWidth + strip.row * 3;
  const seen = new Set();
  strip.rows.forEach((r, k) => {
    for (const [key, t, x] of rowTiles(r, k, a, b)) {
      if (x + t.w < a || x > b) continue;
      seen.add(key);
      let el = strip.tiles.get(key);
      if (!el) {
        el = document.createElement("figure");
        el.className = "tile";
        el.innerHTML = tileHTML(t.it, gallery.indexOf(t.it));
        const reach = Math.hypot(x - strip.offset - page.art.clientWidth / 2, (k - strip.middle) * strip.row);
        const delay = strip.entered ? 0 : 400 + Math.round(Math.min(1, reach / page.art.clientWidth) * 900);
        el.style.cssText = `top:${k * (strip.row + strip.gap)}px;width:${t.w}px;height:${strip.row}px;--d:${delay}ms`;
        page.art.append(el);
        const img = el.querySelector("img");
        if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
        strip.tiles.set(key, el);
      }
      el.style.transform = `translateX(${x - strip.offset}px)`;
    }
  });
  for (const [key, el] of strip.tiles) {
    if (seen.has(key) || opened?.tile === el) continue;
    el.remove();
    strip.tiles.delete(key);
  }
  strip.title.style.transform = `translateX(${-strip.offset}px)`;
}

function moveStrip(dx) {
  strip.offset += dx;
  if (!strip.frame)
    strip.frame = requestAnimationFrame(() => {
      strip.frame = 0;
      drawStrip();
    });
}

const tileHTML = (
  it,
  i,
) => `<button type="button" class="tile__open" data-i="${i}" aria-label="${escapeHTML(it.title || "Picture")}" style="--wash:${it.palette?.[0]?.[0] || it.color || "transparent"}">
    <img src="${escapeHTML(it.image)}" alt="${escapeHTML(it.title)}" decoding="async" />
    ${it.title ? `<span class="tile__name">${escapeHTML(it.title)}</span>` : ""}
    ${it.share ? `<span class="tile__share">${Math.round(it.share * 100)}%</span>` : ""}
  </button>`;

const link = (href, text) =>
  href ? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener">${escapeHTML(text)}</a>` : escapeHTML(text);

function sourceHTML(it) {
  if (it.work) {
    const museum = MUSEUMS[it.work.museum];
    return museum ? link(museum.url, museum.name) : "";
  }
  const where = it.kind === "wiki" ? "Wikipedia" : "Wikimedia Commons";
  const { artist, license, licenseUrl } = it.credit || {};
  return [artist && escapeHTML(artist), license && link(licenseUrl, license), where].filter(Boolean).join(", ");
}

const pictureHTML = (it) => `<button type="button" class="lightbox__backdrop" aria-label="Close"></button>
  <figure class="lightbox__figure">
    <div class="lightbox__frame">
      <span class="lightbox__mat"></span>
      <img src="${escapeHTML(it.image)}" alt="${escapeHTML(it.title)}" />
      ${it.palette?.length ? `<div class="lightbox__palette">${paletteHTML(it.palette, it.color)}</div>` : ""}
    </div>
    <figcaption class="lightbox__info">
      ${link(it.link, it.title || "Untitled").replace("<a ", '<a class="lightbox__title" ')}
      ${it.by ? `<span>${escapeHTML(it.by)}</span>` : ""}
      <span class="lightbox__source">${sourceHTML(it)}</span>
    </figcaption>
  </figure>`;

const EASE = "cubic-bezier(0.3, 0.7, 0, 1)";
let opened = null;

// grows from the tile it was clicked in, a frame settling round it just
// before it lands; shrinks back into it
function openPicture(tile, it) {
  closePicture(true);
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = pictureHTML(it);
  (page.embedded ? page.root : document.body).append(box);
  const frame = box.querySelector(".lightbox__frame");
  const img = frame.querySelector("img");
  const mat = frame.querySelector(".lightbox__mat");
  const info = box.querySelector(".lightbox__info");
  // around the picture's center, not the frame's: the palette sits below it
  const fly = () => {
    const from = tile.getBoundingClientRect();
    const to = img.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const cx = to.left + to.width / 2;
    const cy = to.top + to.height / 2;
    frame.style.transformOrigin = `${cx - box.left}px ${cy - box.top}px`;
    const scale = Math.max(from.width / to.width, from.height / to.height);
    const dx = from.left + from.width / 2 - cx;
    const dy = from.top + from.height / 2 - cy;
    return [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }];
  };
  const go = () => {
    tile.style.visibility = "hidden";
    page.art.classList.add("is-behind");
    frame.animate(fly(), { duration: 560, easing: EASE });
    mat.animate(
      [
        { opacity: 0, transform: "scale(0.94)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 380, delay: 300, easing: EASE, fill: "backwards" },
    );
    info.animate(
      [
        { opacity: 0, transform: "translateY(0.6rem)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 400, delay: 360, easing: EASE, fill: "backwards" },
    );
    // the palette once the frame has settled, swatch by swatch
    box.querySelectorAll(".lightbox__palette .art__palette > a").forEach((swatch, i) =>
      swatch.animate(
        [
          { opacity: 0, scale: "1 0" },
          { opacity: 1, scale: "1 1" },
        ],
        { duration: 320, delay: 620 + i * 45, easing: EASE, fill: "backwards" },
      ),
    );
  };
  if (img.complete) go();
  else img.addEventListener("load", go, { once: true });
  // each swatch's closest name, for when it opens on hover
  getList("default").then((data) => {
    for (const a of box.querySelectorAll(".lightbox__palette .art__palette > a")) {
      const name = closestAny(data, a.getAttribute("aria-label")).item.name;
      a.setAttribute("aria-label", `${name}, ${a.getAttribute("aria-label")}`);
      a.insertAdjacentHTML(
        "beforeend",
        `<span class="art__square"><span class="art__name"><span>${escapeHTML(name)}</span></span></span>`,
      );
    }
  });
  box.querySelector(".lightbox__backdrop").addEventListener("click", () => closePicture());
  opened = { box, tile, frame, mat, info, fly };
}

function closePicture(now = false) {
  if (!opened) return;
  const { box, tile, frame, mat, info, fly } = opened;
  opened = null;
  page.art.classList.remove("is-behind");
  const done = () => {
    tile.style.visibility = "";
    box.remove();
  };
  if (now) return done();
  const fade = [{ opacity: 1 }, { opacity: 0 }];
  const swatches = [...box.querySelectorAll(".lightbox__palette .art__palette > a")].reverse();
  swatches.forEach((swatch, i) =>
    swatch.animate(
      [
        { opacity: 1, scale: "1 1" },
        { opacity: 0, scale: "1 0" },
      ],
      { duration: 140, delay: i * 12, easing: "ease-in", fill: "forwards" },
    ),
  );
  mat.animate(fade, { duration: 160, easing: "ease-in", fill: "forwards" });
  info.animate(fade, { duration: 160, easing: "ease-in", fill: "forwards" });
  frame.animate([...fly()].reverse(), { duration: 460, delay: 50, easing: EASE, fill: "forwards" }).finished.then(done);
}

const hexFromHash = () => normalizeHex(location.hash.slice(1));

const arrived = () => document.documentElement.classList.remove("is-arriving");

export function initDetailPage(root = document, { embedded = false, signal, onClose } = {}) {
  page.root = root;
  page.embedded = embedded;

  const q = (s) => root.querySelector(s);
  showVersion(root);
  Object.assign(page, {
    card: q("[data-card]"),
    place: q("[data-place]"),
    value: q("[data-value]"),
    cardName: q("[data-card-name]"),
    name: q("[data-name]"),
    intro: q("[data-intro]"),
    stats: q("[data-stats]"),
    formats: q("[data-formats]"),
    fill: q("[data-fill]"),
    colophon: q("[data-colophon]"),
    colophonColor: q("[data-colophon-color]"),
    fillHex: q("[data-fill-hex]"),
    ink: q("[data-ink]"),
    mix: q("[data-mix]"),
    about: q("[data-about]"),
    neighbors: q("[data-neighbors]"),
    complements: q("[data-complements]"),
    ramp: q("[data-ramp]"),
    neighborsSlide: q("[data-neighbors-slide]"),
    words: q("[data-words]"),
    wordsTitle: q("[data-words-title]"),
    wordsSlide: q("[data-words-slide]"),
    dictionary: q("[data-dictionary]"),
    wiki: q("[data-wiki]"),
    meaningSlide: q("[data-meaning-slide]"),
    meaningTitle: q("[data-meaning-title]"),
    art: q("[data-art]"),
    artSlide: q("[data-art-slide]"),
    pageLink: q("[data-page-link]"),
    outro: q("[data-outro]"),
  });

  q("[data-share]").addEventListener("click", async () => {
    const url = page.pageLink.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
      } catch {} // dismissed
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      const was = page.pageLink.textContent;
      page.pageLink.textContent = "Link copied";
      setTimeout(() => (page.pageLink.textContent = was), 1500);
    } catch {} // clipboard blocked
  });

  page.formats.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copy(btn.dataset.copy, btn, "Copied");
  });

  const close = q("[data-close]");
  close.addEventListener("click", (e) => {
    if (onClose) {
      e.preventDefault();
      onClose();
    }
  });
  // embedded, every link home closes too
  if (onClose) {
    root.querySelectorAll('a[href="../"]:not([data-close])').forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        onClose();
      }),
    );
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close.click();
    },
    { signal },
  );

  const show = () => {
    const hex = hexFromHash() || (!embedded && builtPage?.hex) || null;
    if (hex) render(hex);
    else if (!embedded) location.replace(siteURL());
  };
  window.addEventListener("hashchange", show, { signal });
  page.art.addEventListener(
    "load",
    (e) => {
      if (e.target.tagName === "IMG") e.target.classList.add("is-loaded");
    },
    { capture: true, signal },
  );
  page.art.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName !== "IMG") return;
      const before = gallery.length;
      gallery = gallery.filter((it) => it.image !== e.target.getAttribute("src"));
      if (gallery.length !== before)
        requestAnimationFrame(() => (gallery.length ? layoutGallery() : (page.artSlide.hidden = true)));
    },
    { capture: true, signal },
  );
  // wheel sideways (or with shift), drag with a mouse, swipe on touch
  page.art.addEventListener(
    "wheel",
    (e) => {
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (!dx) return;
      e.preventDefault();
      moveStrip(dx);
    },
    { passive: false, signal },
  );
  let drag = null;
  let coast = 0;
  page.art.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button) return;
      cancelAnimationFrame(coast);
      drag = { id: e.pointerId, x: e.clientX, last: e.clientX, t: performance.now(), v: 0, moved: false };
    },
    { signal },
  );
  page.art.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) > 5) {
        drag.moved = true;
        page.art.setPointerCapture(e.pointerId);
        page.art.classList.add("is-dragging");
      }
      if (!drag.moved) return;
      const now = performance.now();
      const dx = drag.last - e.clientX;
      drag.v = dx / Math.max(1, now - drag.t);
      drag.last = e.clientX;
      drag.t = now;
      moveStrip(dx);
    },
    { signal },
  );
  const release = () => {
    if (!drag) return;
    const { moved, v } = drag;
    drag = null;
    page.art.classList.remove("is-dragging");
    if (!moved) return;
    page.art.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
    let speed = v * 16;
    const glide = () => {
      speed *= 0.94;
      if (Math.abs(speed) < 0.3) return;
      moveStrip(speed);
      coast = requestAnimationFrame(glide);
    };
    coast = requestAnimationFrame(glide);
  };
  page.art.addEventListener("pointerup", release, { signal });
  page.art.addEventListener("pointercancel", release, { signal });
  page.art.addEventListener(
    "click",
    (e) => {
      const open = e.target.closest(".tile__open");
      if (open) openPicture(open.parentElement, gallery[+open.dataset.i]);
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!opened) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closePicture();
      } else if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) e.preventDefault();
    },
    { capture: true, signal },
  );
  // the page stays where it is while a picture is open
  for (const type of ["wheel", "touchmove"])
    window.addEventListener(type, (e) => opened && e.preventDefault(), { capture: true, passive: false, signal });
  signal?.addEventListener("abort", () => closePicture(true));

  window.addEventListener(
    "resize",
    () => {
      if (page.name.textContent) fitTitle();
      if (gallery.length && strip.title) {
        measureStrip();
        drawStrip();
      }
    },
    { signal },
  );
  show();
}
