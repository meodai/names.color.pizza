/*
  Color page — the universal view of one color, at color/#<hex>.

  Linked from anywhere on the site (the hero cards, the name map, the
  examples). Laid out like the Color Parrot companion's color pages: the
  story on the side, the animated card on its own. It shows the color's name
  on the list (exact, closest, or none yet), a few words of color lore, and
  what Wikipedia knows about the name and its parts, with pictures. Chrome
  stays black and white; the card carries the color.
*/

import { converter, formatHex, wcagLuminance } from "culori";
import ColorDescription from "color-description";
import {
  UNNAMED,
  hexToRgb,
  rgbToOklab,
  oklchString,
  normalizeHex,
  getList,
  siteURL,
  cardPlace,
  showVersion,
  slugsOf,
} from "./names.js";
import { lookupName, lookupPictures, isWhole, baseTitle } from "./lookup.js";
import { workHTML, artNear } from "./art.js";

const toLab = converter("lab");
const toRgb = converter("rgb");
const toHsl = converter("hsl");

const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );

const pct = (v) => `${Math.round(v * 100)}%`;
const round = (v) => Math.round(v);

// the color written out in other models, listed in the story column
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
      return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
        .map(pct)
        .join(" ");
    },
  },
};

// the card's shade stack: the color, nudged lighter or darker in LAB
function shade(hex, amount) {
  const lab = toLab(hex);
  return formatHex({ ...lab, l: Math.max(0, Math.min(100, lab.l + amount)) });
}

/* —— the name: exact, closest, or none yet —— */

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

