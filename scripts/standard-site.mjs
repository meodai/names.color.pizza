/*
  Publishes the list on atproto for Standard.site: the publication record of
  @color.pizza, then a document for each color page that isn't there yet.
  Reads what pages.mjs wrote to .cache/standard-site.json, and the app password
  from BSKY_APP_PASSWORD or ~/.config/color-names/bsky.env. The server allows
  so many writes an hour and a day: it waits those out, and a second run
  carries on where the first stopped.

    node scripts/standard-site.mjs [--limit n] [--dry]
*/

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DID, PUBLICATION, PUBLICATION_KEY } from "../src/standard-site.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : fallback;
};
const LIMIT = Number(arg("limit", 0));
const DRY = process.argv.includes("--dry");
const BATCH = 100;
const SITE = "https://names.color.pizza";
const DOCUMENT = "site.standard.document";

const config = join(homedir(), ".config/color-names/bsky.env");
const env = Object.fromEntries(
  existsSync(config)
    ? readFileSync(config, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
    : [],
);
const HANDLE = process.env.BSKY_HANDLE || env.BSKY_HANDLE || "color.pizza";
const PASSWORD = process.env.BSKY_APP_PASSWORD || env.BSKY_APP_PASSWORD;

const documents = JSON.parse(readFileSync(resolve(here, "../.cache/standard-site.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let session = null;
let pds = "https://bsky.social";

async function login() {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  session = await res.json();
  if (session.did !== DID) throw new Error(`logged in as ${session.did}, not ${DID}`);
  pds = session.didDoc?.service?.find((s) => s.id === "#atproto_pds")?.serviceEndpoint || pds;
}

// waits out rate limits, logs in again when the session runs out
async function xrpc(nsid, { query, body, type = "application/json" } = {}) {
  for (let attempt = 1; ; attempt++) {
    const url = new URL(`/xrpc/${nsid}`, pds);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${session.accessJwt}`, ...(body ? { "content-type": type } : {}) },
      body: body && type === "application/json" ? JSON.stringify(body) : body,
    }).catch(() => null);
    if (res?.ok) return res.json();
    const reset = Number(res?.headers.get("ratelimit-reset")) * 1000;
    if (res?.status === 429) {
      const wait = Math.max(reset - Date.now(), 60_000) + 5_000;
      console.log(`  rate limited, waiting ${Math.round(wait / 60000)} min`);
      await sleep(wait);
      continue;
    }
    const text = res ? await res.text() : "no answer";
    if (res && /ExpiredToken|InvalidToken/.test(text)) {
      await login();
      continue;
    }
    if (attempt >= 5) throw new Error(`${nsid} ${res?.status ?? ""} ${text}`);
    await sleep(5000 * attempt);
  }
}

async function publish() {
  const icon = readFileSync(resolve(here, "../public/logo/cockatoo-fill.png"));
  const { blob } = await xrpc("com.atproto.repo.uploadBlob", { body: icon, type: "image/png" });
  await xrpc("com.atproto.repo.putRecord", {
    body: {
      repo: DID,
      collection: "site.standard.publication",
      rkey: PUBLICATION_KEY,
      record: {
        $type: "site.standard.publication",
        url: SITE,
        name: "Color Names",
        icon: blob,
        description: `${documents.length.toLocaleString("en")} colors, each named by a person: an open list, grown over the years from many sources and thousands of suggestions.`,
      },
    },
  });
}

async function existing() {
  const keys = new Set();
  let cursor;
  do {
    const page = await xrpc("com.atproto.repo.listRecords", {
      query: { repo: DID, collection: DOCUMENT, limit: 100, cursor },
    });
    for (const r of page.records) keys.add(r.uri.split("/").pop());
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

const record = (d) => ({
  $type: DOCUMENT,
  site: PUBLICATION,
  path: `/color/${d.slug}/`,
  title: d.name,
  description: d.description,
  tags: [d.hex],
  publishedAt: `${d.day}T00:00:00.000Z`,
});

if (!PASSWORD) throw new Error(`no app password: set BSKY_APP_PASSWORD or put it in ${config}`);
await login();
const have = await existing();
const todo = documents.filter((d) => !have.has(d.key));
if (LIMIT) todo.length = Math.min(todo.length, LIMIT);
console.log(`standard-site: ${documents.length} pages, ${have.size} published, ${todo.length} to publish`);
if (DRY) process.exit(0);

await publish();
let done = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  await xrpc("com.atproto.repo.applyWrites", {
    body: {
      repo: DID,
      writes: batch.map((d) => ({
        $type: "com.atproto.repo.applyWrites#create",
        collection: DOCUMENT,
        rkey: d.key,
        value: record(d),
      })),
    },
  });
  done += batch.length;
  if (done % 1000 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
}
console.log(`standard-site: ${done} published`);
