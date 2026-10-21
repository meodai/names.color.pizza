import { converter, formatHex, wcagLuminance } from "culori";
import { getList, hexToRgb, normalizeHex, rgbToOklab, siteURL, slugsOf, cardPlace } from "./names.js";
import { tiltCard } from "./tilt.js";
import { certificateHTML } from "./certificate.js";
import { SHINES, ADOPT_FROM, HOLO_FROM, PAYMENT, counts, fillCostsBar, loadAdoptions } from "./shines.js";
import { HEART, UNAVATAR, adopterBadge, cleanHandle, handle, isHost, longDate, swellHearts } from "./adopter.js";
import { drawShareCard } from "./share-card.js";
import { PROJECTS } from "./projects.js";

// the button's words, then the heart in the color it adopts
swellHearts();
const heartCTA = (cta, text, hex) => {
  cta.textContent = text;
  cta.insertAdjacentHTML("beforeend", HEART);
  cta.style.setProperty("--page-color", hex);
};

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

// the parrot's shapes for the certificate's seal: in the seal's ink, its eye in the color
function sealParrot() {
  const svg = document.querySelector(".brand__logo").cloneNode(true);
  svg
    .querySelectorAll("[fill]")
    .forEach((p) => p.setAttribute("fill", p.getAttribute("fill") === "#fff" ? "var(--cert-c)" : "currentColor"));
  return svg.innerHTML;
}

// the certificate under the thanks, numbered by its place in the register
async function certificate(q, it, slug, mine) {
  const all = await loadAdoptions();
  const keys = Object.keys(all).filter((k) => all[k].amount >= ADOPT_FROM);
  const number = (keys.includes(slug) ? keys.indexOf(slug) : keys.length) + 1;
  const glow = wcagLuminance(it.hex);
  const ink = glow > 0.4 ? "#000" : "#fff";
  const dark = glow < 0.5;
  const shades = [shade(it.hex, dark ? 25 : -25), shade(it.hex, dark ? 12 : -12)];
  // near white the color alone would vanish on the paper, near black it would shout:
  // lines and the parrot then take a darker shade of it, or step back
  const tone = glow > 0.8 ? "light" : glow < 0.04 ? "dark" : "mid";
  const deeper = shade(it.hex, -30);
  const look = {
    tone,
    line: tone === "light" ? deeper : it.hex,
    parrot: tone === "dark" ? shade(it.hex, 35) : ink === "#fff" ? "#fff" : deeper,
    key: tone === "dark" ? "#fff" : "#000",
  };
  const el = q("[data-cert]");
  el.innerHTML = `${certificateHTML({ it, adopted: mine, number, logo: sealParrot(), ink, shades, look })}
    <p class="adopt__share cert__print"><button type="button" data-cert-print>Print it</button></p>`;
  el.hidden = false;
  el.querySelector("[data-cert-print]").addEventListener("click", () => print());
  const link = Object.assign(document.createElement("a"), { href: "#certificate", textContent: "Your certificate" });
  link.addEventListener("click", (e) => {
    e.preventDefault();
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  q("[data-note]").replaceChildren(link);
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
  await fetch(`${WORKER}/share?session=${encodeURIComponent(session)}`, { method: "POST", body: blob }).catch(
    () => null,
  );
}

function shareRow(q, it, slug) {
  // a fresh address, so a site that saw the plain card before fetches the adopted one
  const url = `https://names.color.pizza/color/${slug}/?adopted`;
  const text = `I adopted ${it.name} on Color Names.`;
  q("[data-share-bsky]").href = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`;
  q("[data-share-x]").href =
    `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
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
    const id = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (id.length <= 200 || !name) return id;
  }
}

// their picture for the preview, and whether they exist: Bluesky and GitHub ask their own
// open APIs; the rest unavatar, free and so only so many times a day for each visitor
// (busy or offline says nothing either way)
async function lookup(on, name, signal) {
  const json = (url) =>
    fetch(url, { signal })
      .then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null }))
      .catch(() => ({ status: 0 }));
  if (on === "bluesky") {
    const r = await json(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(name)}`,
    );
    return { missing: r.status === 400 || r.status === 404, src: r.body?.avatar };
  }
  if (on === "github") {
    const r = await json(`https://api.github.com/users/${encodeURIComponent(name)}`);
    return { missing: r.status === 404, src: r.body?.avatar_url };
  }
  const res = await fetch(`https://unavatar.io/${UNAVATAR[on](encodeURIComponent(name))}?fallback=false`, {
    signal,
  }).catch(() => null);
  return { missing: res?.status === 404, src: res?.ok ? URL.createObjectURL(await res.blob()) : undefined };
}

