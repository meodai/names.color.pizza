/*
  Collect — keeps a copy of what Wikipedia and Wiktionary say about every
  name on the list, so the color pages can read it instead of asking them
  each time (and the build can write a page per name with it).

  One file per name, in the data branch's checkout:

    <data>/names/<first letter>/<slug>.json
      { name, hex, fetched: "2026-10-11", looked: { definitions, entries, images, sounds } }

  Each run: names without a copy first (new on the list), then the oldest
  copies, 1/180 of the list per run, so run nightly every copy is renewed
  about every six months, a few at a time rather than all at once. Copies
  of names no longer on the list are removed. Pictures are not copied, only
  their addresses.

  A name is only saved when every request for it went through: an outage
  or a refusal leaves its copy as it was, to be tried again next time.

    node scripts/collect.mjs [--data ../.data] [--list ../../src/colornames.csv]
      [--minutes 330] [--rate N] [--parallel N] [--all] [--limit N]

  --all fetches every name without a copy, however many (the first fill);
  --limit stops after N names.

  Pictures: which Wikimedia Commons pictures have the color in them, best
  first (looked.pictures: addresses and how much of each is the color, not
  the pictures). --with-pictures picks them along with the rest;
  --pictures only picks them, for copies that have none yet. Picking
  downloads each candidate's 60px thumbnail, at most 2 at a time, as
  Wikimedia's robot policy asks of its image servers.

  By Wikimedia's rules (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits,
  mediawiki.org/wiki/API:Etiquette, the Foundation's User-Agent policy):
  - a User-Agent naming this bot and where to reach its makers
  - no more than 3 requests at a time, at a pace under the limit: 200 a
    minute without a login; logged in, more (2000 for an established
    editor), so the pace starts higher and halves whenever told to wait
  - Retry-After honoured when told to wait, the wait growing each time
  - maxlag on the Action API, so it steps back when the servers are busy
  - cookies returned, one session for the whole run
  - what's fetched is kept: that's what this is for

  Logged in: an access token in WIKIMEDIA_TOKEN, or in website/.env.local
  as WIKIMEDIA_TOKEN=…: a personal ("owner-only") OAuth 2 consumer from
  meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2,
  with basic rights only. The account's limits are printed at the start.
*/

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
const LIST = resolve(here, "..", arg("list", "../src/colornames.csv"));
const MINUTES = +arg("minutes", 330);
// Wikimedia's limits for a client like this (no login, a User-Agent that
// says who it is): 200 requests a minute, no more than 3 at a time
// (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). Kept a little under.
// Logged in, more; how much depends on the account, so the pace finds it.
const local = resolve(here, "../.env.local");
const TOKEN =
  process.env.WIKIMEDIA_TOKEN ||
  (existsSync(local) && readFileSync(local, "utf8").match(/^WIKIMEDIA_TOKEN=(.+)$/m)?.[1].trim()) ||
  "";
// 3 a second keeps under 200 a minute; an account allowed more (an
// established editor) can say so with --rate
let rate = +arg("rate", 3); // requests a second, at most
const PARALLEL = Math.min(3, +arg("parallel", 3)); // requests in flight: 3 at most, by the rules
const WORKERS = PARALLEL; // names looked up at once
const ALL = process.argv.includes("--all");
const PICTURES_ONLY = process.argv.includes("--pictures");
const WITH_PICTURES = PICTURES_ONLY || process.argv.includes("--with-pictures");
const LIMIT = +arg("limit", Infinity);
const CYCLE_DAYS = 180;
const AGENT = `ColorNamesBot/1.0 (https://github.com/meodai/color-names) node/${process.versions.node}`;

/* —— requests: a steady pace, a User-Agent, retries when told to wait —— */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 1000 / rate;
  if (at > now) await sleep(at - now);
}

// no more than PARALLEL requests in flight
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

// Told to slow down: half the pace. A minute without being told: a little
// faster again, up to where it started.
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

// Wikimedia tells clients apart by their cookies: sent back, one session
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

// the Action API steps back when the servers lag: maxlag on every request
const withMaxlag = (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/api.php")) u.searchParams.set("maxlag", "5");
  return u.href;
};

// a maxlag refusal comes as an error in a 200 answer, with Retry-After
async function lagged(res) {
  if (!res.ok || !res.url.includes("/api.php")) return 0;
  try {
    const body = await res.clone().json();
    return body?.error?.code === "maxlag" ? +res.headers.get("retry-after") || 5 : 0;
  } catch {
    return 0;
  }
}

