import { getList, siteURL, slugsOf } from "./names.js";
import { loadAdoptions } from "./shines.js";
import { PROFILES, handle as handleOf } from "./adopter.js";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// one row per person, by everything they gave, with the colors they adopted
export async function initSupportersPage() {
  const list = document.querySelector("[data-supporters]");
  const [adopted, data] = await Promise.all([loadAdoptions(), getList("default")]);
  const slugs = slugsOf(data.items);
  const names = Object.fromEntries(data.items.map((it) => [slugs.get(it.name), it]));
  const people = new Map();
  for (const [slug, a] of Object.entries(adopted)) {
    // the anonymous aren't one person
    const key = a.on === "anonymous" ? `anonymous:${slug}` : `${a.on}:${a.by}`;
    const p = people.get(key) || { ...a, total: 0, colors: [] };
    p.total += a.amount;
    p.avatar ||= a.avatar;
    p.founding ||= a.founding;
    p.colors.push({ slug, name: names[slug]?.name || slug, hex: names[slug]?.hex || "#888" });
    people.set(key, p);
  }
  const rows = [...people.values()].sort((x, y) => y.total - x.total);
  // nobody yet: the first place, waiting
  if (!rows.length) {
    document.querySelector("[data-lead]").textContent =
      "Nobody yet. Become the honourable first patron: your name at the top of this list, and on the color you choose.";
    document.querySelector("[data-cta]").textContent = "Be the first";
    list.innerHTML = `<li class="supporter supporter--ghost" aria-hidden="true">
        <span class="supporter__rank">#1</span>
        <span class="card-badge supporter__face"><span>?</span></span>
        <span class="supporter__name">You?</span>
        <span class="supporter__colors">${[0.4, 1.3, 0.9].map((r) => `<i class="supporter__color" style="--r:${r}"><i></i></i>`).join("")}</span>
      </li>`;
    return;
  }
  // a steady lean per color, so a reload doesn't reshuffle the stack
  const lean = (slug) => ([...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000) / 500;
  list.innerHTML = rows
    .map((p, rank) => {
      const handle = handleOf(p.by, p.on);
      const href = PROFILES[p.on]?.(p.by);
      const wrap = (cls, inner) =>
        href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
      const face = p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" />` : `<span>${p.on === "anonymous" ? "\u2665\uFE0E" : esc(handle.replace(/^@/, "")[0]?.toUpperCase() || "?")}</span>`;
      return `<li class="supporter">
        <span class="supporter__rank">#${rank + 1}</span>
        ${wrap(`card-badge supporter__face${p.founding ? " card-badge--founding" : ""}`, face)}
        <span class="supporter__who">${wrap("supporter__name", esc(handle))}${p.founding ? '<span class="supporter__founding">Founding patron</span>' : ""}</span>
        <span class="supporter__colors">${p.colors
          .map(
            (c) =>
              `<a class="supporter__color" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)};--r:${lean(c.slug).toFixed(2)}" title="${esc(c.name)}"><i></i><b>${esc(c.hex)}</b><span>${esc(c.name)}</span></a>`,
          )
          .join("")}</span>
      </li>`;
    })
    .join("");
}
