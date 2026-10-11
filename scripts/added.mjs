/*
  When each name was added: for every name on the list, the commit that
  first brought it into src/colornames.csv, and that commit's date. Read
  from the repository's own history at build time, and written to
  public/added.json for the color page:

    { commits: [[hash, "2017-05-23", author?, github?], …],
      names: { "Red-Handed": 12, … } }

  (names point into commits). The author is only kept when it isn't the
  list's maintainer, whose commits also carry what others suggested; their
  GitHub username when their email gives it away (GitHub's noreply one). Needs the full git history: a shallow clone
  in CI has to fetch it (fetch-depth: 0).
*/

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
const MAINTAINER = /^meodai@|^David Aerne$/;

// the names on the list today
const current = new Set(
  readFileSync(resolve(repo, CSV), "utf8")
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0])
    .filter(Boolean)
);

// every commit to the list, with only its added lines (newest first:
// --reverse would stop --follow at the file's old name)
let log;
try {
  log = execFileSync(
    "git",
    ["log", "--follow", "--no-merges", `--format=${MARK}%h${SEP}%aI${SEP}%an${SEP}%ae`, "-p", "--unified=0", "--", CSV],
    { cwd: repo, maxBuffer: 1 << 30 }
  ).toString();
} catch (e) {
  console.warn(`added.mjs: no git history to read (${e.message.split("\n")[0]}); writing an empty file`);
  log = "";
}

// split into commits, then read them oldest first
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
  let at = -1; // this commit, as an index into commits once it adds a name
  for (const line of lines) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const name = line.slice(1).split(",")[0];
    // the first time a name appears is when it was added; renamed or
    // re-colored names count from when they got that name
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
    (missing ? ` (${missing} not committed yet)` : "")
);
