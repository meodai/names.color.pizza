// node scripts/added.mjs  (needs full git history: fetch-depth: 0 in CI)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../public/added.json");
const CSV = "src/colornames.csv";
const MARK = "\u0001commit ";
const SEP = "\u0002";
// the maintainer's commits carry others' suggestions, so they aren't credited
const MAINTAINER = /^meodai@|^David Aerne$/;

const current = new Set(
  readFileSync(resolve(repo, CSV), "utf8")
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0])
    .filter(Boolean),
);

// newest first: --reverse would stop --follow at the file's old name
let log;
try {
  log = execFileSync(
    "git",
    ["log", "--follow", "--no-merges", `--format=${MARK}%h${SEP}%aI${SEP}%an${SEP}%ae`, "-p", "--unified=0", "--", CSV],
    { cwd: repo, maxBuffer: 1 << 30 },
  ).toString();
} catch (e) {
  console.warn(`added.mjs: no git history to read (${e.message.split("\n")[0]}); writing an empty file`);
  log = "";
}

const history = log
  .split(MARK)
  .slice(1)
  .map((chunk) => {
    const [head, ...lines] = chunk.split("\n");
    const [hash, iso, name, email] = head.split(SEP);
    const by = MAINTAINER.test(email) || MAINTAINER.test(name) ? null : name;
    const github = by && email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)?.[1];
    return { hash, date: iso.slice(0, 10), by, github, lines };
  })
  .reverse();

const commits = [];
const names = {};
for (const { hash, date, by, github, lines } of history) {
  let at = -1;
  for (const line of lines) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const name = line.slice(1).split(",")[0];
    // renamed or re-colored names count from when they got that name
    if (!current.has(name) || name in names || name === "name") continue;
    if (at < 0) {
      commits.push(by ? (github ? [hash, date, by, github] : [hash, date, by]) : [hash, date]);
      at = commits.length - 1;
    }
    names[name] = at;
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ commits, names }));
const missing = current.size - Object.keys(names).length;
console.log(
  `added.mjs: ${Object.keys(names).length} names from ${commits.length} commits` +
    (missing ? ` (${missing} not committed yet)` : ""),
);
