/*
  Pages — after the build, a page of its own for every name on the list,
  for search engines and for sharing:

    color/<slug>/      the color page, with the name, its description and
                       what Wikipedia and Wiktionary say about it written
                       into the HTML, and the nightly copy of that (see
                       scripts/collect.mjs) for the page's script to use
    color/<hex>/       forwards to its name's page (color/dd2233/ →
                       color/red-handed/)
    404.html           any other color/<hex>/ (a hex nobody named yet, or
                       written in capitals) → color/#<hex>
    sitemap.xml, robots.txt

  The copy is read from .data (the website-data branch); a name without
  one still gets its page, and the page asks Wikipedia itself.

    node scripts/pages.mjs [--data .data] [--site https://meodai.github.io/color-names/]
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ColorDescription from "color-description";
import { slugsOf } from "../src/names.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const DIST = resolve(here, "../dist");
const DATA = resolve(here, "..", arg("data", ".data"));
const LIST = resolve(here, "../../src/colornames.csv");
const SITE = (process.env.SITE_URL || arg("site", "https://meodai.github.io/color-names/")).replace(/\/?$/, "/");

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

const copyOf = (slug) => {
  const file = join(DATA, "names", slug[0], `${slug}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// the color page as built, one folder further down
const template = readFileSync(join(DIST, "color/index.html"), "utf8").replace(/"\.\.\//g, '"../../');

// the two lines the page opens with, as the page writes them (detail.js)
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

// the opening of the first article, for the description under a search result
function summary(looked) {
  const text = looked?.entries?.[0]?.blocks?.find((b) => b.text)?.text;
  return text ? text.replace(/\s+/g, " ").trim() : "";
}

const clip = (text, length) =>
  text.length <= length ? text : `${text.slice(0, length - 1).replace(/\s+\S*$/, "")}…`;

// what Wikipedia and Wiktionary say, as plain markup: the page's script
// sets it properly; this is for whoever reads the page without it
function meaningHTML(looked) {
  const words = (looked?.definitions || [])
    .map(
      (d) => `<article class="wiki-index__row"><h3><span>${escapeHTML(d.term)}</span></h3>
        ${d.parts
          .map(
            (p) =>
              `<p class="label">${escapeHTML(p.part)}</p><ol>${p.definitions.map((t) => `<li>${escapeHTML(t)}</li>`).join("")}</ol>`
          )
          .join("")}
        <a href="${escapeHTML(d.link)}">Wiktionary</a></article>`
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

const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHTML(value)}" />`;

let written = 0;
let withCopy = 0;
const sitemap = [`<url><loc>${SITE}</loc></url>`];

for (const { name, hex } of items) {
  const slug = slugs.get(name);
  const copy = copyOf(slug);
  if (copy) withCopy++;
  const looked = copy?.looked || null;
  const url = `${SITE}color/${slug}/`;
  const lines = intro(name, hex);
  const about = summary(looked);
  const description = clip([lines.join(" "), about].filter(Boolean).join(" "), 158);
  const title = `${name}: ${hex} — Color Names`;

  const head = [
    `<title>${escapeHTML(title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${url}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:title", `${name} (${hex})`),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    meta("name", "theme-color", hex),
  ].join("\n    ");

  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, head)
    .replace(/(<h1[^>]*data-name[^>]*>)[\s\S]*?(<\/h1>)/, `$1${escapeHTML(name)}$2`)
    .replace(
      /(<div[^>]*data-intro[^>]*>)[\s\S]*?(<\/div>)/,
      `$1${lines.map((t) => `<p class="lead">${escapeHTML(t)}</p>`).join("")}$2`
    )
    .replace(
      "</body>",
      `<script type="application/json" id="color-data">${scriptJSON({ name, hex, slug, fetched: copy?.fetched || null, looked })}</script>\n  </body>`
    );
  const meaning = meaningHTML(looked);
  if (meaning) {
    html = html
      .replace(/(<section[^>]*data-meaning-slide)([^>]*?)\s+hidden(\s*>)/, "$1$2$3")
      .replace(/(<h2[^>]*data-meaning-title[^>]*>)[\s\S]*?(<\/h2>)/, `$1${escapeHTML(name)}$2`)
      .replace(/(<div[^>]*data-wiki[^>]*>)[\s\S]*?(<\/div>)/, `$1${meaning}$2`);
  }

  mkdirSync(join(DIST, "color", slug), { recursive: true });
  writeFileSync(join(DIST, "color", slug, "index.html"), html);

  // the hex's own address, forwarding to the name's page
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
`
  );

  sitemap.push(`<url><loc>${url}</loc>${copy?.fetched ? `<lastmod>${copy.fetched}</lastmod>` : ""}</url>`);
  written++;
}

// any other color/<hex>/: to color/#<hex>, which shows any color at all
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
`
);

writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join("\n")}\n</urlset>\n`
);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

console.log(`pages.mjs: ${written} color pages (${withCopy} with the nightly copy), ${written} hex forwards, sitemap`);
