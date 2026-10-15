// who adopted a color: a link to them, and their face for the card's corner
export const PROFILES = {
  bluesky: (by) => `https://bsky.app/profile/${by}`,
  github: (by) => `https://github.com/${by}`,
  x: (by) => `https://x.com/${by}`,
};
export const longDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export const handle = (by) => `@${by.replace(/^@/, "")}`;
const profileLink = ({ by, on }, className) =>
  Object.assign(document.createElement("a"), {
    href: PROFILES[on]?.(by) || "#",
    target: "_blank",
    rel: "noopener",
    className,
  });

// "Adopted <date> by @handle"
export function adoptedHTML(adopted) {
  const a = profileLink(adopted, "hero__adopter");
  a.textContent = handle(adopted.by);
  return [`Adopted ${longDate(adopted.at)} by `, a];
}

// their avatar, or their initial, pinned to the card's corner
export function adopterBadge(adopted) {
  const a = profileLink(adopted, "card-badge");
  a.setAttribute("aria-label", `Adopted by ${handle(adopted.by)}`);
  a.append(
    adopted.avatar
      ? Object.assign(document.createElement("img"), { src: adopted.avatar, alt: "", loading: "lazy" })
      : Object.assign(document.createElement("span"), { textContent: handle(adopted.by)[1]?.toUpperCase() || "?" }),
  );
  return a;
}
