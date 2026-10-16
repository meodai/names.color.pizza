import { converter, formatHex, wcagLuminance } from "culori";
import { getList, hexToRgb, normalizeHex, rgbToOklab, siteURL, slugsOf, cardPlace } from "./names.js";
import { tiltCard } from "./tilt.js";
import { SHINES, ADOPT_FROM, HOLO_FROM, PAYMENT, loadAdoptions } from "./shines.js";
import { UNAVATAR, adopterBadge, cleanHandle, handle, longDate } from "./adopter.js";
import { drawShareCard } from "./share-card.js";

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
    if (found.slug || found.clash) return found;
    await sleep(2000);
  }
  return null;
}

// the parrot in black, as the link preview shows it
function logoSVG() {
  const svg = document.querySelector(".brand__logo").cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("height", "184");
  svg.querySelectorAll("[fill]").forEach((p) => p.getAttribute("fill") !== "#fff" && p.setAttribute("fill", "#000"));
  return svg.outerHTML;
}

// their link preview, drawn here the moment they've paid and handed to the worker,
// so the color's link shows it from now on
async function shareCard(q, it, adopted, session) {
  const blob = await drawShareCard(it, adopted, logoSVG()).catch(() => null);
  if (!blob) return;
  const img = q("[data-share-card]");
  img.src = URL.createObjectURL(blob);
  img.alt = `${it.name}, adopted: the card that shows when its link is shared`;
  img.hidden = false;
  await fetch(`${WORKER}/share?session=${encodeURIComponent(session)}`, { method: "POST", body: blob }).catch(() => null);
}

