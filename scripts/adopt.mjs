/*
  Records who adopted a color in adopted.json, until the Ko-fi webhook does
  it: 5 or more shows them on the color's page, 10 or more makes its card holo
  in one of the foils, rolled once and kept.

    node scripts/adopt.mjs <slug> --by <handle> --on bluesky|github|x|name --amount <n>
*/

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SHINES, HOLO_FROM } from "../src/shines.js";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, "../adopted.json");
const arg = (name) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? process.argv[k + 1] : undefined;
};
const [slug] = process.argv.slice(2);
const by = arg("by");
const on = arg("on");
const amount = Number(arg("amount"));
if (!slug || !by || !["bluesky", "github", "x", "name"].includes(on) || !(amount > 0))
  throw new Error("node scripts/adopt.mjs <slug> --by <handle> --on bluesky|github|x|name --amount <n>");
if (!existsSync(resolve(here, "../dist/color", slug))) console.warn(`no built page for ${slug}: check the slug`);

// their picture, looked up once: Bluesky's profile, GitHub's avatar; X has none to ask for
async function avatarOf(handle, where) {
  if (where === "github") return `https://github.com/${handle}.png?size=96`;
  if (where !== "bluesky") return undefined;
  const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
  return res.ok ? (await res.json()).avatar : undefined;
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
