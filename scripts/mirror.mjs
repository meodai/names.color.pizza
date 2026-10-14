// Copies of the Wikimedia pictures in the nightly data (Commons pictures and
// the pictures of Wikipedia articles) in the color-names bucket, served at
// media.color.pizza, with each file's author and license. The index,
// <data>/media.json, maps a file to its copy, so each is copied once.
//
//   UPLOAD_URL=… UPLOAD_KEY=… node scripts/mirror.mjs [--data .data] [--minutes 120] [--limit n]

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const DATA = resolve(here, "..", arg("data", ".data"));
const MINUTES = +arg("minutes", 120);
const LIMIT = +arg("limit", Infinity);
const INDEX = join(DATA, "media.json");
const { UPLOAD_URL, UPLOAD_KEY, WIKIMEDIA_TOKEN } = process.env;
const AGENT = `ColorNamesBot/1.0 (https://github.com/meodai/color-names) node/${process.versions.node}`;
const HEIGHT = 440; // a gallery row is at most 13rem, twice over for sharp screens
const BATCH = 50; // titles per API request
const started = Date.now();

if (!UPLOAD_URL || !UPLOAD_KEY) {
  console.log("mirror: no UPLOAD_URL / UPLOAD_KEY, nothing to do");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { "User-Agent": AGENT, ...(WIKIMEDIA_TOKEN ? { Authorization: `Bearer ${WIKIMEDIA_TOKEN}` } : {}) };

async function get(url, as = "json") {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers }).catch(() => null);
    if (res?.ok) return as === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
    if (res && res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    await sleep(Math.max(+res?.headers.get("retry-after") * 1000 || 0, 5000) * 2 ** attempt);
  }
  throw new Error(`gave up on ${url}`);
}

async function upload(key, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${UPLOAD_URL}/${key}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${UPLOAD_KEY}`, "content-type": "image/webp" },
      body,
    }).catch(() => null);
    if (res?.ok) return;
    if (attempt >= 4) throw new Error(`upload ${res?.status ?? "failed"} ${key}`);
    await sleep(3000 * attempt);
  }
}

// "File:Red_apple.jpg" from a file page's address, the way an API title is written
export const fileTitle = (link) =>
  decodeURIComponent(link.split("/wiki/")[1] || "")
    .replace(/_/g, " ")
    .replace(/^(File|Image):/i, "File:");
export const mediaKey = (title) => `wiki/${createHash("md5").update(title).digest("hex")}.webp`;

const plain = (html = "") =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};
function save() {
  writeFileSync(`${INDEX}.tmp`, JSON.stringify(index));
  renameSync(`${INDEX}.tmp`, INDEX);
}

// every file the data shows, by the wiki it lives on
const wanted = new Map();
const names = join(DATA, "names");
for (const shard of readdirSync(names)) {
  for (const file of readdirSync(join(names, shard))) {
    let looked;
    try {
      looked = JSON.parse(readFileSync(join(names, shard, file), "utf8")).looked;
    } catch {
      continue;
    }
    for (const p of [...(looked?.pictures || []), ...(looked?.images || [])]) {
      const title = fileTitle(p.link || "");
      if (!title.startsWith("File:") || index[title]) continue;
      wanted.set(title, p.link.includes("commons.wikimedia.org") ? "commons" : "en");
    }
  }
}
console.log(`mirror: ${Object.keys(index).length} copied before, ${wanted.size} to copy`);

// a file on Wikipedia is often Commons' own, shown through the article: ask Commons first
async function infos(titles, wiki) {
  const api = wiki === "commons" ? "https://commons.wikimedia.org/w/api.php" : "https://en.wikipedia.org/w/api.php";
  const url = new URL(api);
  Object.entries({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlheight: String(HEIGHT),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit",
    titles: titles.join("|"),
    maxlag: "5",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const body = await get(url.href);
  const byTitle = new Map();
  const normalized = new Map((body.query?.normalized || []).map((n) => [n.to, n.from]));
  for (const page of body.query?.pages || []) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    byTitle.set(normalized.get(page.title) || page.title, info);
  }
  return byTitle;
}

let copied = 0;
let failed = 0;
const queue = [...wanted].slice(0, LIMIT);
outer: while (queue.length) {
  if (Date.now() - started > MINUTES * 60_000) break;
  const batch = queue.splice(0, BATCH);
  const found = new Map();
  for (const wiki of ["commons", "en"]) {
    const ask = batch.map(([t]) => t).filter((t) => !found.has(t));
    if (!ask.length) break;
    try {
      for (const [t, info] of await infos(ask, wiki)) found.set(t, info);
    } catch (error) {
      console.log(`  ${error.message}`);
    }
    await sleep(1000);
  }
  // two downloads at a time (wikitech.wikimedia.org/wiki/Robot_policy)
  const todo = [...found];
  await Promise.all(
    [0, 1].map(async () => {
      while (todo.length) {
        if (Date.now() - started > MINUTES * 60_000) return;
        const [title, info] = todo.shift();
        try {
          const source = info.thumburl || info.url;
          const image = await sharp(await get(source, "buffer"))
            .resize({ height: HEIGHT, width: HEIGHT * 3, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 74 })
            .toBuffer({ resolveWithObject: true });
          const key = mediaKey(title);
          await upload(key, image.data);
          const meta = info.extmetadata || {};
          index[title] = {
            key,
            ratio: Math.round((image.info.width / image.info.height) * 1000) / 1000,
            artist: plain(meta.Artist?.value).slice(0, 200),
            license: plain(meta.LicenseShortName?.value),
            licenseUrl: meta.LicenseUrl?.value || "",
          };
          copied++;
        } catch (error) {
          failed++;
          console.log(`  ${title}: ${error.message}`);
        }
      }
    }),
  );
  if (copied && copied % 500 < BATCH) {
    save();
    console.log(`  ${copied} copied, ${failed} failed, ${queue.length} batches' worth left`);
  }
  if (failed > 200 && failed > copied) {
    console.log("mirror: mostly failing, stopping");
    break outer;
  }
}
save();
console.log(`mirror: ${copied} copied, ${failed} failed, ${queue.length} left for later`);
