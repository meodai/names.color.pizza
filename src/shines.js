// the kinds of foil an adopted color can get, one of them rolled when it's adopted with 10 or more
export const SHINES = ["prism", "galaxy", "classic", "radiant", "aurora"];
export const ADOPT_FROM = 5;
export const HOLO_FROM = 10;
// real payments only on the site itself; anywhere else (localhost) is Stripe's test mode
const LIVE = location.hostname === "names.color.pizza";
export const PAYMENT = LIVE
  ? "https://buy.stripe.com/4gMdRa7YhgZ21FPbqI7N600"
  : "https://donate.stripe.com/test_8x25kEenHdR70p121M9k400";
// written by the upload worker the moment Stripe says a color was adopted
export const ADOPTIONS = `https://media.color.pizza/data/adopted${LIVE ? "" : "-test"}.json`;
export const loadAdoptions = () =>
  fetch(ADOPTIONS, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
