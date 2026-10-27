// A page per name (color/<slug>/), hex forwards (color/<hex>/), 404.html,
// sitemap.xml and robots.txt, after the build.
//
//   node scripts/pages.mjs [--data .data] [--descriptions .descriptions] [--site https://names.color.pizza/]

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import ColorDescription from "color-description";
import { slugsOf, hexToRgb, rgbToOklab, tidySenses } from "../src/names.js";
import { unpackWork, MUSEUMS, MEDIA } from "../src/art.js";
import { cardKey, cardURL } from "./cards.mjs";
import { FORMATS } from "../src/formats.js";
import { ADOPT_FROM, HEART, handle, longDate } from "../src/adopter.js";
import { documentURI, documentKey, FIRST_DAY } from "../src/standard-site.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const DIST = resolve(here, "../dist");
const DATA = resolve(here, "..", arg("data", ".data"));
const LIST = resolve(here, "../color-names/src/colornames.csv");
const SITE = (process.env.SITE_URL || arg("site", "https://names.color.pizza/")).replace(/\/?$/, "/");

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// JSON inside a <script>: nothing in it may close the script
const scriptJSON = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const items = readFileSync(LIST, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, hex] = line.split(",");
    return { name, hex: hex.toLowerCase() };
  });
const slugs = slugsOf(items);
const DESCRIPTIONS = resolve(here, "..", arg("descriptions", ".descriptions"), "descriptions.json");
const descriptions = existsSync(DESCRIPTIONS)
  ? JSON.parse(readFileSync(DESCRIPTIONS, "utf8"))
      .filter((d) => d.description && slugs.has(d.name))
      .map(({ name, hex, description }) => ({ name, hex, description }))
  : [];
writeFileSync(join(DIST, "descriptions.json"), JSON.stringify(descriptions));
const described = new Map(descriptions.map((d) => [d.name, d.description]));

// same as the page's own (detail.js), as links crawlers can follow
const NEIGHBORS = 12;
const lab = new Float64Array(items.length * 3);
items.forEach(({ hex }, i) => lab.set(rgbToOklab(hexToRgb(hex)), i * 3));
function neighborsOf(i, count = NEIGHBORS) {
  const [L, a, b] = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
  const best = []; // [distance², index], closest first
  for (let j = 0; j < items.length; j++) {
    if (items[j].hex === items[i].hex) continue;
    const d = (lab[j * 3] - L) ** 2 + (lab[j * 3 + 1] - a) ** 2 + (lab[j * 3 + 2] - b) ** 2;
    if (best.length === count && d >= best[count - 1][0]) continue;
    let k = best.length;
    while (k > 0 && best[k - 1][0] > d) k--;
    best.splice(k, 0, [d, j]);
    if (best.length > count) best.pop();
  }
  return best.map(([, j]) => items[j]);
}