let told = 0; // times Wikimedia said to slow down
const toldBy = {};

// which name a request is for, to know if all of that name's went through
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
      // 404 is an answer (no such article); being told to slow down isn't:
      // then every request waits, not just this one
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) {
          told++;
          slowDown();
          const kind = `${new URL(url).host}${new URL(url).pathname.split("/").slice(0, 5).join("/")}`;
          toldBy[kind] = (toldBy[kind] || 0) + 1;
        }
        if (attempt < 4) {
          // Retry-After, or at least 5 seconds; longer each time
          const wait = Math.max(+res.headers.get("retry-after") * 1000 || 0, 5000) * 2 ** attempt;
          next = Math.max(next, Date.now() + wait);
          continue;
        }
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

// Pictures come from Wikimedia's image servers, which ask robots for at most
// 2 downloads at a time (wikitech.wikimedia.org/wiki/Robot_policy)
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
      if (!res.ok) return null; // gone: not a picture to measure
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
    return null; // not readable as a picture
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

/* —— the list, and the copies there are —— */

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

const fetched = new Map(); // slug → date of its copy
const pictured = new Set(); // slugs whose copy has its pictures
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

// copies of names that left the list (or were renamed)
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
// renewing starts with copies at least a week old: not the ones fetched
// earlier the same day, between the passes of a first fill
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const oldest = items
  .filter((it) => fetched.has(slugs.get(it.name)) && fetched.get(slugs.get(it.name)) < weekAgo)
  .sort((a, b) => (fetched.get(slugs.get(a.name)) < fetched.get(slugs.get(b.name)) ? -1 : 1))
  .slice(0, renew);
// every run renews its share; new names on top of that (all of them with
// --all, otherwise as many again)
const todo = (
  PICTURES_ONLY
    ? // copies without their pictures yet
      items.filter((it) => fetched.has(slugs.get(it.name)) && !pictured.has(slugs.get(it.name)))
    : [...(ALL ? missing : missing.slice(0, Math.max(renew, 500))), ...oldest]
).slice(0, LIMIT);

if (TOKEN) {
  // who the token is for, and that account's limits, as Wikimedia sees them
  const me = await politeFetch(
    "https://en.wikipedia.org/w/api.php?action=query&meta=userinfo&uiprop=ratelimits|groups&format=json"
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
    `${removed} removed; this run: ${todo.length} (${Math.min(missing.length, todo.length)} new)`
);

/* —— the run —— */

const today = new Date().toISOString().slice(0, 10);
const until = Date.now() + MINUTES * 60_000;
let done = 0;
let saved = 0;
const failures = [];
const started = Date.now();

// what the page searches Commons for: the name, and the color's noun
const pictureTerms = (it) => [it.name, new ColorDescription(it.hex).nouns[0]];

async function collect(it) {
  const slug = slugs.get(it.name);
  const state = { failed: [] };
  const previous = fetched.has(slug) ? JSON.parse(readFileSync(fileOf(slug), "utf8")) : null;
  const copy = await forName
    .run(state, async () => {
      // pictures only: the copy as it is, with its pictures added
      const looked = PICTURES_ONLY ? previous.looked : await lookupName(it.name);
      if (WITH_PICTURES) looked.pictures = await lookupPictures(it.hex, pictureTerms(it));
      // renewing the rest keeps the pictures it had
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

// a few names at a time; the pace is kept by the requests themselves
const queue = todo.slice();
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (queue.length && Date.now() < until) {
      await collect(queue.shift());
      if (done % 100 === 0) {
        const perMin = done / ((Date.now() - started) / 60_000);
        console.log(
          `  ${done}/${todo.length}, ${saved} saved, ${failures.length} failed, ${perMin.toFixed(0)} names/min, ` +
            `${rate.toFixed(1)} requests/s, told to wait ${told}×`
        );
      }
    }
  })
);

if (told) console.log("told to wait by:", JSON.stringify(toldBy));
console.log(`collect: ${saved} saved, ${failures.length} not (kept as they were), ${queue.length} left for later`);
if (failures.length) console.log(failures.slice(0, 10).map((f) => `  ${f}`).join("\n"));
// a run where nearly everything failed is an outage, and should say so
if (todo.length && failures.length > todo.length / 2) process.exit(1);
if (!existsSync(join(DATA, "README.md"))) {
  writeFileSync(
    join(DATA, "README.md"),
    "What Wikipedia and Wiktionary say about each color name, copied nightly by\n" +
      "website/scripts/collect.mjs on the project-website branch. Read by the site's build.\n"
  );
}
