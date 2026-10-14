// A page per name (color/<slug>/), hex forwards (color/<hex>/), 404.html,
// sitemap.xml and robots.txt, after the build.
//
//   node scripts/pages.mjs [--data .data] [--descriptions .descriptions] [--site https://names.color.pizza/]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ColorDescription from "color-description";
import { slugsOf, hexToRgb, rgbToOklab, tidySenses } from "../src/names.js";
import { bucketed, pickArt, unpackWork, MUSEUMS, MEDIA } from "../src/art.js";
import { cardURL } from "./cards.mjs";

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
async function collection(name) {
  try {
    const res = await fetch(`${MEDIA}/data/${name}.json`);
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
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

const fileLink = (src = "") => {
  const m = src.match(/upload\.wikimedia\.org\/wikipedia\/(commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/);
  return m ? `https://${m[1] === "commons" ? "commons.wikimedia.org" : "en.wikipedia.org"}/wiki/File:${m[2]}` : "";
};

// the pictures that have a copy, pointing at it; an article's lead picture joins the rest
function hosted(looked) {
  if (!looked) return looked;
  const copy = (p) => wikimedia.get(fileTitle(p.link));
  const leads = (looked.entries || []).filter((e) => e.image).map((e) => ({ link: fileLink(e.image), alt: e.title }));
  return {
    ...looked,
    entries: (looked.entries || []).map(({ image, ...e }) => e),
    pictures: (looked.pictures || []).flatMap((p) => {
      const w = copy(p);
      return w ? [{ ...p, image: `${MEDIA}/${w.thumb}`, ratio: w.width / w.height, credit: credit(w) }] : [];
    }),
    images: [...leads, ...(looked.images || [])].flatMap((img) => {
      const w = copy(img);
      return w
        ? [{ ...img, src: `${MEDIA}/${w.thumb}`, srcset: "", ratio: w.width / w.height, credit: credit(w) }]
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
let withArt = 0;
let withCopy = 0;
const sitemap = [`<url><loc>${SITE}</loc></url>`];

for (const [i, { name, hex }] of items.entries()) {
  const slug = slugs.get(name);
  const copy = copyOf(slug);
  if (copy) withCopy++;
  const looked = hosted(copy?.looked || null);
  const art = artFor(hex);
  const url = `${SITE}color/${slug}/`;
  const lines = intro(name, hex);
  const said = described.get(name) || "";
  const about = summary(looked);
  const description = clip([said || lines.join(" "), about].filter(Boolean).join(" "), 158);
  const title = `${name}: ${hex} — Color Names`;

  const head = [
    `<title>${escapeHTML(title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${url}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:title", `${name} (${hex})`),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    meta("property", "og:site_name", "Color Names"),
    meta("property", "og:image", `${cardURL({ name, hex })}`),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", `${name}, ${hex}: a swatch of the color`),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "theme-color", hex),
    `<script type="application/ld+json">${scriptJSON(structured({ name, hex, url, description, lines }))}</script>`,
  ].join("\n    ");

  // replacement functions throughout: "$'" or "$`" in a name would be a pattern
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, "")
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
        `<script type="application/json" id="color-data">${scriptJSON({ name, hex, slug, description: said || null, fetched: copy?.fetched || null, looked, art })}</script>\n  </body>`,
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
<meta http-equiv="refresh" content="0; url=../${slug}/" />
<script>location.replace("../${slug}/" + location.hash)</script>
<a href="../${slug}/">${escapeHTML(name)}</a>
</html>
`,
  );

  if (art?.length) withArt++;
  sitemap.push(`<url><loc>${url}</loc>${copy?.fetched ? `<lastmod>${copy.fetched}</lastmod>` : ""}</url>`);
  written++;
}

writeFileSync(
  join(DIST, "404.html"),
  `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Not found — Color Names</title>
<meta name="robots" content="noindex" />
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

console.log(
  `pages.mjs: ${written} color pages (${withCopy} with the nightly copy, ${withArt} with art), ${written} hex forwards, sitemap`,
);
