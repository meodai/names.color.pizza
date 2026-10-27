// a rail down the right edge: the page in ticks, its sections marked on it by name where the
// scroll reaches them, a mark running down it with the scroll (CSS); a section's name takes you there
const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export function chapterRail(root, { scroller = window, signal } = {}) {
  const host = root.body || root;
  const box = scroller === window ? document.documentElement : scroller;
  const nav = document.createElement("nav");
  nav.className = "chapters";
  nav.setAttribute("aria-label", "On this page");
  nav.innerHTML = `<ol class="label chapters__list"></ol>`;
  const list = nav.querySelector("ol");
  const marks = new Map();
  const markFor = (part) => {
    const li = document.createElement("li");
    if (part.hasAttribute("data-sub")) li.className = "chapters__sub";
    const a = Object.assign(document.createElement("a"), {
      href: part.id ? `#${part.id}` : "#",
      textContent: part.dataset.chapter,
    });
    // the address may hold the color's hex: the scroll goes there without giving that up
    a.addEventListener("click", (e) => {
      e.preventDefault();
      part.scrollIntoView({ behavior: smooth(), block: "start" });
    });
    li.append(a);
    return li;
  };

  // each on the tick the mark is on once the scroll has taken you there (its scroll margin
  // too), the mark stepping from tick to tick (CSS); the parts looked up each time, as some
  // come later (the wiki's rows)
  const place = () => {
    const parts = [...root.querySelectorAll("[data-chapter]")];
    for (const [part, li] of marks) {
      if (parts.includes(part)) continue;
      li.remove();
      marks.delete(part);
    }
    for (const part of parts) if (!marks.has(part)) marks.set(part, markFor(part));
    list.append(...parts.map((part) => marks.get(part)));
    const room = box.scrollHeight - box.clientHeight;
    const top = scroller === window ? 0 : box.getBoundingClientRect().top;
    const tick = parseFloat(getComputedStyle(nav).getPropertyValue("--tick")) || 12;
    const ticks = Math.floor(nav.clientHeight / tick);
    nav.style.setProperty("--ticks", ticks);
    nav.style.setProperty("--span", `${ticks * tick}px`);
    parts.forEach((part, i) => {
      const li = marks.get(part);
      li.style.setProperty("--i", i);
      li.hidden = !!part.closest("[hidden]");
      if (li.hidden) return;
      const lands =
        part.getBoundingClientRect().top - top + box.scrollTop - parseFloat(getComputedStyle(part).scrollMarginTop);
      const at = room > 0 ? Math.min(1, Math.max(0, lands / room)) : 0;
      const k = Math.floor(at * ticks);
      li.style.setProperty("--y", `${k * tick}px`);
      // its slice of the scroll, while the bold tick is on it
      li.style.setProperty("--from", `${(k / ticks) * 100}%`);
      li.style.setProperty("--to", `${((k + 1) / ticks) * 100}%`);
    });
  };
  host.append(nav);
  place();
  // the sections fill in, and hide, after the page is there
  const resized = new ResizeObserver(place);
  resized.observe(host);
  resized.observe(nav);
  signal?.addEventListener("abort", () => {
    resized.disconnect();
    nav.remove();
  });
  // another color on the same page: drawn in again (restarting its animations)
  return {
    replay() {
      nav.style.animation = "none";
      nav.offsetWidth;
      nav.style.animation = "";
    },
  };
}
