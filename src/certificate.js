import { handle, longDate } from "./adopter.js";

// The certificate a patron gets on the thank-you page: very official, a little tongue in
// cheek. A banknote's rosette and a round seal in the adopted color, the parrot in the seal.

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// a guilloche rosette: loops of a hypotrochoid, each turned a little, as on banknotes
function rosette(cx, cy, size, loops = 18) {
  const paths = [];
  for (let k = 0; k < loops; k++) {
    const turn = (k / loops) * Math.PI * 2;
    const R = size;
    const r = size * 0.27;
    // as far out as the rolling circle's middle: every loop passes through the center
    const d = R - r;
    let p = "";
    for (let i = 0; i <= 360; i++) {
      const t = (i / 360) * Math.PI * 2 * 3;
      const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      const rx = x * Math.cos(turn) - y * Math.sin(turn);
      const ry = x * Math.sin(turn) + y * Math.cos(turn);
      p += `${i ? "L" : "M"}${(cx + rx * 0.5).toFixed(1)} ${(cy + ry * 0.5).toFixed(1)}`;
    }
    paths.push(p);
  }
  return `<path d="${paths.join("")}" fill="none" stroke="currentColor" stroke-width="0.35"/>`;
}

// the round seal: its words around the rim, the parrot in the middle
function seal(logo) {
  const words = "COLOR NAMES · CERTIFIED ADOPTION · OFFICIAL SEAL · ";
  return `<svg class="cert__seal" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="cert-rim" d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0"/></defs>
    <circle cx="60" cy="60" r="57" fill="currentColor"/>
    <circle cx="60" cy="60" r="53" fill="none" stroke="var(--cert-on)" stroke-width="0.8" stroke-dasharray="1.5 2"/>
    <circle cx="60" cy="60" r="38" fill="none" stroke="var(--cert-on)" stroke-width="0.8"/>
    <text fill="var(--cert-on)" font-size="7.2" font-weight="700"><textPath href="#cert-rim" textLength="269" lengthAdjust="spacing">${words}</textPath></text>
    <circle class="cert__seal-edge" cx="60" cy="60" r="57" fill="none" stroke="var(--cert-key)" stroke-width="1"/>
    <svg x="40" y="36" width="40" height="48" viewBox="20 12 130 158" color="var(--cert-parrot)">${logo}</svg>
    <svg x="37.5" y="38.5" width="40" height="48" viewBox="20 12 130 158" overflow="visible"><path d="${PARROT_LINES}" fill="none" stroke="var(--cert-key)" stroke-width="7" stroke-miterlimit="10"/></svg>
  </svg>`;
}

// the parrot drawn in lines (public/logo/cockatoo-stroke-one-color.svg), laid over the seal's
// filled one a little off, as a print slightly out of register
const PARROT_LINES =
  "M113.9 79.2A10 10 0 0 0 120 70V50a30 30 0 0 1 30-30v50a40 40 0 0 1-20 34.6m-9.6-3.3a40 40 0 0 0 4.2-46l-10-17.3-15-26a30 30 0 0 0-11 41l10 17.3a10 10 0 0 1-.7 11m16.1 18.9a40 40 0 0 0-18.6-44.8L78 45.4l-26-15a30 30 0 0 0 11 41l17.3 10a10 10 0 0 1 4.1 12.8M110 110a40 40 0 0 0-40-40H20a30 30 0 0 0 30 30h21.2m33.4-9.9A80 80 0 0 0 30 170h80m0-70v30a10 10 0 0 0 10 10h30a40 40 0 0 0-40-40zm0 30v40a30 30 0 0 0 30-30m-52.5-20a7.5 7.5 0 1 0 7.5 7.5 7.5 7.5 0 0 0-7.5-7.5z";

// it: the color; adopted: who, how and when; number: its place in the register;
// shades: the swatch card's two darker (or lighter) steps; look: its tone and the colors
// of its lines, the seal's parrot and the parrot's outline
export function certificateHTML({ it, adopted, number, logo, ink, shades, look }) {
  const no = String(number).padStart(4, "0");
  // signed by hand: every certificate a little differently, the same one each time it's shown
  const hash = (salt) => {
    let h = 2166136261 ^ salt;
    for (const ch of it.name + it.hex) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  const tilt = -9 + hash(1) * 9;
  const drop = -0.08 + hash(2) * 0.38;
  const when = longDate(adopted.at);
  const facts = [
    ["Recorded", escapeHTML(when)],
    ...(adopted.founding ? [["Standing", "Founding patron"]] : []),
    ...(adopted.shine && adopted.amount >= 10
      ? [["Foil", escapeHTML(adopted.shine[0].toUpperCase() + adopted.shine.slice(1))]]
      : []),
  ];
  return `<article class="cert" data-tone="${look.tone}" style="--cert-c:${it.hex};--cert-on:${ink};--cert-line:${look.line};--cert-parrot:${look.parrot};--cert-key:${look.key}" aria-label="Certificate of adoption no. ${no}">
    <svg class="cert__guilloche" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${rosette(200, 200, 380)}</svg>
    <header class="cert__head">
      <p class="label">Color Names · Register of Patrons</p>
      <p class="label cert__no">No. ${no}</p>
    </header>
    <h2 class="cert__title">Certificate of Adoption</h2>
    <p class="cert__line">This is to certify that</p>
    <p class="cert__who">${escapeHTML(handle(adopted.by, adopted.on))}</p>
    <p class="cert__line">is the one and only adopter of</p>
    <div class="swatchcard swatchcard--visible cert__card" style="--c-color:${it.hex};--c-shade0:${shades[0]};--c-shade1:${shades[1]}">
      <div class="swatchcard__upper">
        <i class="swatchcard__swatch" aria-hidden="true"><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i><i class="swatchcard__shade"></i></i>
      </div>
      <div class="swatchcard__label">
        <div class="swatchcard__info">
          <span class="swatchcard__row1">${it.hex}</span>
          <span class="swatchcard__row2">${escapeHTML(it.name)}</span>
        </div>
      </div>
    </div>
    <dl class="cert__facts">${facts.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    <footer class="cert__foot">
      <div class="cert__sign">
        <p class="cert__signature"><span style="rotate:${tilt.toFixed(1)}deg;translate:0 ${drop.toFixed(2)}em">D. Aerne</span></p>
        <p class="label">Keeper of the List, Zürich</p>
      </div>
      ${seal(logo)}
    </footer>
    <p class="cert__fine">The color itself stays free for everyone to use, as every name on the list does (MIT). This certificate is not transferable, does not expire, and is worth exactly as much as the warm feeling it gives.</p>
  </article>`;
}