const copyOf = (slug) => {
  const file = join(DATA, "names", slug[0], `${slug}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// palettes and credits of every collection, kept with the copies
// (and a fingerprint of all of it, with the code that picks from it)
const artPrint = createHash("sha1").update(readFileSync(resolve(here, "../src/art.js")));
// the picks rest on the museums alone: the Wikipedia copies only swap in pictures later
const artTexts = [];
// a collection that can't be read is no collection at all, not an empty one: picking
// without it would change every color's art, and send every list again
const unread = [];
async function collection(name, picked = true) {
  const local = process.env.ART_DATA && join(process.env.ART_DATA, `${name}.json`);
  let text = null;
  let why = "";
  if (local && existsSync(local)) text = readFileSync(local, "utf8");
  else {
    const res = await fetch(`${MEDIA}/data/${name}.json?t=${Date.now()}`).catch((e) => {
      why = e.message;
      return null;
    });
    if (res?.ok) text = await res.text();
    else if (res) why = `HTTP ${res.status}`;
  }
  let list = null;
  try {
    list = text === null ? null : JSON.parse(text);
    if (list && !Array.isArray(list)) [list, why] = [null, "not a list"];
  } catch {
    why = "not JSON";
  }
  if (!list) {
    console.log(`pages.mjs: couldn't read the art data ${name}.json (${why || "no answer"})`);
    if (picked) unread.push(name);
    return [];
  }
  if (picked) {
    artPrint.update(name).update(text);
    artTexts.push([name, text]);
  }
  return list;
}
// only counted here: the workers unpack and pick (pick-art.mjs), as the works and their
// index twice over don't fit beside each other
let works = 0;
for (const museum of Object.keys(MUSEUMS)) {
  for (const w of await collection(museum)) if (unpackWork(w, museum)) works++;
}
const wikimedia = new Map(
  (await collection("wikimedia-art", false)).filter((w) => w.thumb).map((w) => [w.accession, w]),
);
// with a museum missing, the art stays as it was last picked: nothing picked, sent or saved
const KEEP_ART = unread.length > 0;
if (KEEP_ART) console.log(`pages.mjs: keeping the art picked before, as ${unread.join(", ")} couldn't be read`);
else if (!works) console.log("pages.mjs: no art data; no page has art");
const picking = works > 0 && !KEEP_ART;
const ART_PRINT = artPrint.digest("hex");

// the build fills in {{colorCount}} (vite.config.js); counted again here from the same list,
// so none is left in a page this writes
const COUNT = items.length.toLocaleString("en-US");
const withCount = (html) => html.replaceAll("{{colorCount}}", COUNT);
const template = withCount(readFileSync(join(DIST, "color/index.html"), "utf8")).replace(/"\.\.\//g, '"../../');

// as detail.js writes them
function intro(name, hex) {
  const lore = new ColorDescription(hex);
  const [noun, alt] = lore.nouns;
  const adjective = /^(black|white)$/.test(noun) ? "" : lore.descriptiveWords[0];
  const kind = [adjective, noun].filter(Boolean).join(" ");
  const article = /^[aeiou]/i.test(kind) ? "an" : "a";
  return [
    kind && `${name} is ${article} ${kind}${alt ? `, close to ${alt}` : ""}.`,
    `It can be described as ${lore.getDescriptiveList(false, 4)}.`,
  ].filter(Boolean);
}

function inkLines(hex, lines) {
  const ink = new ColorDescription(hex).bestContrast;
  return [...lines, `Set in ${ink}, because ${ink} reads best on it.`];
}

const fileTitle = (link = "") =>
  decodeURIComponent(link.split("/wiki/")[1] || "")
    .replace(/_/g, " ")
    .replace(/^(File|Image):/i, "File:");
const credit = (w) => ({ artist: w.artist, license: w.license, licenseUrl: w.licenseUrl });
const paletteOf = (w) => (w.palette || []).map((c) => [c.hex.toLowerCase(), c.share]);

const fileLink = (src = "") => {
  const m = src.match(
    /(?:upload|thumb)\.wikimedia\.org\/wikipedia\/(commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/,
  );
  return m ? `https://${m[1] === "commons" ? "commons.wikimedia.org" : "en.wikipedia.org"}/wiki/File:${m[2]}` : "";
};

// the pictures that have a copy, pointing at it; an article keeps its lead picture
function hosted(looked) {
  if (!looked) return looked;
  const copy = (p) => wikimedia.get(fileTitle(p.link));
  const leads = new Set((looked.entries || []).filter((e) => e.image).map((e) => fileTitle(fileLink(e.image))));
  return {
    ...looked,
    entries: (looked.entries || []).map(({ image, ...e }) => {
      if (!image) return e;
      const w = copy({ link: fileLink(image) });
      return w ? { ...e, image: `${MEDIA}/${w.thumb}` } : e;
    }),
    pictures: (looked.pictures || []).flatMap((p) => {
      const w = copy(p);
      return w
        ? [{ ...p, image: `${MEDIA}/${w.thumb}`, ratio: w.width / w.height, credit: credit(w), palette: paletteOf(w) }]
        : [];
    }),
    images: (looked.images || [])
      .filter((img) => !leads.has(fileTitle(img.link)))
      .flatMap((img) => {
        const w = copy(img);
        return w
          ? [
              {
                ...img,
                src: `${MEDIA}/${w.thumb}`,
                srcset: "",
                ratio: w.width / w.height,
                credit: credit(w),
                palette: paletteOf(w),
              },
            ]
          : [];
      }),
  };
}

function summary(looked) {
  const text = looked?.entries?.[0]?.blocks?.find((b) => b.text)?.text;
  return text ? text.replace(/\s+/g, " ").trim() : "";
}

const clip = (text, length) => (text.length <= length ? text : `${text.slice(0, length - 1).replace(/\s+\S*$/, "")}…`);

// for readers without JS; the script replaces it
function meaningHTML(looked) {
  const words = (looked?.definitions || [])
    .map(
      (d) => `<article class="wiki-index__row"><h3 class="title title--sub"><span>${escapeHTML(d.term)}</span></h3>
        ${d.parts
          .map(
            (p) =>
              `<p class="label">${escapeHTML(p.part)}</p><ol>${tidySenses(p.definitions)
                .map((t) => `<li>${escapeHTML(t)}</li>`)
                .join("")}</ol>`,
          )
          .join("")}
        <a href="${escapeHTML(d.link)}">Wiktionary</a></article>`,
    )
    .join("");
  const articles = (looked?.entries || [])
    .map((e) => {
      const opening = e.blocks.find((b) => b.text)?.text || "";
      return `<article class="wiki-index__row"><h3 class="title title--sub"><span>${escapeHTML(e.title)}</span></h3>
        <p>${escapeHTML(opening)}</p>
        ${e.link ? `<a href="${escapeHTML(e.link)}">Read on Wikipedia</a>` : ""}</article>`;
    })
    .join("");
  return words || articles ? `<div class="wiki-index">${articles}${words}</div>` : "";
}

const structured = ({ name, hex, url, description, lines }) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  url,
  name: `${name} (${hex})`,
  description,
  primaryImageOfPage: { "@type": "ImageObject", url: cardURL({ name, hex }), width: 1200, height: 630 },
  isPartOf: { "@type": "WebSite", name: "Color Names", url: SITE },
  about: {
    "@type": "DefinedTerm",
    name,
    termCode: hex,
    description: lines.join(" "),
    inDefinedTermSet: { "@type": "DefinedTermSet", name: "Color Names", url: SITE },
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Color Names", item: SITE },
      { "@type": "ListItem", position: 2, name, item: url },
    ],
  },
});