// The nearest names to a color, closest first, without the color itself.
function neighbors(data, hex, count = 12) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return data.items
    .filter((it) => it.hex !== hex)
    .map((it) => ({ it, d: (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2 }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count)
    .map(({ it }) => it);
}

// The pictures peek in at the page's edges, left and right in turn,
// scattered down its length, each its own size and tilt; hovering one
// brings it in, straight, with its caption.
const peeksHTML = (pictures, hex) => {
  const perSide = Math.ceil(pictures.length / 2);
  return pictures
    .map((p, i) => {
      const side = i % 2 ? "right" : "left";
      const k = Math.floor(i / 2);
      const vars = [
        `--w:${between(11, 16).toFixed(1)}rem`,
        `--rot:${between(-9, 9).toFixed(1)}deg`,
      ].join(";");
      // the link holds still and takes the hover; the print inside it moves
      return `<a class="peek peek--${side}" data-k="${(k + 0.5) / perSide + between(-0.03, 0.03)}" href="${escapeHTML(p.link)}" target="_blank" rel="noopener" style="${vars}">
        <span class="peek__print">
          <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.title)}" decoding="async" style="aspect-ratio:${p.ratio.toFixed(3)}" />
          <span class="peek__caption"><span>
            <span class="peek__title">${escapeHTML(p.title)}</span>
            <span class="peek__where">${Math.round(p.share * 100)}% close to ${hex}, on Wikimedia Commons</span>
          </span></span>
        </span>
      </a>`;
    })
    .join("");
};

// a small play button next to a headword; plays once, stops on a second click
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

// Each entry's play button goes next to its word's heading (in the index,
// see indexHTML); given a title, a whole-name entry has that as heading.
// (sounds: each term's recordings; the first this browser can play)
function addPronunciations(root, entries, sounds, title) {
  const probe = document.createElement("audio");
  for (const e of entries) {
    const src = (sounds[e.term] || []).find((s) => s.type && probe.canPlayType(s.type))?.src;
    const head = title && isWhole(entries) ? title : root.querySelector(`[data-term="${CSS.escape(e.term)}"]`);
    if (src) head?.append(playButton(e.term, src));
  }
}

// The whole name in the dictionary ("red-handed"): one entry, big, like a
// dictionary page, under the slide's title (the name). Single words go into
// the index with the articles instead (indexHTML).
const dictionaryHTML = (entries) =>
  `<div class="dictionary dictionary--whole">` +
  entries.map((e) => `<article class="dictionary__entry">${sensesHTML(e)}</article>`).join("") +
  `</div>`;

const blocksHTML = (blocks) =>
  blocks
    .map((b) =>
      b.items
        ? `<ul>${b.items.map((i) => `<li>${escapeHTML(i)}</li>`).join("")}</ul>`
        : `<p>${escapeHTML(b.text)}</p>`
    )
    .join("");

/* —— the page —— */

// each named color's own address on the site (see slugsOf)
const slugMaps = new WeakMap();
function slugFor(data, name) {
  if (!slugMaps.has(data)) slugMaps.set(data, slugsOf(data.items));
  return slugMaps.get(data).get(name);
}

// A named color's own page (color/<slug>/, written by the build) carries
// the nightly copy of what Wikipedia and Wiktionary say about the name:
// read from this page when it is that page, otherwise fetched from it
const COPY = /<script type="application\/json" id="color-data">([\s\S]*?)<\/script>/;
const builtPage = (() => {
  try {
    return JSON.parse(document.getElementById("color-data")?.textContent || "null");
  } catch {
    return null;
  }
})();

// the copy: { name, hex, looked, art }
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

const page = {}; // elements, filled in by initDetailPage
let current = null;

// every other way to write the color (the hex is the slide's headline);
// each value copies itself on click
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

// meanings, effects and usage from color-description, laid out like the specs; the
// dataset is written from a western perspective, so they're offered as
// associations ("often"), not facts
function wordsHTML(lore) {
  return [
    ["Often means", lore.meanings],
    ["Can make you", lore.effects],
    ["Fits", lore.usage],
  ]
    .filter(([, words]) => words?.length)
    .map(([title, words]) => {
      // a sentence, like the other specs: "nature, earthiness and peace"
      const w = words.slice(0, 8);
      const said = w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w.at(-1)}` : w[0];
      return `<div>
        <dt class="label">${title}</dt>
        <dd>${escapeHTML(said)}</dd>
      </div>`;
    })
    .join("");
}

// the slide's headline, written from the data: "Red often stands for
// excitement, energy and passion."
function wordsTitle(lore) {
  const [noun] = lore.nouns;
  const top = lore.meanings.slice(0, 3);
  if (!noun || !top.length) return "What it can say.";
  const list = top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0];
  return `${noun[0].toUpperCase()}${noun.slice(1)} often stands for ${list}.`;
}

// Wikipedia as an index: the title on the left, the opening on the right
// When each name was added (public/added.json, written at build time from
// the repository's history by scripts/added.mjs): the commit and its date.
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

// The card's look, as CSS custom properties: the color and its two shades.
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

// The neighbors as small copies of the hero's card, each linking to its page.
// --anim-appear-delay staggers their entrance, as on the original.
const neighborsHTML = (items) =>
  items
    .map(
      (it, i) => `<a class="neighbor" href="#${it.hex.slice(1)}" aria-label="${escapeHTML(it.name)}, ${it.hex}">
        <article class="swatchcard" style="${cardStyle(it.hex)};--anim-appear-delay:${i * 75}ms">
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
        </article>
      </a>`
    )
    .join("");

// the neighbor cards play their entrance once their slide comes into view
let neighborWatch = null;
function revealNeighbors() {
  neighborWatch?.disconnect();
  neighborWatch = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      neighborWatch.disconnect();
      page.neighbors
        .querySelectorAll(".swatchcard")
        .forEach((card) => card.classList.add("swatchcard--visible"));
    },
    { threshold: 0.2 }
  );
  neighborWatch.observe(page.neighbors);
}

// The name's words and its Wikipedia articles in one index. A word with an
// article of its own shares its row: the word, its play button and its
// definitions on the left, the article on the right. A word without one
// gets a row of its own, its definitions where an article's text would be.
const capital = (t) => t[0].toUpperCase() + t.slice(1);

const sensesHTML = (word) =>
  word.parts
    .map(
      (p) => `<p class="label">${escapeHTML(p.part)}</p>
        <ol class="dictionary__senses">${p.definitions.map((d) => `<li>${escapeHTML(d)}</li>`).join("")}</ol>`
    )
    .join("") +
  `<a class="dictionary__source" href="${escapeHTML(word.link)}" target="_blank" rel="noopener">Wiktionary</a>`;

function indexHTML(words, entries) {
  const wordFor = new Map(words.map((w) => [w.term.toLowerCase(), w]));
  const placed = new Set();
  // a block: its heading; under it the dictionary's definitions, if any;
  // then, stepped in further, the article: its picture beside its opening
  const block = (title, term, word, image, article) => `<article class="wiki-index__row">
      <h3${term ? ` data-term="${escapeHTML(term)}"` : ""}><span>${escapeHTML(title)}</span></h3>
      ${word ? `<div class="wiki-index__words">${sensesHTML(word)}</div>` : ""}
      ${
        article
          ? `<div class="wiki-index__body">
        ${
          image
            ? `<img class="wiki-index__picture" src="${escapeHTML(image)}" alt="" loading="lazy" style="--tilt:${between(-4, 4).toFixed(1)}deg;--nudge:${between(-0.6, 0.6).toFixed(2)}rem" />`
            : ""
        }
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
        (e.link ? `<a href="${escapeHTML(e.link)}" target="_blank" rel="noopener">Read on Wikipedia</a>` : "")
    );
  });
  for (const word of words) {
    if (placed.has(word)) continue;
    rows.push(block(capital(word.term), word.term, word, null, ""));
  }
  // no heading: each block's links say where it comes from
  return rows.length ? `<div class="wiki-index">${rows.join("")}</div>` : "";
}

// The pictures from those articles, as a loose pile hanging off the bottom
// of the slide: each at its own ratio (a set height, its own width), spread
// along the edge with a little randomness in place, height and tilt.
const between = (a, b) => a + Math.random() * (b - a);
const imagesHTML = (images) =>
  `<div class="picture-pile">` +
  images
    .map((img, i) => {
      const x = ((i + 0.5) / images.length) * 100 + between(-4, 4);
      const vars = [
        `--x:${x.toFixed(1)}%`,
        `--y:${between(-1.5, 1.5).toFixed(2)}rem`,
        `--h:${between(8.5, 12.5).toFixed(2)}rem`,
        `--rot:${between(-9, 9).toFixed(1)}deg`,
        `--z:${Math.floor(between(1, 20))}`,
      ].join(";");
      return `<a href="${escapeHTML(img.link)}" target="_blank" rel="noopener" style="${vars}">
        <img srcset="${escapeHTML(img.srcset)}" src="${escapeHTML(img.src)}"
          alt="${escapeHTML(img.alt)}" />
      </a>`;
    })
    .join("") +
  `</div>`;

async function copy(text, btn, done) {
  try {
    await navigator.clipboard.writeText(text);
    const was = btn.textContent;
    btn.textContent = done;
    setTimeout(() => (btn.textContent = was), 1500);
  } catch {
    // clipboard blocked: the value stays visible to copy by hand
  }
}

// Visible slides alternate ink and paper, starting with the ink hero, so a
// slide that has nothing to show never leaves two of a kind side by side.
// The full-bleed color slide sits outside the count: it's neither.
function alternate() {
  [...page.root.querySelectorAll("[data-slide]")]
    .filter((el) => !el.hidden)
    .forEach((el, i) => el.classList.toggle("slide--invert", i % 2 === 0));
}

// Where the edge pictures go down the page: spread evenly over what's left
// once the hero and the Wikipedia slide (with its hanging pile) are taken
// out, each side on its own. Run again whenever the page's height changes.
function placePeeks() {
  const peeks = [...page.peeks.children];
  if (!peeks.length) return;
  const main = page.peeks.parentElement;
  const top = main.getBoundingClientRect().top;
  const span = (el) => {
    const r = el.getBoundingClientRect();
    return [r.top - top, r.bottom - top];
  };
  // pictures are placed by their middles, so a stretch has to keep half the
  // tallest one (and a little) clear at each end
  const half = Math.max(...peeks.map((el) => el.firstElementChild.offsetHeight)) / 2 + 24;
  // from under the hero down to the footers
  const start = span(page.root.querySelector(".color-hero"))[1];
  const end = span(page.root.querySelector(".footer") || main)[0];
  let free = [[start + half, end - half]];
  // not on the slides of pictures: the Wikipedia one (with its pile hanging
  // into the next) and the one of art
  const taken = [];
  if (!page.meaningSlide.hidden) {
    const [a, b] = span(page.meaningSlide);
    const pile = page.root.querySelector(".picture-pile");
    taken.push([a, pile?.childElementCount ? Math.max(b, span(pile)[1]) : b]);
  }
  if (!page.artSlide.hidden) taken.push(span(page.artSlide));
  for (const [a, b] of taken) {
    free = free.flatMap(([s, e]) =>
      [
        [s, Math.min(e, a - half)],
        [Math.max(s, b + half), e],
      ].filter(([x, y]) => y - x > 0)
    );
  }
  const total = free.reduce((n, [s, e]) => n + e - s, 0);
  if (total <= 0) return;
  for (const el of peeks) {
    // a share of the free length, walked through the free stretches
    let d = Math.min(0.999, Math.max(0, +el.dataset.k)) * total;
    for (const [s, e] of free) {
      if (d <= e - s) {
        el.style.setProperty("--top", `${Math.round(s + d - el.firstElementChild.offsetHeight / 2)}px`);
        break;
      }
      d -= e - s;
    }
  }
}

// Each edge picture comes in from past the edge once its image has loaded
// and its place is on screen, not before (they load right away: lazy
// loading would wait for them to be on screen, which they aren't till then)
let peeksSeen;
function revealPeeks() {
  peeksSeen?.disconnect();
  peeksSeen = new IntersectionObserver((seen) => {
    for (const { target, isIntersecting } of seen) {
      if (!isIntersecting) continue;
      peeksSeen.unobserve(target);
      const img = target.querySelector("img");
      const show = () => requestAnimationFrame(() => target.classList.add("is-in"));
      if (img.complete && img.naturalWidth) show();
      else img.addEventListener("load", show, { once: true });
    }
  });
  for (const el of page.peeks.children) peeksSeen.observe(el);
}

// The pictures hang into the slide after theirs, each a different amount:
// that slide starts below the lowest of them, by the usual slide spacing,
// so its heading sits like every other slide's.
function pileGap() {
  const pile = page.root.querySelector(".picture-pile");
  // the next slide that shows (one after it may still be hidden)
  let next = page.meaningSlide.nextElementSibling;
  while (next?.hidden) next = next.nextElementSibling;
  page.root.querySelectorAll("[data-slide]").forEach((el) => el !== next && el.style.removeProperty("--pile-gap"));
  if (!next) return;
  if (!pile || !page.meaningSlide.classList.contains("has-pile")) {
    next.style.removeProperty("--pile-gap");
    return;
  }
  const line = pile.getBoundingClientRect().top;
  const low = Math.max(0, ...[...pile.children].map((a) => a.getBoundingClientRect().bottom - line));
  next.style.setProperty("--pile-gap", `${Math.ceil(low)}px`);
}

// The name, as large as the page sets it, unless a word of it is too long
// for its column ("Thanksgiving"): then smaller, a step at a time, until
// every word fits whole. Never broken inside a word.
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

// Where the card lands on the hero (see cardPlace); a card handed over
// from the wall brings the place it already flew to.
function placeCard(place = cardPlace()) {
  page.place.style.setProperty("--x", place.x.toFixed(3));
  page.place.style.setProperty("--y", place.y.toFixed(3));
  page.place.style.setProperty("--r", `${place.r.toFixed(1)}deg`);
}

async function render(hex) {
  const { card } = page;
  (page.embedded ? page.root : window).scrollTo(0, 0);

  // every color starts the card's entrance from its first frame
  card.classList.add("swatchcard--reset");
  card.classList.remove("swatchcard--visible");
  void card.offsetWidth;
  card.classList.remove("swatchcard--reset");
  for (const [k, v] of Object.entries(cardVars(hex))) card.style.setProperty(k, v);
  // Arriving from the wall, the card has already flown to its place there:
  // it is shown at once, at that very place, so the change of page doesn't
  // show. The title and text come in after.
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
  // the scrollbar in the color (the page's own, or the layer's over the wall)
  (page.embedded ? page.root : document.documentElement).style.setProperty("--page-color", hex);
  page.ink.textContent = "";
  page.mix.replaceChildren();
  page.about.replaceChildren();
  page.neighbors.replaceChildren();
  page.neighborsSlide.hidden = true;
  page.dictionary.replaceChildren();
  page.wiki.replaceChildren();
  page.wordsSlide.hidden = true;
  peeksSeen?.disconnect();
  page.peeks.replaceChildren();
  page.meaningSlide.hidden = true;
  page.meaningSlide.classList.remove("has-pile");
  page.artSlide.hidden = true;
  page.art.replaceChildren();
  alternate();
  document.title = `${hex} — Color Names`;

  const lore = new ColorDescription(hex);
  const mix = lore.percentageWords();

  const data = await getList("default");
  if (current?.hex !== hex) return; // a newer color took over
  const exact = data.byHex.get(hex);
  const { item: near, distance } = exact ? { item: exact, distance: 0 } : closestAny(data, hex);
  const unnamed = !exact && distance > UNNAMED;
  current.name = exact || !unnamed ? near.name : null;
  const title = current.name || "No name yet";

  page.cardName.textContent = exact ? exact.name : unnamed ? "No name yet" : `≈ ${near.name}`;
  page.name.textContent = title;
  page.colophonColor.textContent = current.name ? `${current.name} · ${hex}` : hex;
  fitTitle();
  document.title = `${title}: ${hex} — Color Names`;

  // the two lines under the name: what it is, and how it can be described
  const [noun, alt] = lore.nouns;
  const adjective = /^(black|white)$/.test(noun) ? "" : lore.descriptiveWords[0]; // no "very dark black"
  const kind = [adjective, noun].filter(Boolean).join(" ");
  const article = /^[aeiou]/i.test(kind) ? "an" : "a";
  const subject = current.name || "This color";
  // the best-fitting words only: the hero is no place for all eleven
  const lines = [
    kind && `${subject} is ${article} ${kind}${alt ? `, close to ${alt}` : ""}.`,
    `It can be described as ${lore.getDescriptiveList(false, 4)}.`,
  ].filter(Boolean);
  page.intro.replaceChildren(
    ...lines.map((t) => Object.assign(document.createElement("p"), { className: "lead", textContent: t }))
  );

  // the hex, and how the title relates to it: the name itself, the
  // nearest name (and its own hex), or none yet
  const stats = [hex];
  if (unnamed) stats.push("Not named yet");
  else if (!exact) stats.push(`Nearest name, ${near.hex}`);
  page.stats.replaceChildren(
    ...stats.map((t) => Object.assign(document.createElement("span"), { textContent: t }))
  );
  // when the name was added, linking to the commit that did it
  if (exact) {
    // and, when someone other than the list's maintainer added it, by whom
    addedOn(current.name).then((added) => {
      if (!added || current?.hex !== hex) return;
      const link = (href, text, title) =>
        Object.assign(document.createElement("a"), { href, textContent: text, title, target: "_blank", rel: "noopener" });
      const line = document.createElement("span");
      line.append(link(`https://github.com/meodai/color-names/commit/${added.hash}`, `Added ${added.date}`, `Commit ${added.hash}`));
      if (added.by) {
        line.append(" by ");
        line.append(added.github ? link(`https://github.com/${added.github}`, added.by, `@${added.github} on GitHub`) : added.by);
      }
      page.stats.append(line);
    });
  }

  // the color slide is set in whichever of black or white reads best on it
  const ink = lore.bestContrast === "white" ? "#fff" : "#000";
  page.fill.style.setProperty("--fill-ink", ink);
  page.colophon.style.setProperty("--fill-ink", ink);
  page.ink.textContent = `Set in ${lore.bestContrast}, because ${lore.bestContrast} reads best on it.`;
  const print = lore.percentageWords("cmyk");
  const light = lore.temperatureWords;
  page.mix.innerHTML = [
    ["On screen", `${mix[0]} red, ${mix[1]} green and ${mix[2]} blue`],
    ["In print", `${print[0]} cyan, ${print[1]} magenta, ${print[2]} yellow and ${print[3]} black`],
    ["As light", `about ${light.value.toLocaleString("en-US")} K, ${light.descriptive.join(", ")}`],
  ]
    .map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${escapeHTML(v)}</dd></div>`)
    .join("");

  // the library's short essays about the color's families
  page.about.innerHTML = lore.description.map((t) => `<p>${escapeHTML(t)}</p>`).join("");
  page.wordsTitle.textContent = wordsTitle(lore);
  page.words.innerHTML = wordsHTML(lore);
  // the nightly copy of what Wikipedia says, when the name has one
  const saved = exact ? savedLookup(current.name, slugFor(data, current.name)) : Promise.resolve(null);
  showPictures(hex, [current.name, lore.nouns[0]], saved);
  // a color without a name of its own borrows the nearest name's art,
  // what of it is close to this color too
  showArt(
    hex,
    exact ? current.name : hex,
    exact ? saved : savedLookup(near.name, slugFor(data, near.name)),
    !exact
  );
  page.neighbors.innerHTML = neighborsHTML(neighbors(data, hex));
  page.neighborsSlide.hidden = false;
  revealNeighbors();
  page.wordsSlide.hidden = !page.words.innerHTML.trim();

  // the page's own address, to share: a named color's own page once the
  // site is built (in development there are none)
  const own = exact && import.meta.env.PROD ? new URL(siteURL(`color/${slugFor(data, current.name)}/`)) : location;
  page.pageLink.href = own.href;
  page.pageLink.textContent = `${own.host}${own.pathname}${own.hash}`;
  page.outro.textContent = unnamed ? "Nobody named it yet." : "Share it.";
  alternate();

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      card.classList.remove("swatchcard--reset");
      card.classList.add("swatchcard--visible");
    })
  );

  if (!current.name) return;
  // the nightly copy when there is one, otherwise Wikipedia itself
  const looked = (await saved)?.looked || (await lookupName(current.name));
  const { definitions, entries, images, sounds } = looked;
  if (current?.hex !== hex || (!definitions.length && !entries.length)) return;
  page.meaningTitle.textContent = current.name;
  // Words join the index of articles, each in its article's row. The whole
  // name too, when there's an article on it ("Thanksgiving"); without one
  // it stays an entry of its own, set large under the slide's title.
  const whole =
    isWhole(definitions) && !entries.some((e) => baseTitle(e.title) === definitions[0].term.toLowerCase());
  page.dictionary.innerHTML = whole ? dictionaryHTML(definitions) : "";
  page.wiki.innerHTML = indexHTML(whole ? [] : definitions, entries);
  addPronunciations(whole ? page.dictionary : page.wiki, definitions, sounds, whole ? page.meaningTitle : null);
  page.meaningSlide.hidden = false;
  alternate();
  if (!images.length) return;
  page.wiki.insertAdjacentHTML("beforeend", imagesHTML(images));
  page.meaningSlide.classList.add("has-pile");
  pileGap();
  // a tilted picture reaches lower once it has its width: measure again
  page.wiki.querySelectorAll(".picture-pile img").forEach((img) => img.addEventListener("load", pileGap, { once: true }));
}

// Pictures from Wikimedia Commons, picked by how much of them is the color:
// as the nightly copy picked them, or else picked here (see lookupPictures)
async function showPictures(hex, terms, saved) {
  const pictures = (await saved)?.looked?.pictures ?? (await lookupPictures(hex, terms));
  if (current?.hex !== hex || !pictures.length) return;
  page.peeks.innerHTML = peeksHTML(pictures, hex);
  placePeeks();
  revealPeeks();
}

// Works of art whose colors are close to this one, as the build picked them
// for a name (see art.js); a color without a name borrows its nearest's
async function showArt(hex, title, saved, borrowed) {
  const art = (await saved)?.art || [];
  const works = borrowed ? artNear(art, hex) : art;
  if (current?.hex !== hex || !works.length) return;
  page.artTitle.textContent = `${title}, in art.`;
  page.art.innerHTML = artHTML(works);
  page.artSlide.hidden = false;
  alternate();
  pileGap();
}

// each work in a frame, tilted a little (art.js)
const artHTML = (works) => works.map((w) => workHTML(w, `--tilt:${between(-2.5, 2.5).toFixed(1)}deg`)).join("");

// The color comes after the hash: color/#5c3a8e
const hexFromHash = () => normalizeHex(location.hash.slice(1));

const arrived = () => document.documentElement.classList.remove("is-arriving");

// The color page, on its own page or embedded in the wall: there it runs
// inside an element of the wall's document (root), its listeners end with
// the signal, and closing is the wall's to do (onClose).
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
    neighborsSlide: q("[data-neighbors-slide]"),
    words: q("[data-words]"),
    wordsTitle: q("[data-words-title]"),
    wordsSlide: q("[data-words-slide]"),
    dictionary: q("[data-dictionary]"),
    wiki: q("[data-wiki]"),
    meaningSlide: q("[data-meaning-slide]"),
    peeks: q("[data-peeks]"),
    meaningTitle: q("[data-meaning-title]"),
    art: q("[data-art]"),
    artSlide: q("[data-art-slide]"),
    artTitle: q("[data-art-title]"),
    pageLink: q("[data-page-link]"),
    outro: q("[data-outro]"),
  });

  // the browser's own sharing where there is one; otherwise the link is
  // copied, and says so for a moment
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
    } catch {} // clipboard blocked: the address is right there to copy
  });

  page.formats.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copy(btn.dataset.copy, btn, "Copied");
  });

  // close: always to the 3D wall. Embedded in it, the wall closes the page
  // (onClose); on its own, the link goes there.
  const close = q("[data-close]");
  close.addEventListener("click", (e) => {
    if (onClose) {
      e.preventDefault();
      onClose();
    }
  });
  // embedded, every way home (the corner, the footer) is the way out too
  if (onClose) {
    root.querySelectorAll('a[href="../"]:not([data-close])').forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        onClose();
      })
    );
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close.click();
    },
    { signal }
  );

  const show = () => {
    // color/#hex, or a named color's own page
    const hex = hexFromHash() || (!embedded && builtPage?.hex) || null;
    if (hex) render(hex);
    else if (!embedded) location.replace(siteURL());
  };
  window.addEventListener("hashchange", show, { signal });
  // the page grows as its parts come in: the edge pictures follow
  let placing = 0;
  const grows = new ResizeObserver(() => {
    cancelAnimationFrame(placing);
    placing = requestAnimationFrame(placePeeks);
  });
  grows.observe(page.peeks.parentElement);
  signal?.addEventListener("abort", () => grows.disconnect());

  window.addEventListener(
    "resize",
    () => {
      if (page.name.textContent) fitTitle();
      pileGap();
    },
    { signal }
  );
  show();
}
