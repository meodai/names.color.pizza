// The link preview of an adopted color, 1200 × 630: its color in the foil it drew,
// a white strip with hex, name and patron, their face pinned on the edge. The
// foils are SVG, so the browser (drawShareCard, right after paying) and the
// build (scripts/share.mjs, with sharp) draw the same card.

// black or white, whichever reads better on the color
export function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#000" : "#fff";
}

export const SHARE = { W: 1200, H: 630, STRIP: 170, PAD: 56, GAP: 12, LOGO: 92, FACE: 112 };

// a steady random per color, so a card looks the same each time it's made
export function seeded(text) {
  let h = [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => ((h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// the five foils of src/shines.js, drawn for a still image
export function foilSVG(shine, w, h, rand) {
  const rainbow = (id, a, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">
      ${["#ff7ad9", "#ffd36e", "#f5ff7a", "#7affc8", "#7ad7ff", "#b38cff", "#ff7ad9"]
        .map((c, k) => `<stop offset="${k / 6}" stop-color="${c}" stop-opacity="${a}"/>`)
        .join("")}</linearGradient>`;
  let defs = "";
  let body = "";
  if (shine === "prism") {
    defs += rainbow("rb", 0.3) + `<pattern id="ln" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
      <rect width="3" height="9" fill="#fff" fill-opacity="0.14"/></pattern>`;
    body = `<rect width="${w}" height="${h}" fill="url(#rb)"/><rect width="${w}" height="${h}" fill="url(#ln)"/>`;
  } else if (shine === "galaxy") {
    defs += `<radialGradient id="neb1" cx="0.25" cy="0.3" r="0.6"><stop offset="0" stop-color="#b38cff" stop-opacity="0.55"/><stop offset="1" stop-color="#b38cff" stop-opacity="0"/></radialGradient>
      <radialGradient id="neb2" cx="0.8" cy="0.7" r="0.6"><stop offset="0" stop-color="#5ad2ff" stop-opacity="0.45"/><stop offset="1" stop-color="#5ad2ff" stop-opacity="0"/></radialGradient>`;
    const stars = Array.from({ length: 140 }, () => {
      const r = rand() < 0.1 ? 2.6 : 1 + rand();
      return `<circle cx="${(rand() * w).toFixed(1)}" cy="${(rand() * h).toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" fill-opacity="${(0.5 + rand() * 0.5).toFixed(2)}"/>`;
    }).join("");
    body = `<rect width="${w}" height="${h}" fill="#140a2e" fill-opacity="0.35"/><rect width="${w}" height="${h}" fill="url(#neb1)"/><rect width="${w}" height="${h}" fill="url(#neb2)"/>${stars}`;
  } else if (shine === "classic") {
    defs += rainbow("rb", 0.18, 1, 0) + `<pattern id="band" width="140" height="${h}" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
      <rect width="46" height="${h}" fill="#fff" fill-opacity="0.2"/><rect x="62" width="10" height="${h}" fill="#fff" fill-opacity="0.12"/></pattern>`;
    body = `<rect width="${w}" height="${h}" fill="url(#rb)"/><rect width="${w}" height="${h}" fill="url(#band)"/>`;
  } else if (shine === "radiant") {
    const size = 36;
    const cells = [];
    for (let y = 0; y < h; y += size)
      for (let x = 0; x < w; x += size) {
        const hue = Math.round(((x + y) / (w + h)) * 360 + rand() * 40);
        cells.push(`<rect x="${x + 3}" y="${y + 3}" width="${size - 6}" height="${size - 6}" fill="hsl(${hue} 95% 70%)" fill-opacity="${(0.08 + rand() * 0.2).toFixed(2)}"/>`);
      }
    body = cells.join("");
  } else {
    // aurora: soft bands of light
    defs += `<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>`;
    body = [
      ["#7affc8", 0.2, 0.35],
      ["#7ad7ff", 0.55, 0.55],
      ["#b38cff", 0.85, 0.3],
    ]
      .map(([c, x, y]) => `<ellipse cx="${x * w}" cy="${y * h}" rx="${w * 0.32}" ry="${h * 0.18}" fill="${c}" fill-opacity="0.45" filter="url(#soft)" transform="rotate(-12 ${x * w} ${y * h})"/>`)
      .join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${defs}</defs>${body}</svg>`;
}


const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const handleOf = (a) => (a.on === "name" || a.on === "anonymous" ? a.by : `@${a.by.replace(/^@/, "")}`);

// the same card as scripts/share.mjs, drawn on a canvas: a PNG blob
export async function drawShareCard(it, adopted, logoSVG) {
  const { W, H, STRIP, PAD, GAP, LOGO, FACE } = SHARE;
  const top = H - STRIP;
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d");
  await Promise.all(["700 64px Inter", "300 34px Inter", "700 26px Inter"].map((f) => document.fonts.load(f)));

  ctx.fillStyle = it.hex;
  ctx.fillRect(0, 0, W, top);
  if (adopted.shine && adopted.amount >= 10) {
    const svg = foilSVG(adopted.shine, W, top, seeded(it.name));
    const foil = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    ctx.drawImage(foil, 0, 0);
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, top, W, STRIP);

  // the text block centered on its ink, as sharp trims it
  const lines = [
    { text: it.hex, font: "700 64px Inter", color: "#000" },
    { text: it.name, font: "300 34px Inter", color: "#000" },
  ].map((l) => {
    ctx.font = l.font;
    const m = ctx.measureText(l.text);
    return { ...l, up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent };
  });
  const block = lines.reduce((sum, l) => sum + l.up + l.down, 0) + GAP * (lines.length - 1);
  let y = top + (STRIP - block) / 2;
  const room = W - 3 * PAD - LOGO - FACE;
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(l.text, PAD, y + l.up, room);
    y += l.up + l.down + GAP;
  }

  // who adopted it, on the color itself, bottom left
  ctx.font = "700 30px Inter";
  ctx.fillStyle = inkOn(it.hex);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${adopted.founding ? "Founding patron" : "Adopted by"} ${handleOf(adopted)}`, PAD, top - 34, W - 2 * PAD);

  const logo = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSVG)}`);
  const logoW = (logo.width / logo.height) * LOGO;
  ctx.drawImage(logo, W - PAD - logoW, top + (STRIP - LOGO) / 2, logoW, LOGO);

  // their face beside the parrot, a little over it: a ring (gold for the founding), then the picture
  const fx = W - PAD - logoW - FACE + 18;
  const fy = top + (STRIP - FACE) / 2;
  const r = FACE / 2;
  ctx.beginPath();
  ctx.arc(fx + r, fy + r, r, 0, Math.PI * 2);
  ctx.fillStyle = adopted.founding ? "#e9b52b" : "#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(fx + r, fy + r, r - 8, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  const picture = adopted.avatar ? await loadImage(adopted.avatar).catch(() => null) : null;
  if (picture) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(fx + r, fy + r, r - 8, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max((FACE - 16) / picture.width, (FACE - 16) / picture.height);
    ctx.drawImage(picture, fx + r - (picture.width * s) / 2, fy + r - (picture.height * s) / 2, picture.width * s, picture.height * s);
    ctx.restore();
  } else {
    ctx.fillStyle = "#000";
    ctx.font = "700 64px Inter";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(adopted.on === "anonymous" ? "♥" : (adopted.by.replace(/^@/, "")[0] || "?").toUpperCase(), fx + r, fy + r + 2);
    ctx.textAlign = "start";
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
