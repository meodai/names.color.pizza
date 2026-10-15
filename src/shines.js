// the kinds of foil an adopted color can get, one of them rolled when it's adopted with 10 or more
export const SHINES = ["prism", "galaxy", "classic", "radiant", "aurora"];
export const ADOPT_FROM = 5;
export const HOLO_FROM = 10;
// written by the upload worker the moment Stripe says a color was adopted
export const ADOPTIONS = "https://media.color.pizza/data/adopted.json";
export const loadAdoptions = () =>
  fetch(ADOPTIONS, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
