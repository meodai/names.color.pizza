// who adopted a color: a link to them, and their face for the card's corner
// from this many dollars a color is adopted, its adopter shown
export const ADOPT_FROM = 5;
// the adopt button's heart, in the color itself
export const HEART = `<svg class="hero__heart" viewBox="0 1 24 22" aria-hidden="true"><path class="hero__heart-edge" d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" /><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" /></svg>`;
export const between = (a, b) => a + Math.random() * (b - a);
// each time over an adopt button, its heart swells its own way. Called by the pages that show
// one: this module is also read by the build, where there's no document
let swelling = false;
export function swellHearts() {
  if (swelling) return;
  swelling = true;
  for (const type of ["pointerover", "focusin"])
    document.addEventListener(type, (e) => {
      const a = e.target.closest?.(".adopt-cta, .footer__adopt a, .adopt__cta");
      if (!a?.querySelector(".hero__heart") || a.contains(e.relatedTarget)) return;
      const s = a.style;
      s.setProperty("--heart-scale", between(1.7, 2.5).toFixed(2));
      s.setProperty("--heart-x", `${between(0.8, 1.5).toFixed(2)}em`);
      s.setProperty("--heart-y", `${between(-0.45, 0.1).toFixed(2)}em`);
      s.setProperty("--heart-turn", `${between(-22, 22).toFixed(2)}deg`);
    });
}

export const PROFILES = {
  bluesky: (by) => `https://bsky.app/profile/${by}`,
  github: (by) => `https://github.com/${by}`,
  x: (by) => `https://x.com/${by}`,
  instagram: (by) => `https://www.instagram.com/${by}/`,
  tiktok: (by) => `https://www.tiktok.com/@${by}`,
  twitch: (by) => `https://www.twitch.tv/${by}`,
  linkedin: (by) => `https://www.linkedin.com/in/${by}/`,
  website: (by) => `https://${by}/`,
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
  website: (by) => `domain/${by}`,
};
// a site's address: just its host, and only one that looks like a real domain
const host = (typed) =>
  typed
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#:].*$/, "");
export const isHost = (h) => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h);
// a handle however it was pasted: @name, a profile link, a name
export const ANONYMOUS = "Anonymous";
export const cleanHandle = (typed, on) => {
  if (on === "anonymous") return ANONYMOUS;
  if (on === "name") return typed.trim().slice(0, 60);
  if (on === "website") return host(typed).slice(0, 60);
  const h = typed
    .trim()
    .replace(/^https?:\/\/[^/]+\/(profile\/|in\/)?/, "")
    // without its https://, only a site we know, so a handle like name.bsky.social stays whole
    .replace(
      /^((www|m)\.)?(bsky\.app|github\.com|x\.com|twitter\.com|instagram\.com|tiktok\.com|twitch\.tv|linkedin\.com)\/(profile\/|in\/)?/i,
      "",
    )
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .slice(0, 60);
  // a Bluesky handle without its domain is most likely on bsky.social
  return on === "bluesky" && h && !h.includes(".") ? `${h}.bsky.social` : h;
};
export const longDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

// a handle with its @, a plain name as it was given
export const handle = (by, on) =>
  on === "name" || on === "anonymous" || on === "website" ? by : `@${by.replace(/^@/, "")}`;
// their profile, or just a span for someone who gave a name
const profileLink = ({ by, on }, className) =>
  PROFILES[on]
    ? Object.assign(document.createElement("a"), {
        href: PROFILES[on](by),
        target: "_blank",
        // a bought link is no recommendation
        rel: on === "website" ? "nofollow ugc noopener" : "noopener",
        className,
      })
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
  a.setAttribute(
    "aria-label",
    `${adopted.founding ? "Founding patron" : "Adopted by"} ${handle(adopted.by, adopted.on)}`,
  );
  const initial = () =>
    Object.assign(document.createElement("span"), {
      textContent:
        adopted.on === "anonymous"
          ? "\u2665\uFE0E"
          : handle(adopted.by, adopted.on).replace(/^@/, "")[0]?.toUpperCase() || "?",
    });
  if (!adopted.avatar) a.append(initial());
  else {
    const img = Object.assign(document.createElement("img"), { src: adopted.avatar, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(initial()), { once: true });
    a.append(img);
  }
  return a;
}
