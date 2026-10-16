// A page per name (color/<slug>/), hex forwards (color/<hex>/), 404.html,
// sitemap.xml and robots.txt, after the build.
//
//   node scripts/pages.mjs [--data .data] [--descriptions .descriptions] [--site https://names.color.pizza/]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ColorDescription from "color-description";
import { slugsOf, hexToRgb, rgbToOklab, tidySenses } from "../src/names.js";
import { bucketed, pickArt, unpackWork, MUSEUMS, MEDIA } from "../src/art.js";
import { cardKey, cardURL } from "./cards.mjs";
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
async function collection(name) {
  const local = process.env.ART_DATA && join(process.env.ART_DATA, `${name}.json`);
  let text = "[]";
  if (local && existsSync(local)) text = readFileSync(local, "utf8");
  else {
    const res = await fetch(`${MEDIA}/data/${name}.json?t=${Date.now()}`).catch(() => null);
    if (res?.ok) text = await res.text();
  }
  artPrint.update(name).update(text);
  return JSON.parse(text);
}
const works = [];
for (const museum of Object.keys(MUSEUMS)) {
  for (const w of await collection(museum)) {
    const work = unpackWork(w, museum);
    if (work) works.push(work);
  }
}
const wikimedia = new Map((await collection("wikimedia-art")).filter((w) => w.thumb).map((w) => [w.accession, w]));
if (!works.length) console.log("pages.mjs: no art data; no page has art");
const near = works.length ? bucketed(works) : null;
const artFor = (hex) => (near ? pickArt(near, hex) : null);
const ART_PRINT = artPrint.digest("hex");

