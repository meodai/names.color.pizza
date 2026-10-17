import { handle, longDate } from "./adopter.js";

// The certificate a patron gets on the thank-you page: very official, a little tongue in
// cheek. A banknote's rosette and a round seal in the adopted color, the parrot in the seal.

const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

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
    <defs><path id="cert-rim" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0"/></defs>
    <circle cx="60" cy="60" r="57" fill="currentColor"/>
    <circle cx="60" cy="60" r="53" fill="none" stroke="var(--cert-on)" stroke-width="0.8" stroke-dasharray="1.5 2"/>
    <circle cx="60" cy="60" r="38" fill="none" stroke="var(--cert-on)" stroke-width="0.8"/>
    <text fill="var(--cert-on)" font-size="7.2" font-weight="700"><textPath href="#cert-rim" textLength="288" lengthAdjust="spacing">${words}</textPath></text>
    <svg x="40" y="36" width="40" height="48" viewBox="20 12 130 158" color="var(--cert-on)">${logo}</svg>
  </svg>`;
}

// it: the color; adopted: who, how and when; number: its place in the register
export function certificateHTML({ it, adopted, number, logo, ink }) {
  const no = String(number).padStart(4, "0");
  const when = longDate(adopted.at);
  const facts = [
    ["Value", it.hex],
    ["Recorded", escapeHTML(when)],
    ...(adopted.founding ? [["Standing", "Founding patron"]] : []),
    ...(adopted.shine && adopted.amount >= 10 ? [["Foil", escapeHTML(adopted.shine[0].toUpperCase() + adopted.shine.slice(1))]] : []),
  ];
  return `<article class="cert" style="--cert-c:${it.hex};--cert-on:${ink}" aria-label="Certificate of adoption no. ${no}">
    <svg class="cert__guilloche" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${rosette(200, 200, 380)}</svg>
    <header class="cert__head">
      <p class="label">Color Names · Register of Patrons</p>
      <p class="label cert__no">No. ${no}</p>
    </header>
    <h2 class="cert__title">Certificate of Adoption</h2>
    <p class="cert__line">This is to certify that</p>
    <p class="cert__who">${escapeHTML(handle(adopted.by, adopted.on))}</p>
    <p class="cert__line">is the one and only adopter of</p>
    <p class="cert__color"><i class="cert__swatch" aria-hidden="true"></i><span>${escapeHTML(it.name)}</span></p>
    <dl class="cert__facts">${facts.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    <footer class="cert__foot">
      <div class="cert__sign">
        <p class="cert__signature">D. Aerne</p>
        <p class="label">Keeper of the List, Zürich</p>
      </div>
      ${seal(logo)}
    </footer>
    <p class="cert__fine">The color itself stays free for everyone to use, as every name on the list does (MIT). This certificate is not transferable, does not expire, and is worth exactly as much as the warm feeling it gives.</p>
  </article>`;
}
