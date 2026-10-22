// node scripts/best-of.mjs
// The Best of names, for the wall's dice: the names the list marks as good, out of the same file
// as the full list, so the wall needn't ask the API for the whole Best of list.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/best-of.json");
const [head, ...lines] = readFileSync(resolve(here, "../color-names/src/colornames.csv"), "utf8").split("\n");
const good = head.split(",").indexOf("good name");
if (good < 0) throw new Error("best-of.mjs: no “good name” column in colornames.csv");

const names = lines
  .map((line) => line.split(","))
  .filter((cols) => cols[good]?.trim())
  .map(([name]) => name);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(names));
console.log(`best-of.mjs: ${names.length} names`);
