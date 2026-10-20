/*
  Records who adopted a color in adopted.json, until the Ko-fi webhook does
  it: 5 or more shows them on the color's page, 10 or more makes its card holo
  in one of the foils, rolled once and kept.

    node scripts/adopt.mjs <slug> --by <handle> --on <where> --amount <n>

  where: name, anonymous (no --by), website, or bluesky, github, x, instagram,
  tiktok, twitch, linkedin. The handle is cleaned as the adopt page does it.
*/

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SHINES, HOLO_FROM } from "../src/shines.js";
import { PROFILES, UNAVATAR, cleanHandle, isHost } from "../src/adopter.js";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, "../adopted.json");
const arg = (name) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : undefined;
};
// every place the adopt page offers
const PLACES = ["name", "anonymous", ...Object.keys(PROFILES)];
const USAGE = `node scripts/adopt.mjs <slug> --by <handle> --on ${PLACES.join("|")} --amount <n>`;
if (process.argv.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const [slug] = process.argv.slice(2);
const on = arg("on");
const by = PLACES.includes(on) ? cleanHandle(arg("by") || "", on) : "";
const amount = Number(arg("amount"));
if (!slug || slug.startsWith("--") || !by || !(amount > 0)) throw new Error(USAGE);
if (on === "website" && !isHost(by)) throw new Error(`${arg("by")} isn't a site's address`);
if (!existsSync(resolve(here, "../dist/color", slug))) console.warn(`no built page for ${slug}: check the slug`);

// their picture, looked up once: Bluesky's profile, GitHub's avatar, the rest what unavatar
// finds for them, as the adopt page asks it
async function avatarOf(handle, where) {
  if (where === "github") return `https://github.com/${handle}.png?size=96`;
  if (where === "bluesky") {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
    );
    return res.ok ? (await res.json()).avatar : undefined;
  }
  if (!UNAVATAR[where]) return undefined;
  const src = `https://unavatar.io/${UNAVATAR[where](encodeURIComponent(handle))}`;
  const res = await fetch(`${src}?fallback=false`).catch(() => null);
  return res?.ok ? src : undefined;
}

const adopted = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const had = adopted[slug];
if (had && had.by !== by) throw new Error(`${slug} is already adopted by ${had.by}`);
const total = (had?.amount || 0) + amount;
adopted[slug] = {
  by,
  on,
  amount: total,
  // the foil is rolled once, the first time it reaches HOLO_FROM
  ...(total >= HOLO_FROM ? { shine: had?.shine || SHINES[randomInt(SHINES.length)] } : {}),
  at: had?.at || new Date().toISOString().slice(0, 10),
  avatar: had?.avatar || (await avatarOf(by, on)),
};
writeFileSync(FILE, `${JSON.stringify(adopted, null, 2)}\n`);
console.log(`${slug}: ${by} (${on}), ${total}${adopted[slug].shine ? `, ${adopted[slug].shine}` : ""}`);
