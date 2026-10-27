import { getList, siteURL, slugsOf } from "./names.js";
import { HOLO_FROM, counts, fillCostsBar, loadAdoptions } from "./shines.js";
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
  // the counts, each a big figure over what it counts
  const figure = (value, what) =>
    `<div><dt class="label">${what}</dt><dd class="title title--sub supporters-board__figure">${value}</dd></div>`;
  const plural = (k, one, many) => (k === 1 ? one : many);
  // the founding spots while there are some; once they're all gone the badges tell it
  const founding = n.founding
    ? n.founding === 50
      ? "All 50 founding spots open"
      : `${n.founding} of 50 founding spots left`
    : "";
  stats.innerHTML = n.colors
    ? [
        figure(n.colors.toLocaleString("en-US"), `${plural(n.colors, "Color", "Colors")} adopted`),
        figure(
          n.patrons.toLocaleString("en-US"),
          [plural(n.patrons, "Patron", "Patrons"), founding].filter(Boolean).join(" · "),
        ),
        // all of it together, never one person's share
        figure(`$${raised.toLocaleString("en-US")}`, "Raised"),
      ].join("")
    : founding && figure(n.founding, founding);
  stats.hidden = false;
  const now = document.querySelector("[data-now]");
  const date = (at) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  // a color with a holo card, from what it was adopted for, ringed
  const shiny = (c) => adopted[c.slug]?.amount >= HOLO_FROM && adopted[c.slug]?.shine;
  const square = (c) =>
    `<a class="supporter__color${shiny(c) ? " supporter__color--shiny" : ""}" id="color-${esc(c.slug)}" href="${esc(siteURL(`color/${c.slug}/`))}" style="--c:${esc(c.hex)}" title="${esc(c.name)}"></a>`;
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
  // a patron: the first three side by side over the table, the rest its rows; their face in it
  // only on a phone, where the panel beside the table isn't
  const patronHTML = (p, rank) => {
    const handle = handleOf(p.by, p.on);
    const since = p.colors.map((c) => adopted[c.slug].at).sort()[0];
    const top = rank < 3;
    return `<li class="supporter${top ? " supporter--top" : ""}" data-i="${rank}" tabindex="-1">
        <span class="${top ? "title title--sub supporter__rank--top" : "label"} supporter__rank">${number(rank)}</span>
        <span class="supporter__face" aria-hidden="true">${faceOf(p, handle)}</span>
        ${linkTo(p, "supporter__name", esc(handle))}
        <span class="supporter__colors">${p.colors.map(square).join("")}</span>
        <span class="supporter__meta">${p.founding ? '<span class="small supporter__founding" title="One of the first 50 patrons">Founding</span>' : "<span></span>"}<span class="small supporter__since">${since ? esc(date(since)) : ""}</span></span>
      </li>`;
  };
  const board = list.closest(".supporters-board");
  board.querySelector("[data-top]").innerHTML = rows.slice(0, 3).map(patronHTML).join("");
  // what it takes to join them: more in all than the third (a tie keeps the earlier patron ahead),
  // rounded up to the next five dollars, so it's enough and says about, not the third's amount
  const next =
    rows.length >= 3
      ? `<li class="small supporters-board__next">About $${(Math.ceil((rows[2].total + 1) / 5) * 5).toLocaleString("en-US")} in all puts you in the top three. <a href="../adopt/">Adopt a color</a></li>`
      : "";
  list.innerHTML =
    next +
    rows
      .slice(3)
      .map((p, k) => patronHTML(p, k + 3))
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
    const at = (i) => board.querySelector(`.supporter[data-i="${i}"]`);
    at(shown)?.style.setProperty("--from", down ? "bottom" : "top");
    at(rank).style.setProperty("--from", down ? "top" : "bottom");
    for (const li of board.querySelectorAll(".supporter")) li.classList.toggle("is-on", Number(li.dataset.i) === rank);
    shown = rank;
    [...number(rank)].forEach((d, k) => places[k].style.setProperty("--d", d));
    // the first three have theirs on their card: the number here only from the fourth on
    now.classList.toggle("is-top", rank < 3);
    who.innerHTML = `<div class="supporters-board__face">${faceOf(p, handle)}</div>
      <p class="lead">${linkTo(p, "supporters-board__name", esc(handle))}</p>
      ${p.founding ? '<p class="label">Founding patron</p>' : ""}
      <ul class="supporters-board__colors">${p.colors
        .map(
          (c) =>
            `<li><a href="${esc(siteURL(`color/${c.slug}/`))}"><i class="supporter__color${shiny(c) ? " supporter__color--shiny" : ""}" style="--c:${esc(c.hex)}"></i><span class="small">${esc(c.name)}</span></a></li>`,
        )
        .join("")}</ul>`;
  };
  const pick = (e) => {
    const li = e.target.closest(".supporter");
    if (li && !li.classList.contains("is-on")) show(Number(li.dataset.i));
  };
  board.addEventListener("pointerover", pick);
  board.addEventListener("focusin", pick);
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