const template = readFileSync(join(DIST, "color/index.html"), "utf8").replace(/"\.\.\//g, '"../../');

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

// TEMPORARY until wikimedia-art has a copy of every picture: Commons pictures
// without one load from Commons, with no palette or credit
const commons = (src = "") => /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(src);

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
      return w ? { ...e, image: `${MEDIA}/${w.thumb}` } : commons(image) ? { ...e, image } : e;
    }),
    pictures: (looked.pictures || []).flatMap((p) => {
      const w = copy(p);
      return w
        ? [{ ...p, image: `${MEDIA}/${w.thumb}`, ratio: w.width / w.height, credit: credit(w), palette: paletteOf(w) }]
        : commons(p.image)
          ? [p]
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
          : commons(img.src) && img.link
            ? [{ ...img, srcset: "" }]
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
      (d) => `<article class="wiki-index__row"><h3><span>${escapeHTML(d.term)}</span></h3>
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
      return `<article class="wiki-index__row"><h3><span>${escapeHTML(e.title)}</span></h3>
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
// a color's link preview comes through the worker: its adopted card once there is one
const previewOf = (slug, it) => `https://color-names-upload.cloudflare-54bbeb.workers.dev/og/${slug}.png?k=${cardKey(it)}`;
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
// what each color's art list came to (its fingerprint, "" for none), as long as the
// art and the code that picks it stay the same: a color known here needn't be picked again
const PICKS = join(LISTS, "picks.json");
const cached = existsSync(PICKS) ? JSON.parse(readFileSync(PICKS, "utf8")) : null;
const picks = cached?.print === ART_PRINT ? cached.byHex : {};
let picked = 0;
const sitemap = [`<url><loc>${SITE}</loc></url>`];

// ONLY=slug,slug: just those pages, for a quick local preview
const ONLY = process.env.ONLY && new Set(process.env.ONLY.split(","));

for (const [i, { name, hex }] of items.entries()) {
  const slug = slugs.get(name);
  if (ONLY && !ONLY.has(slug)) continue;
  const copy = copyOf(slug);
  if (copy) withCopy++;
  const looked = hosted(copy?.looked || null);
  // picked before and its list already up (or, locally, already written): known
  const known = picks[hex];
  const ready = known !== undefined && (!known || (LOCAL ? existsSync(join(DIST, "lists", `${slug}.json`)) : listed[slug] === known));
  const art = ready ? (known ? true : null) : artFor(hex);
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
    meta("name", "theme-color", hex),
    `<script type="application/ld+json">${scriptJSON(structured({ name, hex, url, description, lines }))}</script>`,
  ].join("\n    ");

  // replacement functions throughout: "$'" or "$`" in a name would be a pattern
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/\s*<meta\s+(?:property|name)="(?:og|twitter):[^>]*>/g, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, () => head)
    .replace(/(<h1[^>]*data-name[^>]*>)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${escapeHTML(name)}${close}`)
    .replace(
      /(<div[^>]*data-intro[^>]*>)[\s\S]*?(<\/div>)/,
      (_, open, close) =>
        `${open}${(said ? [said] : lines).map((t) => `<p class="lead">${escapeHTML(t)}</p>`).join("")}${close}`,
    )
    .replace(
      /(<div[^>]*data-ink[^>]*>)[\s\S]*?(<\/div>)/,
      (_, open, close) =>
        `${open}${inkLines(hex, lines)
          .map((t) => `<p class="lead">${escapeHTML(t)}</p>`)
          .join("")}${close}`,
    )
    .replace(
      "</body>",
      () =>
        `<script type="application/json" id="color-data">${scriptJSON({ name, hex, slug, description: said || null, fetched: copy?.fetched || null, looked, list: art === true || art?.length ? listURL(slug) : null, adopted: adopted[slug] })}</script>\n  </body>`,
    );
  const meaning = meaningHTML(looked);
  if (meaning) {
    html = html
      .replace(/(<section[^>]*data-meaning-slide)([^>]*?)\s+hidden(\s*>)/, "$1$2$3")
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
    const body = JSON.stringify(art);
    picks[hex] = createHash("sha1").update(body).digest("hex");
    if (LOCAL) {
      mkdirSync(join(DIST, "lists"), { recursive: true });
      writeFileSync(join(DIST, "lists", `${slug}.json`), body);
    } else {
      const sum = picks[hex];
      if (listed[slug] !== sum) toUpload.push({ slug, body, sum });
    }
  }
  sitemap.push(`<url><loc>${url}</loc>${copy?.fetched ? `<lastmod>${copy.fetched}</lastmod>` : ""}</url>`);
  written++;
}

writeFileSync(
  join(DIST, "404.html"),
  `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Color Names</title>
<meta name="robots" content="noindex" />
${[
  meta("property", "og:type", "website"),
  meta("property", "og:title", "Color Names"),
  meta("property", "og:description", "31,935 colors, each named by a person: wander through them, hanging where their color is."),
  meta("property", "og:site_name", "Color Names"),
  meta("property", "og:image", `${SITE}og.jpg`),
  meta("property", "og:image:width", "1200"),
  meta("property", "og:image:height", "630"),
  meta("name", "twitter:card", "summary_large_image"),
].join("\n")}
<script>
  (() => {
    const m = location.pathname.match(/^(.*\\/)color\\/#?([0-9a-f]{3}|[0-9a-f]{6})\\/?$/i);
    if (m) location.replace(m[1] + "color/#" + m[2].toLowerCase());
    else {
      const root = location.pathname.match(/^(.*?\\/)color\\//);
      location.replace(root ? root[1] : "${new URL(SITE).pathname}");
    }
  })();
</script>
<p><a href="${SITE}">Color Names</a></p>
</html>
`,
);

writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join("\n")}\n</urlset>\n`,
);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

const { UPLOAD_URL, UPLOAD_KEY } = process.env;
let uploaded = 0;
if (UPLOAD_URL && UPLOAD_KEY && toUpload.length) {
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (toUpload.length) {
        const { slug, body, sum } = toUpload.pop();
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
if (!ONLY && works.length) {
  mkdirSync(LISTS, { recursive: true });
  writeFileSync(PICKS, JSON.stringify({ print: ART_PRINT, byHex: picks }));
}
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
  const millions = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")} million` : n.toLocaleString("en-US"));
  writeFileSync(
    ADOPT_PAGE,
    readFileSync(ADOPT_PAGE, "utf8")
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
