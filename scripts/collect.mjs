// node scripts/collect.mjs [--data .data] [--list color-names/src/colornames.csv]
//   [--minutes 330] [--rate N] [--parallel N] [--all] [--limit N] [--with-pictures | --pictures]

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import sharp from "sharp";
import ColorDescription from "color-description";
import { configure, lookupName, lookupPictures, SAMPLE } from "../src/lookup.js";
import { slugsOf } from "../src/names.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const DATA = resolve(here, "..", arg("data", ".data"));
const LIST = resolve(here, "..", arg("list", "color-names/src/colornames.csv"));
const MINUTES = +arg("minutes", 330);
const local = resolve(here, "../.env.local");
const TOKEN =
  process.env.WIKIMEDIA_TOKEN ||
  (existsSync(local) &&
    readFileSync(local, "utf8")
      .match(/^WIKIMEDIA_TOKEN=(.+)$/m)?.[1]
      .trim()) ||
  "";
// anonymous limit: 200/min, 3 in flight (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)
let rate = +arg("rate", 3); // per second
const PARALLEL = Math.min(3, +arg("parallel", 3));
const WORKERS = PARALLEL;
const ALL = process.argv.includes("--all");
const PICTURES_ONLY = process.argv.includes("--pictures");
const WITH_PICTURES = PICTURES_ONLY || process.argv.includes("--with-pictures");
const LIMIT = +arg("limit", Infinity);
const CYCLE_DAYS = 180;
const AGENT = `ColorNamesBot/1.0 (https://github.com/meodai/color-names) node/${process.versions.node}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 1000 / rate;
  if (at > now) await sleep(at - now);
}

let inFlight = 0;
const waiting = [];
async function take() {
  while (inFlight >= PARALLEL) await new Promise((r) => waiting.push(r));
  inFlight++;
}
function release() {
  inFlight--;
  waiting.shift()?.();
}

const START = rate;
let calm = Date.now();
function slowDown() {
  rate = Math.max(1, rate / 2);
  calm = Date.now();
}
setInterval(() => {
  if (Date.now() - calm > 60_000 && rate < START) {
    rate = Math.min(START, rate * 1.25);
    calm = Date.now();
  }
}, 10_000).unref();

// Wikimedia tells clients apart by their cookies
const cookies = new Map(); // host → { name: value }
const cookieHeader = (host) =>
  Object.entries(cookies.get(host) || {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
function keepCookies(host, res) {
  for (const line of res.headers.getSetCookie?.() || []) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    if (at < 1) continue;
    if (!cookies.has(host)) cookies.set(host, {});
    cookies.get(host)[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
}

function headersFor(url) {
  const headers = { "User-Agent": AGENT, "Accept-Encoding": "gzip" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const jar = cookieHeader(new URL(url).host);
  if (jar) headers.Cookie = jar;
  return headers;
}

const withMaxlag = (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/api.php")) u.searchParams.set("maxlag", "5");
  return u.href;
};

// a maxlag refusal is an error inside a 200 response
async function lagged(res) {
  if (!res.ok || !res.url.includes("/api.php")) return 0;
  try {
    const body = await res.clone().json();
    return body?.error?.code === "maxlag" ? +res.headers.get("retry-after") || 5 : 0;
  } catch {
    return 0;
  }
}

let told = 0;
const toldBy = {};

// to know whether all of a name's requests went through
const forName = new AsyncLocalStorage();

async function politeFetch(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    await take();
    try {
      const res = await fetch(withMaxlag(url), { ...options, headers: headersFor(url) }).finally(release);
      keepCookies(new URL(url).host, res);
      const lag = await lagged(res);
      if (lag && attempt < 6) {
        next = Math.max(next, Date.now() + lag * 1000 * 2 ** Math.min(attempt, 3));
        continue;
      }
      // a 429 or 5xx delays every request, not just this one
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) {
          told++;
          slowDown();
          const kind = `${new URL(url).host}${new URL(url).pathname.split("/").slice(0, 5).join("/")}`;
          toldBy[kind] = (toldBy[kind] || 0) + 1;
        }
        if (attempt < 4) {
          const wait = Math.max(+res.headers.get("retry-after") * 1000 || 0, 5000) * 2 ** attempt;
          next = Math.max(next, Date.now() + wait);
          continue;
        }
        // some pages' media lists always 500 (Jazz, The Rite of Spring)
        if (!(res.status === 500 && url.includes("/page/media-list/")))
          forName.getStore()?.failed.push(`${res.status} ${url}`);
      }
      return res;
    } catch (e) {
      if (attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      forName.getStore()?.failed.push(`${e.message} ${url}`);
      throw e;
    }
  }
}

// at most 2 image downloads at a time (wikitech.wikimedia.org/wiki/Robot_policy)
let mediaInFlight = 0;
const mediaWaiting = [];
async function pixels(url) {
  while (mediaInFlight >= 2) await new Promise((r) => mediaWaiting.push(r));
  mediaInFlight++;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { headers: headersFor(url) }).catch(() => null);
      if (res?.status === 429 || (res && res.status >= 500) || !res) {
        await sleep(Math.max(+res?.headers.get("retry-after") * 1000 || 0, 5000) * 2 ** attempt);
        continue;
      }
      if (!res.ok) return null;
      const { data } = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(SAMPLE, SAMPLE, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return new Uint8ClampedArray(data);
    }
    forName.getStore()?.failed.push(`picture ${url}`);
    return null;
  } catch {
    return null;
  } finally {
    mediaInFlight--;
    mediaWaiting.shift()?.();
  }
}

configure({
  fetch: politeFetch,
  pixels,
  parallelPictures: 2,
  parse: (html) => parseHTML(html.includes("<html") ? html : `<html><body>${html}</body></html>`).document,
});

const items = readFileSync(LIST, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, hex] = line.split(",");
    return { name, hex };
  });
const slugs = slugsOf(items);
const fileOf = (slug) => join(DATA, "names", slug[0], `${slug}.json`);

const fetched = new Map();
const pictured = new Set();
const dir = join(DATA, "names");
mkdirSync(dir, { recursive: true });
for (const shard of readdirSync(dir)) {
  for (const file of readdirSync(join(dir, shard))) {
    const slug = file.replace(/\.json$/, "");
    try {
      const copy = JSON.parse(readFileSync(join(dir, shard, file), "utf8"));
      fetched.set(slug, copy.fetched);
      if (copy.looked?.pictures) pictured.add(slug);
    } catch {
      fetched.set(slug, "0000-00-00");
    }
  }
}

const wanted = new Set(slugs.values());
let removed = 0;
for (const slug of fetched.keys()) {
  if (!wanted.has(slug)) {
    rmSync(fileOf(slug), { force: true });
    fetched.delete(slug);
    removed++;
  }
}

const missing = items.filter((it) => !fetched.has(slugs.get(it.name)));
const renew = Math.ceil(items.length / CYCLE_DAYS);
// skips copies fetched earlier the same day, between passes of a first fill
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const oldest = items
  .filter((it) => fetched.has(slugs.get(it.name)) && fetched.get(slugs.get(it.name)) < weekAgo)
  .sort((a, b) => (fetched.get(slugs.get(a.name)) < fetched.get(slugs.get(b.name)) ? -1 : 1))
  .slice(0, renew);
const todo = (
  PICTURES_ONLY
    ? // copies without their pictures yet
      items.filter((it) => fetched.has(slugs.get(it.name)) && !pictured.has(slugs.get(it.name)))
    : [...(ALL ? missing : missing.slice(0, Math.max(renew, 500))), ...oldest]
).slice(0, LIMIT);

if (TOKEN) {
  const me = await politeFetch(
    "https://en.wikipedia.org/w/api.php?action=query&meta=userinfo&uiprop=ratelimits|groups&format=json",
  )
    .then((r) => r.json())
    .catch(() => null);
  const info = me?.query?.userinfo;
  if (!info || info.anon !== undefined) {
    console.error("collect: Wikimedia doesn't accept the token (not logged in); check WIKIMEDIA_TOKEN");
    process.exit(1);
  }
  console.log(`collect: logged in as ${info.name} (${(info.groups || []).join(", ")})`);
} else {
  console.log("collect: without a login (no WIKIMEDIA_TOKEN): 200 requests a minute");
}
if (PICTURES_ONLY) console.log("collect: pictures only, for copies without them");
console.log(
  `collect: ${items.length} names, ${fetched.size} copies, ${missing.length} missing, ` +
    `${removed} removed; this run: ${todo.length} (${Math.min(missing.length, todo.length)} new)`,
);

const today = new Date().toISOString().slice(0, 10);
const until = Date.now() + MINUTES * 60_000;
let done = 0;
let saved = 0;
const failures = [];
const started = Date.now();

const pictureTerms = (it) => [it.name, new ColorDescription(it.hex).nouns[0]];

async function collect(it) {
  const slug = slugs.get(it.name);
  const state = { failed: [] };
  const previous = fetched.has(slug) ? JSON.parse(readFileSync(fileOf(slug), "utf8")) : null;
  const copy = await forName
    .run(state, async () => {
      const looked = PICTURES_ONLY ? previous.looked : await lookupName(it.name);
      if (WITH_PICTURES) looked.pictures = await lookupPictures(it.hex, pictureTerms(it));
      // renewing keeps the pictures it had
      else if (previous?.looked?.pictures) looked.pictures = previous.looked.pictures;
      return { name: it.name, hex: it.hex, fetched: PICTURES_ONLY ? previous.fetched : today, looked };
    })
    .catch((e) => {
      state.failed.push(e.message);
      return null;
    });
  done++;
  if (!copy || state.failed.length) {
    failures.push(`${it.name}: ${state.failed[0]}`);
    return;
  }
  mkdirSync(dirname(fileOf(slug)), { recursive: true });
  writeFileSync(fileOf(slug), JSON.stringify(copy));
  saved++;
}

const queue = todo.slice();
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (queue.length && Date.now() < until) {
      await collect(queue.shift());
      if (done % 100 === 0) {
        const perMin = done / ((Date.now() - started) / 60_000);
        console.log(
          `  ${done}/${todo.length}, ${saved} saved, ${failures.length} failed, ${perMin.toFixed(0)} names/min, ` +
            `${rate.toFixed(1)} requests/s, told to wait ${told}×`,
        );
      }
    }
  }),
);

if (told) console.log("told to wait by:", JSON.stringify(toldBy));
console.log(`collect: ${saved} saved, ${failures.length} not (kept as they were), ${queue.length} left for later`);
if (failures.length)
  console.log(
    failures
      .slice(0, 10)
      .map((f) => `  ${f}`)
      .join("\n"),
  );
// nearly everything failing is an outage
if (todo.length && failures.length > todo.length / 2) process.exit(1);
if (!existsSync(join(DATA, "README.md"))) {
  writeFileSync(
    join(DATA, "README.md"),
    "What Wikipedia and Wiktionary say about each color name, copied nightly by\n" +
      "website/scripts/collect.mjs on the project-website branch. Read by the site's build.\n",
  );
}
