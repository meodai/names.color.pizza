/*
  Art index — the Harvard Art Museums' works that may be shown at any size
  (imagepermissionlevel 0) and have colors, read from the museums' API into
  a small index the build picks each name's works from (src/art.js):

    <data>/art/works.json.gz [[id, title, artist, date, urn, ratio, colors]] (see src/art.js)
    <data>/art/source.json   { built }

  By the museums' API terms: nothing is kept longer than two weeks (this
  runs weekly; the build won't use an index older than that), at most 2500
  calls a day (a full read is far less), non-commercial use, images shown
  from the address the API gives, and every work linked back to its page.
  The key is HARVARD_API_KEY (or in website/.env.local).

    node scripts/art.mjs [--data .data] [--force]
*/

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packWork } from "../src/art.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const DATA = resolve(here, "..", arg("data", ".data"));
const FORCE = process.argv.includes("--force");
const EVERY_DAYS = 7;
const CALLS = 2000; // a day, at most: under the museums' 2500
const AGENT = `ColorNamesBot/1.0 (https://github.com/meodai/color-names) node/${process.versions.node}`;

const local = resolve(here, "../.env.local");
const KEY =
  process.env.HARVARD_API_KEY ||
  (existsSync(local) && readFileSync(local, "utf8").match(/^HARVARD_API_KEY=(.+)$/m)?.[1].trim()) ||
  "";
if (!KEY) {
  console.log("art.mjs: no HARVARD_API_KEY; the index stays as it is");
  process.exit(0);
}

const dir = join(DATA, "art");
const sourceFile = join(dir, "source.json");
const source = existsSync(sourceFile) ? JSON.parse(readFileSync(sourceFile, "utf8")) : null;
const age = source ? (Date.now() - Date.parse(source.built)) / 86_400_000 : Infinity;
if (!FORCE && age < EVERY_DAYS) {
  console.log(`art.mjs: the index is from ${source.built.slice(0, 10)}; nothing to do`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

// one page of works after the given id, in id order (paging by id rather
// than by page number, which stops at 10,000 results)
async function after(id) {
  const url = new URL("https://api.harvardartmuseums.org/object");
  Object.entries({
    apikey: KEY,
    q: `imagepermissionlevel:0 AND colorcount:>0 AND id:>${id}`,
    hasimage: "1",
    sort: "id",
    sortorder: "asc",
    size: "100",
    fields: "id,title,people,dated,url,primaryimageurl,images,colors",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  for (let attempt = 0; attempt < 4; attempt++) {
    calls++;
    const res = await fetch(url, { headers: { "User-Agent": AGENT } });
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error("the key isn't accepted (401)");
    await sleep(5000 * 2 ** attempt);
  }
  throw new Error("the API keeps failing");
}

const works = [];
let last = 0;
let total = null;
for (;;) {
  if (calls >= CALLS) throw new Error(`stopped at ${CALLS} calls, under the daily limit; ${works.length} works read`);
  const page = await after(last);
  total ??= page.info?.totalrecords;
  const records = page.records || [];
  if (!records.length) break;
  for (const r of records) {
    last = Math.max(last, r.id);
    const work = packWork(r);
    if (work) works.push(work);
  }
  if (calls % 50 === 0) console.log(`  ${works.length} works of ${total} after ${calls} calls`);
  await sleep(1000); // one call a second
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "works.json.gz"), gzipSync(JSON.stringify(works), { level: 9 }));
rmSync(join(dir, "works.json"), { force: true });
writeFileSync(sourceFile, JSON.stringify({ built: new Date().toISOString(), from: "Harvard Art Museums API" }));
console.log(`art.mjs: ${works.length} works, in ${calls} calls`);