const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHTML(value)}" />`;

let written = 0;
// the day each name was added, for its Standard.site record
const added = existsSync(join(DIST, "added.json")) ? JSON.parse(readFileSync(join(DIST, "added.json"), "utf8")) : null;
const addedDay = (name) => added?.commits[added.names[name]]?.[1] || FIRST_DAY;
const documents = [];
// who adopted which color: slug → { by, on, amount, shine, at }, as the upload
// worker keeps it; adopted.json in the repo only when that can't be read
const ADOPTED = resolve(here, "../adopted.json");
const adopted =
  (await fetch(`https://media.color.pizza/data/adopted.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : r.status === 404 ? {} : null))
    .catch(() => null)) ?? (existsSync(ADOPTED) ? JSON.parse(readFileSync(ADOPTED, "utf8")) : {});
// pixel art of a color's name, by Retro Diffusion: slug -> { v, subject, verified }
const pixels =
  (await fetch(`https://media.color.pizza/data/pixel.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))) || {};
// the hero's stats as the page's script fills them: the hex, the line it was added on (filled
// later, on the same line) and its adoption, or the way to adopt it
const statsHTML = (hex, adopted, slug) =>
  `<span>${hex}</span><span></span><span class="hero__adopted">${
    adopted?.amount >= ADOPT_FROM
      ? `Adopted ${escapeHTML(longDate(adopted.at))} by <span class="hero__adopter">${escapeHTML(handle(adopted.by, adopted.on))}</span>, <a class="hero__patron" href="../../supporters/#color-${slug}">${adopted.founding ? "founding patron" : "patron"}</a>`
      : `<a class="adopt-cta" href="../../adopt/#${hex.slice(1)}">Adopt this color ${HEART}</a>`
  }</span>`;
// drawn from a hand-written hint: its subject isn't published, the name stands in
const pixelOf = (slug, name) =>
  pixels[slug] && {
    src: `https://media.color.pizza/pixel/${slug}.webp?v=${pixels[slug].v}`,
    subject: pixels[slug].subject || `Pixel art of ${name}`,
  };

// a color's link preview comes through the worker, which picks it when asked: the color's
// adopted card the moment there is one, else its plain card, no build needed in between
const previewOf = (slug, it) =>
  `https://color-names-upload.cloudflare-54bbeb.workers.dev/og/${slug}.png?k=${cardKey(it)}`;
let withArt = 0;
let withCopy = 0;
// each name's art list lives on media.color.pizza (lists/<slug>.json), not in
// its page; LOCAL_LISTS keeps them in dist/lists for a preview without uploads
const LISTS = resolve(here, "../.cache/lists");
const LOCAL = !!process.env.LOCAL_LISTS;
const listURL = (slug) => (LOCAL ? `../../lists/${slug}.json` : `${MEDIA}/lists/${slug}.json`);
const listed = existsSync(join(LISTS, "uploaded.json"))
  ? JSON.parse(readFileSync(join(LISTS, "uploaded.json"), "utf8"))
  : {};
const toUpload = [];
// the lists picked this time wait on disk, not in memory: 30,000 of them are gigabytes
const SPOOL = resolve(here, "../.cache/art-spool");
const spooled = (hex) => join(SPOOL, `${hex.slice(1)}.json`);
rmSync(SPOOL, { recursive: true, force: true });
mkdirSync(SPOOL, { recursive: true });
// what each color's art list came to (its fingerprint, "" for none): a color known here
// keeps its list whatever art has come since, and only a new one is picked, from all of
// it; ART_REPICK=1 picks every color again (by hand: new art, or a change to art.js)
const PICKS = join(LISTS, "picks.json");
const cached = existsSync(PICKS) ? JSON.parse(readFileSync(PICKS, "utf8")) : null;
const REPICK = !!process.env.ART_REPICK;
if (REPICK && !KEEP_ART) console.log("pages.mjs: ART_REPICK, every color's art picked again");
const picks = cached && (!REPICK || KEEP_ART) ? cached.byHex : {};
let picked = 0;
const sitemap = [`<url><loc>${SITE}</loc></url>`];
// the whole list as linked data, a color a line: what its page says, with Wikipedia and
// Wiktionary only as titles and links
const DATASET = "colornames.jsonld.ndjson";
const CONTEXT = "colornames.context.jsonld";
const dataset = [];
function datasetLine({ name, hex, url, said, looked, pixel }) {
  const lore = new ColorDescription(hex);
  const some = (words) => (words || []).slice(0, 8);
  return JSON.stringify({
    "@context": `${SITE}${CONTEXT}`,
    "@id": url,
    name,
    hex,
    description: said || null,
    formats: Object.fromEntries(
      Object.entries(FORMATS)
        .filter(([k]) => k !== "hex")
        .map(([k, f]) => [k, f.fn(hex)]),
    ),
    words: {
      describe: some(lore.descriptiveWords),
      means: some(lore.meanings),
      makesYou: some(lore.effects),
      fits: some(lore.usage),
    },
    meaning: (looked?.entries || []).map((e) => ({
      title: e.title,
      wikipedia: e.link,
      ...(e.wikidata ? { wikidata: `https://www.wikidata.org/wiki/${e.wikidata}` } : {}),
    })),
    definitions: (looked?.definitions || []).map((d) => ({ term: d.term, wiktionary: d.link })),
    ...(pixel
      ? {
          pixelArt: {
            image: pixel.src,
            subject: pixel.subject,
            license: "https://creativecommons.org/licenses/by/4.0/",
            credit: "Pixel art by Retro Diffusion, gifted to Color Names",
            creditUrl: "https://retrodiffusion.ai/",
          },
        }
      : {}),
  });
}

// ONLY=slug,slug: just those pages, for a quick local preview
const ONLY = process.env.ONLY && new Set(process.env.ONLY.split(","));

// where it is, every tenth of the way, as a build waits on this the longest
const began = Date.now();
const minutes = (ms) => `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
const tenth = Math.ceil(items.length / 10);

// picked before and its list already up (or, locally, already written): known
const isUp = (slug) => (LOCAL ? existsSync(join(DIST, "lists", `${slug}.json`)) : !!listed[slug]);
// keeping the art, every color is: whatever list is up stays, and one without has none this time
const readyFor = (slug, hex) => {
  const known = picks[hex];
  return KEEP_ART || (known !== undefined && (!known || (LOCAL ? isUp(slug) : listed[slug] === known)));
};

// the colors to pick again, on every core at once: whether each has a list (spooled), or none
async function pickAll(hexes) {
  const lists = new Map();
  if (!picking || !hexes.length) return lists;
  const cores = Math.max(1, Math.min(availableParallelism(), 8, Math.ceil(hexes.length / 500)));
  const step = Math.ceil(hexes.length / 10);
  let next = step;
  await Promise.all(
    Array.from({ length: cores }, (_, n) => {
      const worker = new Worker(new URL("./pick-art.mjs", import.meta.url), {
        workerData: { texts: artTexts, hexes: hexes.filter((_, i) => i % cores === n), spool: SPOOL },
      });
      worker.on("message", (batch) => {
        for (const [hex, body] of batch) lists.set(hex, body);
        if (lists.size >= next) {
          const spent = Date.now() - began;
          console.log(
            `pages.mjs: art picked for ${lists.size.toLocaleString("en-US")} of ${hexes.length.toLocaleString("en-US")} colors on ${cores} cores, ${minutes(spent)}, about ${minutes((spent / lists.size) * (hexes.length - lists.size))} left`,
          );
          next += step;
        }
      });
      return new Promise((done, failed) => {
        worker.on("error", failed);
        worker.on("exit", (code) => (code ? failed(new Error(`pick-art.mjs stopped with ${code}`)) : done()));
      });
    }),
  );
  return lists;
}
const lists = await pickAll([
  ...new Set(
    items
      .filter(({ name, hex }) => !(ONLY && !ONLY.has(slugs.get(name))) && !readyFor(slugs.get(name), hex))
      .map(({ hex }) => hex),
  ),
]);
// picked: the collections' texts are the workers' no longer
artTexts.length = 0;

const writing = Date.now();
for (const [i, { name, hex }] of items.entries()) {
  if (!ONLY && i && i % tenth === 0) {
    const spent = Date.now() - writing;
    console.log(
      `pages.mjs: ${i.toLocaleString("en-US")} of ${items.length.toLocaleString("en-US")} pages, ${minutes(spent)}, about ${minutes((spent / i) * (items.length - i))} left`,
    );
  }
  const slug = slugs.get(name);
  if (ONLY && !ONLY.has(slug)) continue;
  const copy = copyOf(slug);
  if (copy) withCopy++;
  const looked = hosted(copy?.looked || null);
  const ready = readyFor(slug, hex);
  const art = ready
    ? picks[hex] && (!KEEP_ART || isUp(slug))
      ? true
      : null
    : lists.has(hex)
      ? lists.get(hex) && readFileSync(spooled(hex), "utf8")
      : "";
  lists.delete(hex);
  if (!ready) picked++;
  const url = `${SITE}color/${slug}/`;
  const lines = intro(name, hex);
  const said = described.get(name) || "";
  const about = summary(looked);
  const description = clip([said || lines.join(" "), about].filter(Boolean).join(" "), 158);
  const title = `${name}: ${hex} — Color Names`;
  const day = addedDay(name);
  documents.push({ key: documentKey(slug, day), slug, name, hex, day, description });

  // the link preview, on the page and on its hex forward
  const preview = [
    meta("property", "og:type", "website"),
    meta("property", "og:title", `${name} (${hex})`),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    meta("property", "og:site_name", "Color Names"),
    meta("property", "og:image", previewOf(slug, { name, hex })),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", `${name}, ${hex}: a swatch of the color`),
    meta("name", "twitter:card", "summary_large_image"),
  ];
  const head = [
    `<title>${escapeHTML(title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${url}" />`,
    `<link rel="site.standard.document" href="${documentURI(slug, day)}" />`,
    ...preview,
    // the browser's bar as the hero under it, as on the wall
    meta("name", "theme-color", "#000"),
    `<script type="application/ld+json">${scriptJSON(structured({ name, hex, url, description, lines }))}</script>`,
  ].join("\n    ");

  // replacement functions throughout: "$'" or "$`" in a name would be a pattern
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/\s*<meta\s+(?:property|name)="(?:og|twitter):[^>]*>/g, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, () => head)
    // its scrollbar in its color from the first frame, not once the script runs
    .replace('class="color-root"', () => `class="color-root" style="--page-color:${hex}"`)
    .replace(/(<h1[^>]*data-name[^>]*>)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${escapeHTML(name)}${close}`)
    // the line under it as the page's script lays it out, so the hero holds still when it does
    .replace(
      /(<p[^>]*data-stats[^>]*>)(<\/p>)/,
      (_, open, close) => `${open}${statsHTML(hex, adopted[slug], slug)}${close}`,
    )
    .replace(
      /(<div[^>]*data-intro[^>]*>)[\s\S]*?(<\/div>)/,
      (_, open, close) =>
        `${open}${(said ? [said] : lines).map((t) => `<p class="lead inset">${escapeHTML(t)}</p>`).join("")}${close}`,
    )
    .replace(
      /(<div[^>]*data-ink[^>]*>)[\s\S]*?(<\/div>)/,
      (_, open, close) =>
        `${open}${inkLines(hex, lines)
          .map((t) => `<p class="lead inset">${escapeHTML(t)}</p>`)
          .join("")}${close}`,
    )
    .replace(
      "</body>",
      () =>
        `<script type="application/json" id="color-data">${scriptJSON({ name, hex, slug, description: said || null, fetched: copy?.fetched || null, looked, list: art === true || art?.length ? listURL(slug) : null, adopted: adopted[slug], pixel: pixelOf(slug, name) })}</script>\n  </body>`,
    );
  // the sections the page will fill are there from the start; the ones known to stay empty aren't
  const meaning = meaningHTML(looked);
  const pictures = looked?.entries?.some((e) => e.image) || looked?.images?.length || looked?.pictures?.length;
  if (!meaning) html = html.replace(/(<section[^>]*data-meaning-slide)([^>]*?)(\s*>)/, "$1$2 hidden$3");
  if (!pictures && !(art === true || art?.length))
    html = html.replace(/(<section[^>]*data-art-slide)([^>]*?)(\s*>)/, "$1$2 hidden$3");
  if (meaning) {
    html = html
      .replace('slide--dense is-filling" id="meaning"', 'slide--dense" id="meaning"')
      .replace(
        /(<h2[^>]*data-meaning-title[^>]*>)[\s\S]*?(<\/h2>)/,
        (_, open, close) => `${open}${escapeHTML(name)}${close}`,
      )
      .replace(/(<div[^>]*data-wiki[^>]*>)[\s\S]*?(<\/div>)/, (_, open, close) => `${open}${meaning}${close}`);
  }

  // art only in the data: as HTML too it would push the site over Pages' 1 GB
  html = html
    .replace(/(<h2[^>]*data-fill-hex[^>]*>)(<\/h2>)/, (_, open, close) => `${open}${hex}${close}`)
    .replace(
      /(<div[^>]*data-neighbors[^>]*>)[\s\S]*?(<\/div>)/,
      (_, open, close) =>
        `${open}${neighborsOf(i)
          .map((it) => `<a class="neighbor" href="../${slugs.get(it.name)}/">${escapeHTML(it.name)}, ${it.hex}</a>`)
          .join("")}${close}`,
    );

  mkdirSync(join(DIST, "color", slug), { recursive: true });
  writeFileSync(join(DIST, "color", slug, "index.html"), html);

  const bare = hex.replace("#", "");
  mkdirSync(join(DIST, "color", bare), { recursive: true });
  writeFileSync(
    join(DIST, "color", bare, "index.html"),
    `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>${escapeHTML(name)} — Color Names</title>
<link rel="canonical" href="${url}" />
<meta name="robots" content="noindex" />
${preview.join("\n")}
<meta http-equiv="refresh" content="0; url=../${slug}/" />
<script>location.replace("../${slug}/" + location.hash)</script>
<a href="../${slug}/">${escapeHTML(name)}</a>
</html>
`,
  );

  if (art === true) withArt++;
  else if (!art?.length) picks[hex] = "";
  else {
    withArt++;
    const body = art;
    picks[hex] = createHash("sha1").update(body).digest("hex");
    if (LOCAL) {
      mkdirSync(join(DIST, "lists"), { recursive: true });
      writeFileSync(join(DIST, "lists", `${slug}.json`), body);
    } else {
      const sum = picks[hex];
      if (!existsSync(spooled(hex))) writeFileSync(spooled(hex), body);
      if (listed[slug] !== sum) toUpload.push({ slug, hex, sum });
    }
  }
  sitemap.push(`<url><loc>${url}</loc>${copy?.fetched ? `<lastmod>${copy.fetched}</lastmod>` : ""}</url>`);
  dataset.push(datasetLine({ name, hex, url, said, looked: copy?.looked, pixel: pixelOf(slug, name) }));
  written++;
}

writeFileSync(join(DIST, DATASET), dataset.join("\n") + "\n");
writeFileSync(
  join(DIST, CONTEXT),
  JSON.stringify(
    {
      "@context": {
        "@vocab": `${SITE}${CONTEXT}#`,
        schema: "https://schema.org/",
        name: "schema:name",
        description: "schema:description",
        hex: "schema:color",
        title: "schema:name",
        term: "schema:name",
        meaning: "schema:about",
        definitions: "schema:subjectOf",
        wikipedia: { "@id": "schema:sameAs", "@type": "@id" },
        wiktionary: { "@id": "schema:sameAs", "@type": "@id" },
        wikidata: { "@id": "schema:sameAs", "@type": "@id" },
      },
    },
    null,
    2,
  ),
);
// any address that isn't there: the not-found page, with paths from the site's root; a
// /color/<hex> goes on to that color first, and a name written another way ("The New
// Black", the_new_black) on to its slug, as names.js makes them
const ROOT = new URL(SITE).pathname;
writeFileSync(
  join(DIST, "404.html"),
  withCount(readFileSync(join(DIST, "not-found/index.html"), "utf8"))
    .replace(/"\.\.\//g, `"${ROOT}`)
    .replace('data-root="../"', `data-root="${ROOT}"`)
    .replace(
      "<head>",
      `<head>
    <script>
      (() => {
        const path = location.pathname;
        const m = path.match(/^(.*\\/)color\\/#?([0-9a-f]{3}|[0-9a-f]{6})\\/?$/i);
        if (m) return location.replace(m[1] + "color/#" + m[2].toLowerCase());
        const n = path.match(/^(.*\\/)color\\/([^/]+)\\/?$/);
        if (!n) return;
        let asked = n[2];
        try {
          asked = decodeURIComponent(asked);
        } catch {}
        const slug = asked
          .normalize("NFKD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .toLowerCase()
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        if (slug && slug !== n[2]) location.replace(n[1] + "color/" + slug + "/" + location.hash);
      })();
    </script>`,
    ),
);

writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join("\n")}\n</urlset>\n`,
);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

const { UPLOAD_URL, UPLOAD_KEY } = process.env;
let uploaded = 0;
if (UPLOAD_URL && UPLOAD_KEY && toUpload.length) {
  // each one mostly waits on the worker's answer: many at once, and where it is every tenth
  const sending = Date.now();
  const total = toUpload.length;
  const step = Math.ceil(total / 10);
  let next = step;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      while (toUpload.length) {
        const { slug, hex, sum } = toUpload.pop();
        const body = readFileSync(spooled(hex));
        if (total - toUpload.length >= next) {
          const done = total - toUpload.length;
          const spent = Date.now() - sending;
          console.log(
            `pages.mjs: ${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} art lists sent, ${minutes(spent)}, about ${minutes((spent / done) * (total - done))} left`,
          );
          next += step;
        }
        for (let attempt = 1; attempt <= 4; attempt++) {
          const res = await fetch(`${UPLOAD_URL}/lists/${slug}.json`, {
            method: "PUT",
            headers: { authorization: `Bearer ${UPLOAD_KEY}`, "content-type": "application/json" },
            body,
          }).catch(() => null);
          if (res?.ok) {
            listed[slug] = sum;
            uploaded++;
            break;
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }),
  );
  mkdirSync(LISTS, { recursive: true });
  writeFileSync(join(LISTS, "uploaded.json"), JSON.stringify(listed));
}
if (!ONLY && picking) {
  mkdirSync(LISTS, { recursive: true });
  writeFileSync(PICKS, JSON.stringify({ print: ART_PRINT, byHex: picks }));
}
rmSync(SPOOL, { recursive: true, force: true });
// the adoptions with each color's name and hex, for the adopt and supporters pages
const bySlug = new Map(items.map(({ name, hex }) => [slugs.get(name), { name, hex }]));
writeFileSync(
  join(DIST, "adopted.json"),
  JSON.stringify(Object.fromEntries(Object.entries(adopted).map(([slug, a]) => [slug, { ...a, ...bySlug.get(slug) }]))),
);

// the adopt page's numbers as they are at build time, worded loosely when a source doesn't answer
const ADOPT_PAGE = join(DIST, "adopt", "index.html");
if (existsSync(ADOPT_PAGE)) {
  const json = (url) =>
    fetch(url, { headers: { "user-agent": "names.color.pizza build" } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const stars = (await json("https://api.github.com/repos/meodai/color-names"))?.stargazers_count;
  const npm = (await json("https://api.npmjs.org/downloads/point/last-year/color-name-list"))?.downloads;
  const millions = (n) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")} million` : n.toLocaleString("en-US");
  writeFileSync(
    ADOPT_PAGE,
    withCount(readFileSync(ADOPT_PAGE, "utf8"))
      .replaceAll("{{stars}}", stars ? stars.toLocaleString("en-US") : "Thousands of")
      .replaceAll("{{npmYear}}", npm ? millions(npm) : "Millions of"),
  );
}

// what scripts/standard-site.mjs publishes, kept out of the site
if (!ONLY) {
  mkdirSync(resolve(here, "../.cache"), { recursive: true });
  writeFileSync(resolve(here, "../.cache/standard-site.json"), JSON.stringify(documents));
}

console.log(
  `pages.mjs: ${written} color pages (${withCopy} with the nightly copy, ${withArt} with art, ${picked} picked anew, ${uploaded} art lists uploaded${toUpload.length ? `, ${toUpload.length} not` : ""}), ${written} hex forwards, sitemap`,
);