function shareRow(q, it, slug) {
  // a fresh address, so a site that saw the plain card before fetches the adopted one
  const url = `https://names.color.pizza/color/${slug}/?adopted`;
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
function askWho(q, slugNow, place) {
  const on = q("[data-on]");
  const by = q("[data-by]");
  const cta = q("[data-cta]");
  const note = q("[data-who-note]");
  const label = () => on.selectedOptions[0].textContent;
  let badge;
  let timer;
  let asking;
  const show = (name, avatar) => {
    badge?.remove();
    badge = name ? adopterBadge({ by: name, on: on.value, avatar }) : null;
    if (badge) place.append(badge);
  };
  const update = () => {
    const name = cleanHandle(by.value, on.value);
    by.placeholder = on.value === "name" ? "Your name" : "@handle";
    by.hidden = on.value === "anonymous";
    // not before the account is known to exist
    const lookup = Boolean(name && UNAVATAR[on.value]);
    cta.setAttribute("aria-disabled", String(!name || lookup));
    cta.href = `${PAYMENT}?client_reference_id=${reference(slugNow(), on.value, name)}`;
    clearTimeout(timer);
    asking?.abort();
    timer = setTimeout(async () => {
      note.textContent = "";
      if (!name || !UNAVATAR[on.value]) return show(name);
      asking = new AbortController();
      const res = await fetch(`https://unavatar.io/${UNAVATAR[on.value](encodeURIComponent(name))}?fallback=false`, {
        signal: asking.signal,
      }).catch(() => null);
      if (asking.signal.aborted) return;
      // 404 is unavatar's "nobody by that name"; anything else (busy, offline) says nothing
      if (res?.status === 404) {
        note.textContent = `No ${label()} account called @${name} found. Check the spelling, or pick another way to show you.`;
        return show(null);
      }
      cta.setAttribute("aria-disabled", "false");
      show(name, res?.ok ? URL.createObjectURL(await res.blob()) : undefined);
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
  return { update, clear: () => show(null) };
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
  const [data, answer] = await Promise.all([getList("default"), session ? adoptedBy(session) : null]);
  const slugs = slugsOf(data.items);
  // paid, but someone adopted the color a moment earlier
  const missed = answer?.clash ? answer : null;
  let bought = missed ? null : answer;
  if (session && !answer) {
    q("[data-place]").hidden = true;
    q("[data-lead]").textContent = "Your payment went through. Your color shows up on its page in a minute or two.";
    return;
  }
  const asked = bought?.slug || (missed ? null : new URLSearchParams(location.search).get("c"));
  const hex = normalizeHex(location.hash.slice(1));
  const first = asked ? data.items.find((i) => slugs.get(i.name) === asked) : hex ? closest(data, hex) : null;
  const card = q("[data-card]");
  const place = cardPlace();
  q("[data-place]").style.setProperty("--x", place.x.toFixed(3));
  q("[data-place]").style.setProperty("--y", place.y.toFixed(3));
  q("[data-place]").style.setProperty("--r", `${place.r.toFixed(1)}deg`);
  const tilt = tiltCard(card);
  const adopted = bought ? {} : await loadAdoptions();
  const cta = q("[data-cta]");
  let slug = null;
  let who = null;
  let shown = null;
  // free, taken, missed (paid for one that went to someone else) or bought
  let state = "free";

  // one color on the page; picking another redoes it all
  function show(it) {
    shown = it;
    slug = slugs.get(it.name);
    q("[data-place]").querySelectorAll(".card-badge").forEach((b) => b.remove());
    document.title = `Adopt ${it.name} — Color Names`;
    q("[data-name]").textContent = `Adopt ${it.name}.`;
    q("[data-lead]").textContent = `Be the proud patron of ${it.name}, and keep the list, its API and these pages running for everyone.`;
    const readme = Object.assign(document.createElement("a"), {
      href: "https://github.com/meodai/color-names#sponsors",
      target: "_blank",
      rel: "noopener",
      textContent: "README",
    });
    const supporters = Object.assign(document.createElement("a"), { href: siteURL("supporters/"), textContent: "supporters" });
    q("[data-tier5]").replaceChildren(`your name and picture on ${it.name}, with the `, supporters, " and in the ", readme);
    q("[data-tiers]").hidden = false;
    q("[data-act]").hidden = false;
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
    const teaser = SHINES[[...it.hex].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SHINES.length];
    tilt.holo(teaser);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("swatchcard--visible")));

    // taken already: who has it, and where everyone else is
    const mine = bought || adopted[slug];
    state = bought ? "bought" : mine?.amount >= ADOPT_FROM ? "taken" : missed ? "missed" : "free";
    q("[data-founding]").hidden = state !== "free" || Object.values(adopted).filter((a) => a.amount >= ADOPT_FROM).length >= 50;
    if (mine?.amount >= ADOPT_FROM) {
      who?.clear();
      q("[data-who]").hidden = true;
      q("[data-place]").append(adopterBadge(mine));
      q("[data-tiers]").hidden = true;
      q("[data-note]").textContent = "";
      cta.removeAttribute("aria-disabled");
      tilt.holo(mine.amount >= HOLO_FROM && mine.shine ? mine.shine : null);
      if (bought) {
        q("[data-name]").textContent = `You adopted ${it.name}.`;
        document.title = `You adopted ${it.name} — Color Names`;
        q(".hero__stats").hidden = true;
        q("[data-pick]").hidden = true;
        q("[data-lead]").textContent = `Thank you! ${it.name} carries your name from today, for everyone to see.${
          mine.founding ? " And you're one of the first fifty: a founding patron, for good." : ""
        }`;
        shareRow(q, it, slug);
        shareCard(q, it, mine, session);
        return;
      }
      q("[data-name]").textContent = `${it.name} is adopted.`;
      q("[data-lead]").textContent = `${handle(mine.by, mine.on)} adopted it on ${longDate(mine.at)}. Every color has one adopter: pick another one.`;
      cta.textContent = "See the supporters";
      cta.href = siteURL("supporters/");
      cta.removeAttribute("target");
      return;
    }
    if (state === "missed") {
      const wanted = data.items.find((i) => slugs.get(i.name) === missed.wanted)?.name || "your color";
      document.title = "So close — Color Names";
      q("[data-name]").textContent = "So close.";
      q("[data-lead]").textContent = `Someone adopted ${wanted} moments before you. Pick another free color: your payment carries over.`;
      q("[data-tiers]").hidden = true;
      q("[data-who]").hidden = true;
      q(".hero__stats").hidden = true;
      cta.textContent = `Make ${it.name} mine`;
      cta.href = "#";
      cta.removeAttribute("aria-disabled");
      q("[data-note]").textContent = "";
      return;
    }
    q("[data-who]").hidden = false;
    who ??= askWho(q, () => slug, q("[data-place]"));
    who.update();
  }

  cta.addEventListener("click", async (e) => {
    // the payment that missed goes to this color instead
    if (state === "missed") {
      e.preventDefault();
      cta.setAttribute("aria-disabled", "true");
      const res = await fetch(`${WORKER}/reassign`, { method: "POST", body: JSON.stringify({ session, slug }) }).catch(() => null);
      const got = await res?.json().catch(() => null);
      if (got?.slug) {
        bought = got;
        return show(shown);
      }
      cta.removeAttribute("aria-disabled");
      if (got?.error === "taken") {
        adopted[slug] = { amount: ADOPT_FROM, by: "someone", on: "name" };
        q("[data-note]").textContent = `${shown.name} was just taken too. Pick another.`;
      } else q("[data-note]").textContent = "That didn't go through. Try again, or write to tschou@elastiq.ch.";
      return;
    }
    // one last look before paying: someone may have adopted it since the page opened
    if (state !== "free" || cta.getAttribute("aria-disabled") === "true") return;
    e.preventDefault();
    const go = cta.href;
    const fresh = await loadAdoptions();
    if (fresh[slug]?.amount >= ADOPT_FROM) {
      adopted[slug] = fresh[slug];
      show(shown);
      q("[data-lead]").textContent = `Someone adopted ${shown.name} just now. Every color has one adopter: pick another one.`;
      return;
    }
    location.href = go;
  });

  // no color asked for: the search's color wheel, and the name it lands on
  if (!first || missed) {
    const row = q("[data-pick]");
    const picker = q("[data-picker]");
    const named = q("[data-pick-name]");
    row.hidden = false;
    const pick = (value) => {
      const it = closest(data, value);
      named.textContent = it.name;
      row.style.setProperty("--picked", it.hex);
      show(it);
    };
    picker.addEventListener("input", () => pick(picker.value));
    let start;
    do start = data.items[Math.floor(Math.random() * data.items.length)];
    while (adopted[slugs.get(start.name)]);
    picker.value = start.hex;
    pick(start.hex);
    return;
  }
  show(first);
}
