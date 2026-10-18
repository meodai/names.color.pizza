// After a deploy: a comment on each names-repo commit that put names on the list since the
// last deploy, with a link to each one's page, now that the pages are there.
//
//   node scripts/online.mjs <list sha of the last deploy> <list sha now>   (in color-names/)
//
// Prints what it would say without GH_TOKEN; with it, comments as that token's owner.

import { execFileSync } from "node:child_process";
import { readList, slugsOf, pageOf } from "../color-names/scripts/site.js";

const [before, now] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", "color-names", ...args], { encoding: "utf8" });
const listAt = (sha) => readList(git("show", `${sha}:src/colornames.csv`));

if (!before || !now || before === now) process.exit(0);
try {
  git("merge-base", "--is-ancestor", before, now);
} catch {
  console.log(`online: ${before} isn't before ${now}; nothing said`);
  process.exit(0);
}

const live = listAt(now);
const slugs = slugsOf(live);
const onList = new Set(live.map((it) => it.name));
const commits = git("log", "--reverse", "--format=%H", `${before}..${now}`, "--", "src/colornames.csv").split("\n").filter(Boolean);

for (const sha of commits) {
  const had = new Set(listAt(`${sha}^`).map((it) => it.name));
  // what this commit added and is still on the list
  const added = listAt(sha).filter((it) => !had.has(it.name) && onList.has(it.name));
  if (!added.length) continue;
  const SHOWN = 60;
  const lines = added.slice(0, SHOWN).map((it) => `- [${it.name}](${pageOf(slugs.get(it.name))}) \`${it.hex}\``);
  if (added.length > SHOWN) lines.push(`- …and ${added.length - SHOWN} more`);
  const body = [`:art: ${added.length === 1 ? "This color is" : `These ${added.length} colors are`} online now:`, "", ...lines].join("\n");
  if (!process.env.GH_TOKEN) {
    console.log(`--- ${sha}\n${body}`);
    continue;
  }
  execFileSync("gh", ["api", `repos/meodai/color-names/commits/${sha}/comments`, "-f", `body=${body}`], { stdio: "ignore" });
  console.log(`online: ${added.length} on ${sha.slice(0, 8)}`);
}
