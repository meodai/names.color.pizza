import { ADOPT_FROM } from "./adopter.js";

// the kinds of foil an adopted color can get, one of them rolled when it's adopted with 10 or more
export const SHINES = ["prism", "galaxy", "classic", "radiant", "aurora", "nova", "gold", "glitter"];
export { ADOPT_FROM };
// what a year of running it all costs (supporters/index.html has the parts)
export const RUNNING_A_YEAR = 980;
export const HOLO_FROM = 10;
// what the patrons gave so far against a year of running it: each year covered fills one of
// the ten lines above the bar, from last year back, and the bar starts over on the next
export function fillCostsBar(bar, raised) {
  const years = Math.min(10, Math.floor(raised / RUNNING_A_YEAR));
  const k = years === 10 ? 1 : (raised % RUNNING_A_YEAR) / RUNNING_A_YEAR;
  bar.style.setProperty("--k", k.toFixed(3));
  const now = new Date().getFullYear();
  bar.querySelectorAll("[data-costs-years] li").forEach((l, i) => {
    l.classList.toggle("is-full", 9 - i < years);
    l.dataset.year = now - 10 + i;
  });
  const dollars = (v) => `$${v.toLocaleString("en-US")}`;
  bar.querySelector("[data-costs-note]").textContent = years
    ? `${dollars(raised)} from patrons so far: ${years === 1 ? "a year" : `${years} years`} of running it covered`
    : `${dollars(raised)} of a year’s ${dollars(RUNNING_A_YEAR)} covered by patrons so far`;
}
// the first this many patrons are founding patrons (as in the upload worker)
export const FOUNDING = 50;
// how many colors are adopted, by how many people (the anonymous each count), founding spots left (one a person)
export function counts(adopted) {
  const kept = Object.entries(adopted).filter(([, a]) => a.amount >= ADOPT_FROM);
  const people = new Set(kept.map(([slug, a]) => (a.on === "anonymous" ? `anonymous:${slug}` : `${a.on}:${a.by}`)));
  return { colors: kept.length, patrons: people.size, founding: Math.max(0, FOUNDING - people.size) };
}
// real payments only on the site itself; anywhere else (localhost) is Stripe's test mode
const LIVE = typeof location !== "undefined" && location.hostname === "names.color.pizza";
export const PAYMENT = LIVE
  ? "https://buy.stripe.com/4gMdRa7YhgZ21FPbqI7N600"
  : "https://donate.stripe.com/test_8x25kEenHdR70p121M9k400";
// written by the upload worker the moment Stripe says a color was adopted. Anywhere else the
// test payments' own; ?live in the address reads the site's real patrons there too (to see
// pages as they are), paying staying a test
const REAL = LIVE || (typeof location !== "undefined" && new URLSearchParams(location.search).has("live"));
export const ADOPTIONS = LIVE
  ? "https://media.color.pizza/data/adopted.json"
  : REAL
    ? // through the local server's /media, the bucket reading only to the site itself (vite.config.js)
      `${location.origin}/media/data/adopted.json`
    : "https://color-names-upload.cloudflare-54bbeb.workers.dev/adoptions-test";
export const loadAdoptions = () =>
  // the edge would serve an old copy for hours: a fresh address every few seconds
  fetch(`${ADOPTIONS}${ADOPTIONS.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 5000)}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
