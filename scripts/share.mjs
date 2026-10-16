/*
  The link preview of an adopted color: its card in the foil it drew, with the
  patron's face pinned to it, uploaded to media.color.pizza/share/<slug>.png.
  The upload worker starts this the moment a color is adopted (share.yml), and
  the build runs it for every adoption, so a changed one catches up.

    node scripts/share.mjs [slug …]      (no slug: every adopted color)
*/

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { slugsOf } from "../src/names.js";
import { foilSVG, seeded, SHARE, inkOn } from "../src/share-card.js";

const here = dirname(fileURLToPath(import.meta.url));
const FONTS = join(here, "fonts");
const LIST = resolve(here, "../color-names/src/colornames.csv");
const ADOPTED = process.env.ADOPTED_URL || "https://media.color.pizza/data/adopted.json";
const { UPLOAD_URL, UPLOAD_KEY } = process.env;

const { W, H, STRIP, PAD, GAP, LOGO, FACE } = SHARE;

const items = readFileSync(LIST, "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, hex] = line.split(",");
    return { name, hex: hex.toLowerCase() };
  });
const slugs = slugsOf(items);
const bySlug = new Map(items.map((it) => [slugs.get(it.name), it]));

const page = readFileSync(resolve(here, "../color/index.html"), "utf8");
const [, viewBox, logo] = page.match(/<svg class="brand__logo" viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg\s*>/);
const paths = logo.replace(/fill="(?!#fff")[^"]*"/g, 'fill="#000"');
const mark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths}</svg>`))
  .resize({ height: LOGO })
  .png()
  .toBuffer();
const markWidth = (await sharp(mark).metadata()).width;

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function line(text, weight, size, width, color = "#000") {
  const raw = await sharp({
    text: {
      text: `<span foreground="${color}">${esc(text)}</span>`,
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

// their face in a white (or, founding, gold) ring, or their initial, or a heart
async function face(adopted) {
  const ring = adopted.founding ? "#e9b52b" : "#fff";
  const size = FACE;
  const inner = size - 16;
  const disc = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${ring}"/><circle cx="${size / 2}" cy="${size / 2}" r="${inner / 2}" fill="#fff"/></svg>`,
  );
  let picture = null;
  if (adopted.avatar) {
    const res = await fetch(adopted.avatar).catch(() => null);
    if (res?.ok) {
      const mask = Buffer.from(`<svg width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}"/></svg>`);
      picture = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(inner, inner, { fit: "cover" })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer()
        .catch(() => null);
    }
  }
  if (!picture) {
    const sign = adopted.on === "anonymous" ? "♥" : (adopted.by.replace(/^@/, "")[0] || "?").toUpperCase();
    const t = await line(sign, "Bold", 64);
    const meta = await sharp(t.img).metadata();
    picture = await sharp({ create: { width: inner, height: inner, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: t.img, left: Math.round((inner - meta.width) / 2), top: Math.round((inner - meta.height) / 2) }])
      .png()
      .toBuffer();
  }
  return sharp(disc).composite([{ input: picture, left: 8, top: 8 }]).png().toBuffer();
}

const handle = (a) => (a.on === "name" || a.on === "anonymous" || a.on === "website" ? a.by : `@${a.by.replace(/^@/, "")}`);

export async function shareCard(it, adopted) {
  const top = H - STRIP;
  const rand = seeded(it.name);
  const code = await line(it.hex, "Bold", 64);
  const label = await line(it.name, "Light", 34, W - 3 * PAD - markWidth - FACE);
  const by = await line(
    `${adopted.founding ? "Founding patron" : "Adopted by"} ${handle(adopted)}`,
    "Bold",
    30,
    W - 2 * PAD,
    inkOn(it.hex),
  );
  const block = code.height + GAP + label.height;
  const y = top + Math.round((STRIP - block) / 2);
  const parts = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${STRIP}"><rect width="100%" height="100%" fill="#fff"/></svg>`), left: 0, top }];
  if (adopted.shine && adopted.amount >= 10) parts.unshift({ input: Buffer.from(foilSVG(adopted.shine, W, top, rand)), left: 0, top: 0 });
  parts.push(
    { input: code.img, left: PAD, top: y },
    { input: label.img, left: PAD, top: y + code.height + GAP },
    // who adopted it, on the color itself, bottom left
    { input: by.img, left: PAD, top: top - 34 - by.height },
    { input: mark, left: W - PAD - markWidth, top: top + Math.round((STRIP - LOGO) / 2) },
    // beside the parrot, a little over it
    { input: await face(adopted), left: W - PAD - markWidth - FACE + 18, top: top + Math.round((STRIP - FACE) / 2) },
  );
  return sharp({ create: { width: W, height: H, channels: 3, background: it.hex } })
    .composite(parts)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function upload(slug, png) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${UPLOAD_URL}/share/${slug}.png`, {
      method: "PUT",
      headers: { authorization: `Bearer ${UPLOAD_KEY}`, "content-type": "image/png" },
      body: png,
    }).catch(() => null);
    if (res?.ok) return true;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetch(ADOPTED, { cache: "no-store" }).catch(() => null);
  const adopted = res?.ok ? await res.json() : {};
  const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
  const todo = (asked.length ? asked : Object.keys(adopted)).filter((s) => adopted[s]?.amount >= 5 && bySlug.has(s));
  let sent = 0;
  for (const slug of todo) {
    const png = await shareCard(bySlug.get(slug), adopted[slug]);
    if (out) (await import("node:fs")).writeFileSync(join(out, `${slug}.png`), png);
    else if (UPLOAD_URL && UPLOAD_KEY && (await upload(slug, png))) sent++;
  }
  console.log(`share.mjs: ${todo.length} share cards${out ? ` in ${out}` : `, ${sent} uploaded`}`);
}
