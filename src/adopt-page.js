import { converter, formatHex, wcagLuminance } from "culori";
import { getList, hexToRgb, normalizeHex, rgbToOklab, siteURL, slugsOf, cardPlace } from "./names.js";
import { tiltCard } from "./tilt.js";
import { SHINES, ADOPT_FROM, HOLO_FROM, PAYMENT, loadAdoptions } from "./shines.js";
import { adopterBadge, handle, longDate } from "./adopter.js";

const toLab = converter("lab");
const shade = (hex, amount) => {
  const lab = toLab(hex);
  return formatHex({ ...lab, l: Math.max(0, Math.min(100, lab.l + amount)) });
};

function closest(data, hex) {
  const exact = data.byHex.get(hex);
  if (exact) return exact;
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  let best = null;
  let bd = Infinity;
  for (const it of data.items) {
    const d = (it.L - L) ** 2 + (it.a - a) ** 2 + (it.b - b) ** 2;
    if (d < bd) [best, bd] = [it, d];
  }
  return best;
}

// the color comes as ?c=<slug> or #<hex>; its card shows one of the foils it could get
export async function initAdoptPage() {
  const q = (s) => document.querySelector(s);
  const data = await getList("default");
  const slugs = slugsOf(data.items);
  const asked = new URLSearchParams(location.search).get("c");
  const hex = normalizeHex(location.hash.slice(1));
  const it = asked ? data.items.find((i) => slugs.get(i.name) === asked) : hex ? closest(data, hex) : null;
  const card = q("[data-card]");
  if (!it) {
    q("[data-place]").hidden = true;
    q("[data-note]").textContent = "Pick a color first: every color page has an Adopt link.";
    return;
  }
  const slug = slugs.get(it.name);
  document.title = `Adopt ${it.name} — Color Names`;
  q("[data-name]").textContent = `Adopt ${it.name}.`;
  q("[data-tier5]").textContent = `your name and picture on ${it.name}, and in the README`;
  // Stripe hands the color back with the payment
  const cta = q("[data-cta]");
  cta.href = `${PAYMENT}?client_reference_id=${slug}`;
  cta.textContent = `Adopt ${it.name}`;
  q("[data-note]").textContent = "From 5, on Stripe. You'll be asked how to show you: Bluesky, GitHub, X or just a name.";
  q("[data-close]").href = siteURL(`color/${slug}/`);

  const dark = wcagLuminance(it.hex) < 0.5;
  card.style.setProperty("--c-color", it.hex);
  card.style.setProperty("--c-shade0", shade(it.hex, dark ? 25 : -25));
  card.style.setProperty("--c-shade1", shade(it.hex, dark ? 12 : -12));
  const glow = wcagLuminance(it.hex);
  card.dataset.tone = glow > 0.8 ? "light" : glow < 0.04 ? "dark" : "mid";
  q("[data-value]").textContent = it.hex;
  q("[data-card-name]").textContent = it.name;
  const place = cardPlace();
  q("[data-place]").style.setProperty("--x", place.x.toFixed(3));
  q("[data-place]").style.setProperty("--y", place.y.toFixed(3));
  q("[data-place]").style.setProperty("--r", `${place.r.toFixed(1)}deg`);
  const tilt = tiltCard(card);
  const teaser = SHINES[[...it.hex].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SHINES.length];
  tilt.holo(teaser);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("swatchcard--visible")));

  // taken already: who has it, and where everyone else is
  const adopted = await loadAdoptions();
  const mine = adopted[slug];
  if (mine?.amount >= ADOPT_FROM) {
    q("[data-name]").textContent = `${it.name} is adopted.`;
    q("[data-lead]").textContent = `${handle(mine.by, mine.on)} adopted it on ${longDate(mine.at)}. Every color has one adopter: pick another one.`;
    q("[data-place]").append(adopterBadge(mine));
    q("[data-tiers]").hidden = true;
    cta.textContent = "See the supporters";
    cta.href = siteURL("supporters/");
    cta.removeAttribute("target");
    q("[data-note]").textContent = "";
    tilt.holo(mine.amount >= HOLO_FROM && mine.shine ? mine.shine : null);
  }
}
