// After a deploy: a comment on each names-repo pull request (or commit, without one) that put
// names on the list since the last deploy, with a link to each one's page, now that they're there.
//
//   node scripts/online.mjs <list sha of the last deploy> <list sha now>   (in color-names/)
//
// Prints what it would say without GH_TOKEN; with it, comments as that token's owner.

import { execFileSync } from "node:child_process";
import { readList, slugsOf, pageOf } from "../color-names/scripts/site.js";

const [before, now] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", "color-names", ...args], { encoding: "utf8" });
const listAt = (sha) => readList(git("show", `${sha}:src/colornames.csv`));
const gh = (...args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

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
const commits = git("log", "--reverse", "--format=%H", `${before}..${now}`, "--", "src/colornames.csv")
  .split("\n")
  .filter(Boolean);

for (const sha of commits) {
  const had = new Set(listAt(`${sha}^`).map((it) => it.name));
  // what this commit added and is still on the list
  const added = listAt(sha).filter((it) => !had.has(it.name) && onList.has(it.name));
  if (!added.length) continue;
  const SHOWN = 60;
  const lines = added.slice(0, SHOWN).map((it) => `- [${it.name}](${pageOf(slugs.get(it.name))}) \`${it.hex}\``);
  if (added.length > SHOWN) lines.push(`- …and ${added.length - SHOWN} more`);
  const body = [
    `:art: ${added.length === 1 ? "This color is" : `These ${added.length} colors are`} online now:`,
    "",
    ...lines,
  ].join("\n");
  if (!process.env.GH_TOKEN) {
    console.log(`--- ${sha}\n${body}`);
    continue;
  }
  // on the pull request that brought them, where its author sees it; else on the commit
  const pr = gh("api", `repos/meodai/color-names/commits/${sha}/pulls`, "--jq", "map(select(.merged_at))[0].number");
  if (pr && gh("api", `repos/meodai/color-names/issues/${pr}/comments`, "-f", `body=${body}\n\nThank you!`) !== null) {
    console.log(`online: ${added.length} on #${pr}`);
    continue;
  }
  gh("api", `repos/meodai/color-names/commits/${sha}/comments`, "-f", `body=${body}`);
  console.log(`online: ${added.length} on ${sha.slice(0, 8)}`);
}
