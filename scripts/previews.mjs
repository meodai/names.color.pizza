// Each name's link preview, dist/color/<slug>/card.png, cached in
// .cache/previews by name and hex.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { slugsOf } from "../src/names.js";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "../dist");
const CACHE = resolve(here, "../.cache/previews");
const LIST = resolve(here, "../../src/colornames.csv");
const FONTS = join(here, "fonts");
const DESIGN = 2; // bump to remake every preview

const W = 600;
const H = 315;
const STRIP = 85;
const PAD = 28;
const GAP = 7;
const LOGO = 46;

const items = readFileSync(LIST, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, hex] = line.split(",");
    return { name, hex: hex.toLowerCase() };
  });
const slugs = slugsOf(items);

const page = readFileSync(resolve(here, "../color/index.html"), "utf8");
const [, viewBox, logo] = page.match(/<svg class="brand__logo" viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg\s*>/);
const paths = logo.replace(/fill="(?!#fff")[^"]*"/g, 'fill="#000"');
const mark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths}</svg>`))
  .resize({ height: LOGO })
  .png()
  .toBuffer();
const markWidth = (await sharp(mark).metadata()).width;
const strip = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${STRIP}"><rect width="100%" height="100%" fill="#fff"/></svg>`,
);

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// trimmed to its ink, so the block centers on what shows
async function line(text, weight, size, width) {
  const raw = await sharp({
    text: {
      text: `<span foreground="#000">${esc(text)}</span>`,
      font: `Inter ${weight} ${size}`,
      fontfile: join(FONTS, `Inter-${weight}.ttf`),
      rgba: true,
      dpi: 72,
      width,
      wrap: "none",
    },
  })
    .png()
    .toBuffer();
  const img = await sharp(raw).trim({ threshold: 1 }).png().toBuffer();
  return { img, height: (await sharp(img).metadata()).height };
}

async function preview({ name, hex }, file) {
  const code = await line(hex, "Bold", 32);
  const label = await line(name, "Light", 17, W - 3 * PAD - markWidth);
  const top = H - STRIP + Math.round((STRIP - (code.height + GAP + label.height)) / 2);
  await sharp({ create: { width: W, height: H, channels: 3, background: hex } })
    .composite([
      { input: strip, left: 0, top: H - STRIP },
      { input: code.img, left: PAD, top },
      { input: label.img, left: PAD, top: top + code.height + GAP },
      { input: mark, left: W - PAD - markWidth, top: H - STRIP + Math.round((STRIP - LOGO) / 2) },
    ])
    .png({ palette: true, colors: 64, compressionLevel: 9, effort: 10 })
    .toFile(file);
}

mkdirSync(CACHE, { recursive: true });
const keyOf = ({ name, hex }) => createHash("sha1").update(`${DESIGN}|${name}|${hex}`).digest("hex");
const todo = items.filter((it) => !existsSync(join(CACHE, `${keyOf(it)}.png`)));

let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const it = todo[next++];
      await preview(it, join(CACHE, `${keyOf(it)}.png`));
    }
  }),
);

if (todo.length) {
  try {
    const files = todo.map((it) => join(CACHE, `${keyOf(it)}.png`));
    for (let i = 0; i < files.length; i += 500) {
      execFileSync("oxipng", ["-q", "-o", "max", "--strip", "safe", ...files.slice(i, i + 500)]);
    }
  } catch (error) {
    console.log(`previews.mjs: not optimized (${error.code === "ENOENT" ? "no oxipng" : error.message})`);
  }
}

const keep = new Set();
for (const it of items) {
  const key = keyOf(it);
  keep.add(`${key}.png`);
  const dir = join(DIST, "color", slugs.get(it.name));
  if (existsSync(dir)) copyFileSync(join(CACHE, `${key}.png`), join(dir, "card.png"));
}
let gone = 0;
for (const file of readdirSync(CACHE)) {
  if (!keep.has(file)) {
    unlinkSync(join(CACHE, file));
    gone++;
  }
}
console.log(`previews.mjs: ${items.length} previews (${todo.length} made, ${gone} dropped from the cache)`);
