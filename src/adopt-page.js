import { converter, formatHex, wcagLuminance } from "culori";
import { getList, hexToRgb, normalizeHex, rgbToOklab, siteURL, slugsOf, cardPlace } from "./names.js";
import { tiltCard } from "./tilt.js";
import { SHINES, ADOPT_FROM, HOLO_FROM, PAYMENT, loadAdoptions } from "./shines.js";
import { UNAVATAR, adopterBadge, cleanHandle, handle, longDate } from "./adopter.js";

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

const WORKER = "https://color-names-upload.cloudflare-54bbeb.workers.dev";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stripe sends the buyer back with their checkout, its webhook may land a moment later
async function adoptedBy(session) {
  for (let i = 0; i < 15; i++) {
    const found = await fetch(`${WORKER}/adopted?session=${encodeURIComponent(session)}`)
      .then((r) => r.json())
      .catch(() => ({}));
    if (found.slug) return found;
    await sleep(2000);
  }
  return null;
}

function shareRow(q, it, slug) {
  const url = `https://names.color.pizza/color/${slug}/`;
  const text = `I adopted ${it.name} on Color Names.`;
  q("[data-share-bsky]").href = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`;
  q("[data-share-x]").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  q("[data-share-page]").href = siteURL(`color/${slug}/`);
  q("[data-share-row]").hidden = false;
  const cta = q("[data-cta]");
  cta.textContent = "Share it";
  cta.href = url;
  cta.removeAttribute("target");
  cta.addEventListener("click", async (e) => {
    e.preventDefault();
    if (navigator.share) {
      try {
        await navigator.share({ title: `${it.name} — Color Names`, text, url });
      } catch {} // dismissed
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      cta.textContent = "Link copied";
      setTimeout(() => (cta.textContent = "Share it"), 1500);
    } catch {} // clipboard blocked
  });
}

// [slug, platform, handle] for Stripe's client_reference_id, which takes letters, digits, - and _
function reference(slug, on, by) {
  for (let name = by; ; name = name.slice(0, -1)) {
    const bytes = new TextEncoder().encode(JSON.stringify([slug, on, name]));
    const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (id.length <= 200 || !name) return id;
  }
}

// who they'll be on the card: asked before paying, kept only once Stripe says they paid
function askWho(q, slug, place) {
  const on = q("[data-on]");
  const by = q("[data-by]");
  const cta = q("[data-cta]");
  let badge;
  let timer;
  const update = () => {
    const name = cleanHandle(by.value, on.value);
    by.placeholder = on.value === "name" ? "Your name" : "@handle";
    cta.setAttribute("aria-disabled", String(!name));
    cta.href = `${PAYMENT}?client_reference_id=${reference(slug, on.value, name)}`;
    clearTimeout(timer);
    timer = setTimeout(() => {
      badge?.remove();
      badge = null;
      if (!name) return;
      const avatar = UNAVATAR[on.value] && `https://unavatar.io/${UNAVATAR[on.value](encodeURIComponent(name))}?fallback=false`;
      badge = adopterBadge({ by: name, on: on.value, avatar });
      place.append(badge);
    }, 500);
  };
  on.addEventListener("change", update);
  by.addEventListener("input", update);
  q("[data-who]").addEventListener("submit", (e) => {
    e.preventDefault();
    cta.click();
  });
  cta.addEventListener("click", (e) => {
    if (cta.getAttribute("aria-disabled") !== "true") return;
    e.preventDefault();
    by.focus();
  });
  update();
}

// the color comes as ?c=<slug> or #<hex>, or after paying as ?session=<checkout>;
// its card shows one of the foils it could get
export async function initAdoptPage() {
  const q = (s) => document.querySelector(s);
  const session = new URLSearchParams(location.search).get("session");
  if (session) {
    q("[data-name]").textContent = "Thank you.";
    q("[data-lead]").textContent = "Finding your color…";
    q("[data-tiers]").hidden = true;
    q("[data-act]").hidden = true;
    q("[data-who]").hidden = true;
  }
  const [data, bought] = await Promise.all([getList("default"), session ? adoptedBy(session) : null]);
  const slugs = slugsOf(data.items);
  if (session && !bought) {
    q("[data-place]").hidden = true;
    q("[data-lead]").textContent = "Your payment went through. Your color shows up on its page in a minute or two.";
    return;
  }
  const asked = bought?.slug || new URLSearchParams(location.search).get("c");
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
  cta.textContent = `Adopt ${it.name}`;
  q("[data-note]").textContent = "From 5, paid on Stripe.";
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
  const mine = bought || (await loadAdoptions())[slug];
  if (mine?.amount >= ADOPT_FROM) {
    q("[data-who]").hidden = true;
    q("[data-place]").append(adopterBadge(mine));
    q("[data-tiers]").hidden = true;
    q("[data-act]").hidden = false;
    q("[data-note]").textContent = "";
    tilt.holo(mine.amount >= HOLO_FROM && mine.shine ? mine.shine : null);
    if (bought) {
      q("[data-name]").textContent = `You adopted ${it.name}.`;
      document.title = `You adopted ${it.name} — Color Names`;
      q(".hero__stats").hidden = true;
      q("[data-lead]").textContent = `Thank you! ${it.name} carries your name from today, for everyone to see.`;
      shareRow(q, it, slug);
      return;
    }
    q("[data-name]").textContent = `${it.name} is adopted.`;
    q("[data-lead]").textContent = `${handle(mine.by, mine.on)} adopted it on ${longDate(mine.at)}. Every color has one adopter: pick another one.`;
    cta.textContent = "See the supporters";
    cta.href = siteURL("supporters/");
    cta.removeAttribute("target");
    return;
  }
  askWho(q, slug, q("[data-place]"));
}
