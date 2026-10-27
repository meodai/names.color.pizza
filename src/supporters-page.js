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
  const now = document.querySelector("[data-now]");
  const date = (at) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const square = (c) =>
    `<a class="supporter__color" id="color-${esc(c.slug)}" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)}" title="${esc(c.name)}"></a>`;
  // nobody yet: the first place, waiting
  if (!rows.length) {
    document.querySelector("[data-lead]").textContent =
      "Nobody yet. Become the honourable first patron: your name at the top of this list, and on the color you choose.";
    document.querySelector("[data-cta]").textContent = "Be the first";
    list.innerHTML = `<li class="supporter supporter--ghost is-on" aria-hidden="true">
        <span class="label supporter__rank">01</span>
        <span class="supporter__name">You?</span>
        <span class="supporter__colors">${'<i class="supporter__color"></i>'.repeat(3)}</span>
      </li>`;
    now.innerHTML = `<div class="supporters-board__face">?</div><p class="title title--sub">You?</p>`;
    return;
  }
  // their colors in the order they adopted them
  for (const p of rows) p.colors.sort((x, y) => String(adopted[x.slug].at).localeCompare(adopted[y.slug].at));
  const faceOf = (p, handle) =>
    p.avatar
      ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" />`
      : esc(p.on === "anonymous" ? "\u2665\uFE0E" : handle.replace(/^@/, "")[0]?.toUpperCase() || "?");
  const linkTo = (p, cls, inner) => {
    const href = PROFILES[p.on]?.(p.by);
    return href
      ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="${p.on === "website" ? "nofollow ugc noopener" : "noopener"}">${inner}</a>`
      : `<span class="${cls}">${inner}</span>`;
  };
  // every rank as many digits as the last one
  const digits = String(rows.length).length;
  const number = (rank) => String(rank + 1).padStart(digits, "0");
  list.innerHTML = rows
    .map((p, rank) => {
      const handle = handleOf(p.by, p.on);
      const since = p.colors.map((c) => adopted[c.slug].at).sort()[0];
      return `<li class="supporter" data-i="${rank}" tabindex="-1">
        ${
          // the first three bigger, in the title's style
          rank < 3
            ? `<span class="title title--sub supporter__rank supporter__rank--top">${number(rank)}</span>`
            : `<span class="label supporter__rank">${number(rank)}</span>`
        }
        ${linkTo(p, "supporter__name", esc(handle))}
        <span class="supporter__colors">${p.colors.map(square).join("")}</span>
        <span class="supporter__meta">${p.founding ? '<span class="small supporter__founding" title="One of the first 50 patrons">Founding</span>' : "<span></span>"}<span class="small supporter__since">${since ? esc(date(since)) : ""}</span></span>
      </li>`;
    })
    .join("");
  // the one pointed at, or come to by the keyboard, on the left: first the first
  // their number over them, each digit a strip of 0 to 9 that slides to its own (CSS), so only the
  // digits that change move; the rest drawn anew
  const strip = `<span class="supporters-board__digit">${[..."0123456789"].map((d) => `<i>${d}</i>`).join("")}</span>`;
  now.innerHTML = `<div class="title supporters-board__rank" aria-hidden="true">${strip.repeat(digits)}</div><div class="supporters-board__who"></div>`;
  const places = [...now.querySelectorAll(".supporters-board__digit")];
  const who = now.querySelector(".supporters-board__who");
  // the black of the row shown goes over to the next one from the side it's coming from (CSS)
  let shown = -1;
  const show = (rank) => {
    const p = rows[rank];
    const handle = handleOf(p.by, p.on);
    const down = rank > shown;
    list.children[shown]?.style.setProperty("--from", down ? "bottom" : "top");
    list.children[rank].style.setProperty("--from", down ? "top" : "bottom");
    for (const li of list.children) li.classList.toggle("is-on", Number(li.dataset.i) === rank);
    shown = rank;
    [...number(rank)].forEach((d, k) => places[k].style.setProperty("--d", d));
    who.innerHTML = `<div class="supporters-board__face">${faceOf(p, handle)}</div>
      <p class="lead">${linkTo(p, "supporters-board__name", esc(handle))}</p>
      ${p.founding ? '<p class="label">Founding patron</p>' : ""}
      <ul class="supporters-board__colors">${p.colors
        .map(
          (c) =>
            `<li><a href="${esc(siteURL(`color/${c.slug}/`))}"><i class="supporter__color" style="--c:${esc(c.hex)}"></i><span class="small">${esc(c.name)}</span></a></li>`,
        )
        .join("")}</ul>`;
  };
  const pick = (e) => {
    const li = e.target.closest(".supporter");
    if (li && !li.classList.contains("is-on")) show(Number(li.dataset.i));
  };
  list.addEventListener("pointerover", pick);
  list.addEventListener("focusin", pick);
  show(0);
  // come for one of them (a color's page links its patron here): drawn now, so the page
  // goes there itself, and the row says it's the one
  const asked = location.hash.startsWith("#color-") ? document.getElementById(location.hash.slice(1)) : null;
  const row = asked?.closest(".supporter");
  if (row) {
    row.classList.add("is-asked");
    show(Number(row.dataset.i));
    row.scrollIntoView({ block: "center" });
  } else if (location.hash.length > 1) {
    // a section further down (the adopt page's "What it costs"): the browser went there before
    // the list above it was drawn, which pushed it away
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }
}
