import { getList, siteURL, slugsOf } from "./names.js";
import { loadAdoptions } from "./shines.js";

const PROFILES = {
  bluesky: (by) => `https://bsky.app/profile/${by}`,
  github: (by) => `https://github.com/${by}`,
  x: (by) => `https://x.com/${by}`,
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// one row per person, by everything they gave, with the colors they adopted
export async function initSupportersPage() {
  const list = document.querySelector("[data-supporters]");
  const [adopted, data] = await Promise.all([loadAdoptions(), getList("default")]);
  const slugs = slugsOf(data.items);
  const names = Object.fromEntries(data.items.map((it) => [slugs.get(it.name), it]));
  const people = new Map();
  for (const [slug, a] of Object.entries(adopted)) {
    const key = `${a.on}:${a.by}`;
    const p = people.get(key) || { ...a, total: 0, colors: [] };
    p.total += a.amount;
    p.avatar ||= a.avatar;
    p.colors.push({ slug, name: names[slug]?.name || slug, hex: names[slug]?.hex || "#888" });
    people.set(key, p);
  }
  const rows = [...people.values()].sort((x, y) => y.total - x.total);
  list.innerHTML = rows
    .map((p) => {
      const handle = p.on === "name" ? p.by : `@${p.by.replace(/^@/, "")}`;
      const href = PROFILES[p.on]?.(p.by);
      const wrap = (cls, inner) =>
        href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
      const face = p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" />` : `<span>${esc(handle.replace(/^@/, "")[0]?.toUpperCase() || "?")}</span>`;
      return `<li class="supporter">
        ${wrap("card-badge supporter__face", face)}
        ${wrap("supporter__name", esc(handle))}
        <span class="supporter__colors">${p.colors
          .map((c) => `<a class="supporter__color" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)}">${esc(c.name)}</a>`)
          .join("")}</span>
      </li>`;
    })
    .join("");
}
