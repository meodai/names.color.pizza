import { getList, siteURL, slugsOf } from "./names.js";
import { counts, fillCostsBar, loadAdoptions } from "./shines.js";
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
  const n = counts(adopted);
  const raised = rows.reduce((sum, p) => sum + p.total, 0);
  const bar = document.querySelector("[data-costs-bar]");
  if (bar && raised) {
    fillCostsBar(bar, raised);
    bar.hidden = false;
  }
  const stats = document.querySelector("[data-counts]");
  const plural = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;
  stats.innerHTML = [
    ...(n.colors
      ? [`<span>${plural(n.colors, "color", "colors")} adopted by ${plural(n.patrons, "patron", "patrons")}</span>`]
      : []),
    // all of it together, never one person's share
    ...(n.colors ? [`<span>$${raised.toLocaleString("en-US")} raised</span>`] : []),
    // the founding spots while there are some; once they're all gone the badges tell it
    ...(n.founding
      ? [`<span>${n.founding === 50 ? "All 50 founding spots open" : `${n.founding} of 50 founding spots left`}</span>`]
      : []),
  ].join("");
  stats.hidden = false;
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
        href
          ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="${p.on === "website" ? "nofollow ugc noopener" : "noopener"}">${inner}</a>`
          : `<span class="${cls}">${inner}</span>`;
      const face = p.avatar
        ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" />`
        : `<span>${p.on === "anonymous" ? "\u2665\uFE0E" : esc(handle.replace(/^@/, "")[0]?.toUpperCase() || "?")}</span>`;
      return `<li class="supporter">
        <span class="supporter__rank">#${rank + 1}</span>
        ${wrap(`card-badge supporter__face${p.founding ? " card-badge--founding" : ""}`, face)}
        <span class="supporter__who">${wrap("supporter__name", esc(handle))}${p.founding ? '<span class="supporter__founding" title="One of the first 50 patrons">Founding patron</span>' : ""}</span>
        <span class="supporter__colors">${p.colors
          .map(
            (c) =>
              `<a class="supporter__color" id="color-${esc(c.slug)}" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)};--r:${lean(c.slug).toFixed(2)}" title="${esc(c.name)}"><i></i><b>${esc(c.hex)}</b><span>${esc(c.name)}</span></a>`,
          )
          .join("")}</span>
      </li>`;
    })
    .join("");
  // come for one of them (a color's page links its patron here): drawn now, so the page
  // goes there itself, and the row says it's the one
  const asked = location.hash.startsWith("#color-") ? document.getElementById(location.hash.slice(1)) : null;
  const row = asked?.closest(".supporter");
  if (row) {
    row.classList.add("is-asked");
    row.scrollIntoView({ block: "center" });
  } else if (location.hash.length > 1) {
    // a section further down (the adopt page's "What it costs"): the browser went there before
    // the list above it was drawn, which pushed it away
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }
}
