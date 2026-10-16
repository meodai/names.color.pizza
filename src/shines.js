// the kinds of foil an adopted color can get, one of them rolled when it's adopted with 10 or more
export const SHINES = ["prism", "galaxy", "classic", "radiant", "aurora"];
export const ADOPT_FROM = 5;
export const HOLO_FROM = 10;
// the first this many patrons are founding patrons (as in the upload worker)
export const FOUNDING = 50;
// how many colors are adopted, by how many people (the anonymous each count), founding spots left (one a person)
export function counts(adopted) {
  const kept = Object.entries(adopted).filter(([, a]) => a.amount >= ADOPT_FROM);
  const people = new Set(kept.map(([slug, a]) => (a.on === "anonymous" ? `anonymous:${slug}` : `${a.on}:${a.by}`)));
  return { colors: kept.length, patrons: people.size, founding: Math.max(0, FOUNDING - people.size) };
}
// real payments only on the site itself; anywhere else (localhost) is Stripe's test mode
const LIVE = location.hostname === "names.color.pizza";
export const PAYMENT = LIVE
  ? "https://buy.stripe.com/4gMdRa7YhgZ21FPbqI7N600"
  : "https://donate.stripe.com/test_8x25kEenHdR70p121M9k400";
// written by the upload worker the moment Stripe says a color was adopted
export const ADOPTIONS = LIVE
  ? "https://media.color.pizza/data/adopted.json"
  : "https://color-names-upload.cloudflare-54bbeb.workers.dev/adoptions-test";
export const loadAdoptions = () =>
  // the edge would serve an old copy for hours: a fresh address every few seconds
  fetch(`${ADOPTIONS}${ADOPTIONS.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 5000)}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
