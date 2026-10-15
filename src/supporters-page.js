import { siteURL } from "./names.js";

const PROFILES = {
  bluesky: (by) => `https://bsky.app/profile/${by}`,
  github: (by) => `https://github.com/${by}`,
  x: (by) => `https://x.com/${by}`,
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// one row per person, by everything they gave, with the colors they adopted
export async function initSupportersPage() {
  const list = document.querySelector("[data-supporters]");
  const adopted = await fetch(siteURL("adopted.json"))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  const people = new Map();
  for (const [slug, a] of Object.entries(adopted)) {
    const key = `${a.on}:${a.by}`;
    const p = people.get(key) || { ...a, total: 0, colors: [] };
    p.total += a.amount;
    p.avatar ||= a.avatar;
    p.colors.push({ slug, name: a.name || slug, hex: a.hex || "#888" });
    people.set(key, p);
  }
  const rows = [...people.values()].sort((x, y) => y.total - x.total);
  list.innerHTML = rows
    .map((p) => {
      const handle = `@${p.by.replace(/^@/, "")}`;
      const face = p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" />` : `<span>${esc(handle[1]?.toUpperCase() || "?")}</span>`;
      return `<li class="supporter">
        <a class="card-badge supporter__face" href="${esc(PROFILES[p.on]?.(p.by) || "#")}" target="_blank" rel="noopener">${face}</a>
        <a class="supporter__name" href="${esc(PROFILES[p.on]?.(p.by) || "#")}" target="_blank" rel="noopener">${esc(handle)}</a>
        <span class="supporter__colors">${p.colors
          .map((c) => `<a class="supporter__color" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)}">${esc(c.name)}</a>`)
          .join("")}</span>
      </li>`;
    })
    .join("");
}
