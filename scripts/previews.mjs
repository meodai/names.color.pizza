// Each name's link preview, uploaded to media.color.pizza (UPLOAD_URL and
// UPLOAD_KEY), cached in .cache/previews by name and hex. The cache keeps a
// list of what's uploaded, so each is uploaded once.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cardKey as keyOf } from "./cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(here, "../.cache/previews");
const LIST = resolve(here, "../color-names/src/colornames.csv");
const FONTS = join(here, "fonts");

const W = 1200;
const H = 630;
const STRIP = 170;
const PAD = 56;
const GAP = 14;
const LOGO = 92;

const items = readFileSync(LIST, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, hex] = line.split(",");
    return { name, hex: hex.toLowerCase() };
  });

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
  const code = await line(hex, "Bold", 64);
  const label = await line(name, "Light", 34, W - 3 * PAD - markWidth);
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
      execFileSync("oxipng", ["-q", "-o", "2", "--strip", "safe", ...files.slice(i, i + 500)]);
    }
  } catch (error) {
    console.log(`previews.mjs: not optimized (${error.code === "ENOENT" ? "no oxipng" : error.message})`);
  }
}

const UPLOADED = join(CACHE, "uploaded.txt");
const uploaded = new Set(existsSync(UPLOADED) ? readFileSync(UPLOADED, "utf8").split("\n").filter(Boolean) : []);
const keep = new Set(["uploaded.txt"]);
for (const it of items) keep.add(`${keyOf(it)}.png`);
let gone = 0;
for (const file of readdirSync(CACHE)) {
  if (!keep.has(file)) {
    unlinkSync(join(CACHE, file));
    uploaded.delete(file);
    gone++;
  }
}

const { UPLOAD_URL, UPLOAD_KEY } = process.env;
const send = UPLOAD_URL && UPLOAD_KEY ? [...keep].filter((f) => f !== "uploaded.txt" && !uploaded.has(f)) : [];
let sent = 0;
await Promise.all(
  Array.from({ length: 16 }, async () => {
    while (send.length) {
      const file = send.pop();
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(`${UPLOAD_URL}/cards/${file}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${UPLOAD_KEY}`, "content-type": "image/png" },
          body: readFileSync(join(CACHE, file)),
        }).catch(() => null);
        if (res?.ok) {
          uploaded.add(file);
          sent++;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }),
);
writeFileSync(UPLOADED, [...uploaded].join("\n"));
console.log(
  `previews.mjs: ${items.length} previews (${todo.length} made, ${gone} dropped from the cache, ${sent} uploaded${UPLOAD_URL ? "" : "; no UPLOAD_URL, none uploaded"})`,
);