// who they'll be on the card: asked before paying, kept only once Stripe says they paid
function askWho(q, slugNow, place) {
  const on = q("[data-on]");
  const by = q("[data-by]");
  const byBox = q("[data-by-box]");
  const cta = q("[data-cta]");
  const note = q("[data-who-note]");
  const label = () => on.selectedOptions[0].textContent.trim();
  let badge;
  let mini;
  let timer;
  let asking;
  const show = (name, avatar) => {
    badge?.remove();
    mini?.remove();
    badge = name ? adopterBadge({ by: name, on: on.value, avatar }) : null;
    if (!badge) return;
    place.append(badge);
    // on a phone the card is out of sight above, so the field shows who was found too
    mini = adopterBadge({ by: name, on: on.value, avatar });
    byBox.append(mini);
  };
  const update = () => {
    const name = cleanHandle(by.value, on.value);
    by.placeholder = on.value === "name" ? "Your name" : on.value === "website" ? "example.com" : "@handle";
    byBox.hidden = on.value === "anonymous";
    // not before the account is known to exist; a site only needs a real address
    const site = on.value === "website";
    const checking = Boolean(name && UNAVATAR[on.value] && !site);
    cta.setAttribute("aria-disabled", String(!name || checking || (site && !isHost(name))));
    cta.href = `${PAYMENT}?client_reference_id=${reference(slugNow(), on.value, name)}`;
    clearTimeout(timer);
    asking?.abort();
    timer = setTimeout(async () => {
      note.textContent = "";
      if (on.value === "website" && name && !isHost(name)) {
        note.textContent = "That doesn’t look like a website address, like example.com.";
        return show(null);
      }
      if (!name || !UNAVATAR[on.value]) return show(name);
      asking = new AbortController();
      const found = await lookup(on.value, name, asking.signal);
      if (asking.signal.aborted) return;
      if (found.missing && on.value !== "website") {
        note.textContent = `No ${label()} account called @${name} found. Check the spelling, or pick another way to show you.`;
        return show(null);
      }
      cta.setAttribute("aria-disabled", "false");
      show(name, found.src);
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

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// the studio's other projects, one under another; the side card steps
// aside while they're in view
function moreProjects(q) {
  q("[data-projects]").innerHTML = PROJECTS.map(
    (p) =>
      `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a> <small>${p.year}</small><p>${esc(p.about)}</p></li>`,
  ).join("");
  // the card steps aside for the certificate and the footer
  const place = q("[data-place]");
  const over = new Set();
  const away = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => (e.isIntersecting ? over.add(e.target) : over.delete(e.target)));
      place.classList.toggle("is-away", over.size > 0);
    },
    { threshold: 0.05 },
  );
  away.observe(q("[data-cert]"));
  away.observe(q("[data-more]"));
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
  moreProjects(q);
  // paid, but someone adopted the color a moment earlier
  const missed = answer?.clash ? answer : null;
  let bought = missed ? null : answer;
  if (session && !answer) {
    q("[data-place]").hidden = true;
    q("[data-lead]").textContent = "Your payment went through. Your color shows up on its page in a minute or two.";
    return;
  }
  const params = new URLSearchParams(location.search);
  const asked = bought?.slug || (missed ? null : params.get("c"));
  const named = !missed && params.get("name");
  const hex = normalizeHex(location.hash.slice(1));
  // only named colors can be adopted: a hex goes to its closest name
  const first = asked
    ? data.items.find((i) => slugs.get(i.name) === asked)
    : named
      ? data.items.find((i) => i.name === named)
      : hex
        ? closest(data, hex)
        : null;
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

  // a color taken already: the free ones nearest it, to adopt instead
  const othersEl = Object.assign(document.createElement("p"), { className: "adopt__others", hidden: true });
  q("[data-act]").before(othersEl);
  function others(it) {
    othersEl.hidden = !it;
    if (!it) return;
    const near = data.items
      .filter((o) => !(adopted[slugs.get(o.name)]?.amount >= ADOPT_FROM))
      .map((o) => [o, (o.L - it.L) ** 2 + (o.a - it.a) ** 2 + (o.b - it.b) ** 2])
      .sort((x, y) => x[1] - y[1])
      .slice(0, 6);
    othersEl.replaceChildren(
      "Free and close by: ",
      ...near.flatMap(([o], k) => {
        const a = Object.assign(document.createElement("a"), {
          className: "adopt__named",
          href: `?c=${encodeURIComponent(slugs.get(o.name))}`,
          textContent: o.name,
        });
        a.style.setProperty("--c", o.hex);
        a.addEventListener("click", (e) => {
          e.preventDefault();
          history.replaceState(history.state, "", a.href);
          show(o);
        });
        return k ? [", ", a] : [a];
      }),
    );
  }

  // one color on the page; picking another redoes it all
  function show(it) {
    shown = it;
    slug = slugs.get(it.name);
    q("[data-place]")
      .querySelectorAll(".card-badge")
      .forEach((b) => b.remove());
    document.title = `Adopt ${it.name} — Color Names`;
    q("[data-name]").textContent = `Adopt ${it.name}.`;
    q("[data-lead]").textContent =
      `Be the one and only patron of ${it.name}: every color can be adopted just once. It keeps the list, its API and these pages running for everyone.`;
    const readme = Object.assign(document.createElement("a"), {
      href: "https://github.com/meodai/color-names#sponsors",
      target: "_blank",
      rel: "noopener",
      textContent: "README",
    });
    const supporters = Object.assign(document.createElement("a"), {
      href: siteURL("supporters/"),
      textContent: "supporters",
    });
    // the color named, with a dot of it
    const named = Object.assign(document.createElement("span"), { className: "adopt__named", textContent: it.name });
    named.style.setProperty("--c", it.hex);
    q("[data-tier5]").replaceChildren(
      "your name and picture on ",
      named,
      ", with the ",
      supporters,
      " and in the ",
      readme,
    );
    q("[data-tiers]").hidden = false;
    q("[data-act]").hidden = false;
    heartCTA(cta, `Adopt ${it.name}`, it.hex);
    q("[data-note]").textContent = "From $5, paid on Stripe.";
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
    state = bought ? "bought" : missed ? "missed" : mine?.amount >= ADOPT_FROM ? "taken" : "free";
    const left = counts(adopted).founding;
    q("[data-founding]").hidden = state !== "free" || !left;
    q("[data-founding-left]").textContent = left === 1 ? "The last spot is open." : `${left} of 50 spots left.`;
    // where the money goes, beside the choice
    const raised = Object.values(adopted).reduce((sum, a) => sum + (a.amount || 0), 0);
    const bar = q("[data-costs-bar]");
    bar.hidden = state !== "free" || !raised;
    if (raised) fillCostsBar(bar, raised);
    others(state === "taken" ? it : null);
    if (state === "taken" || state === "bought") {
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
          mine.founding ? " And you’re one of the first fifty: a founding patron, for good." : ""
        }`;
        shareRow(q, it, slug);
        shareCard(q, it, mine, session);
        certificate(q, it, slug, mine);
        return;
      }
      q("[data-name]").textContent = `${it.name} is adopted.`;
      q("[data-lead]").textContent =
        `${handle(mine.by, mine.on)} adopted it on ${longDate(mine.at)}. Every color has one adopter: pick another one.`;
      cta.textContent = "See the supporters";
      cta.href = siteURL("supporters/");
      cta.removeAttribute("target");
      return;
    }
    if (state === "missed") {
      const wanted = data.items.find((i) => slugs.get(i.name) === missed.wanted)?.name || "your color";
      document.title = "So close — Color Names";
      q("[data-name]").textContent = "So close.";
      q("[data-lead]").textContent =
        `Someone adopted ${wanted} moments before you. Pick another free color: your payment carries over.`;
      q("[data-tiers]").hidden = true;
      q("[data-who]").hidden = true;
      q(".hero__stats").hidden = true;
      // one taken meanwhile can't be picked; the next can
      const gone = mine?.amount >= ADOPT_FROM;
      heartCTA(cta, `Make ${it.name} mine`, it.hex);
      cta.href = "#";
      cta.setAttribute("aria-disabled", String(gone));
      q("[data-note]").textContent = gone ? `${it.name} is taken. Pick another.` : "";
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
      // one ask at a time: a second click while it's on its way would undo the first's answer
      if (cta.getAttribute("aria-disabled") === "true") return;
      cta.setAttribute("aria-disabled", "true");
      const res = await fetch(`${WORKER}/reassign`, { method: "POST", body: JSON.stringify({ session, slug }) }).catch(
        () => null,
      );
      const got = await res?.json().catch(() => null);
      if (got?.slug) {
        bought = got;
        return show(shown);
      }
      cta.removeAttribute("aria-disabled");
      if (got?.error === "taken") {
        adopted[slug] = { amount: ADOPT_FROM, by: "someone", on: "name" };
        show(shown);
        q("[data-note]").textContent = `${shown.name} was just taken too. Pick another.`;
      } else q("[data-note]").textContent = "That didn’t go through. Try again, or write to tschou@elastiq.ch.";
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
      q("[data-lead]").textContent =
        `Someone adopted ${shown.name} just now. Every color has one adopter: pick another one.`;
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
