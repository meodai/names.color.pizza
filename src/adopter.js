// who adopted a color: a link to them, and their face for the card's corner
export const PROFILES = {
  bluesky: (by) => `https://bsky.app/profile/${by}`,
  github: (by) => `https://github.com/${by}`,
  x: (by) => `https://x.com/${by}`,
  instagram: (by) => `https://www.instagram.com/${by}/`,
  tiktok: (by) => `https://www.tiktok.com/@${by}`,
  twitch: (by) => `https://www.twitch.tv/${by}`,
  linkedin: (by) => `https://www.linkedin.com/in/${by}/`,
};
// where unavatar finds their picture; the upload worker keeps a copy once they've paid
export const UNAVATAR = {
  bluesky: (by) => `bluesky/${by}`,
  github: (by) => `github/${by}`,
  x: (by) => `x/${by}`,
  instagram: (by) => `instagram/${by}`,
  tiktok: (by) => `tiktok/${by}`,
  twitch: (by) => `twitch/${by}`,
  linkedin: (by) => `linkedin/user:${by}`,
};
// a handle however it was pasted: @name, a profile link, a name
export const ANONYMOUS = "Anonymous";
export const cleanHandle = (typed, on) => {
  if (on === "anonymous") return ANONYMOUS;
  if (on === "name") return typed.trim().slice(0, 60);
  const h = typed
    .trim()
    .replace(/^https?:\/\/[^/]+\/(profile\/|in\/)?/, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .slice(0, 60);
  // a Bluesky handle without its domain is most likely on bsky.social
  return on === "bluesky" && h && !h.includes(".") ? `${h}.bsky.social` : h;
};
export const longDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// a handle with its @, a plain name as it was given
export const handle = (by, on) => (on === "name" || on === "anonymous" ? by : `@${by.replace(/^@/, "")}`);
// their profile, or just a span for someone who gave a name
const profileLink = ({ by, on }, className) =>
  PROFILES[on]
    ? Object.assign(document.createElement("a"), { href: PROFILES[on](by), target: "_blank", rel: "noopener", className })
    : Object.assign(document.createElement("span"), { className });

// "Adopted <date> by @handle"
export function adoptedHTML(adopted) {
  const a = profileLink(adopted, "hero__adopter");
  a.textContent = handle(adopted.by, adopted.on);
  return [`Adopted ${longDate(adopted.at)} by `, a, ...(adopted.founding ? [", founding patron"] : [])];
}

// their avatar, or their initial, pinned to the card's corner
export function adopterBadge(adopted) {
  // the first fifty wear gold
  const a = profileLink(adopted, adopted.founding ? "card-badge card-badge--founding" : "card-badge");
  a.setAttribute("aria-label", `${adopted.founding ? "Founding patron" : "Adopted by"} ${handle(adopted.by, adopted.on)}`);
  const initial = () =>
    Object.assign(document.createElement("span"), {
      textContent: adopted.on === "anonymous" ? "\u2665\uFE0E" : handle(adopted.by, adopted.on).replace(/^@/, "")[0]?.toUpperCase() || "?",
    });
  if (!adopted.avatar) a.append(initial());
  else {
    const img = Object.assign(document.createElement("img"), { src: adopted.avatar, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(initial()), { once: true });
    a.append(img);
  }
  return a;
}
