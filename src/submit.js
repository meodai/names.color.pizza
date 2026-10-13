import Fuse from "fuse.js";
import { Filter } from "bad-words";
import protectedTargets from "../../tests/protected-targets.json";
import { UNNAMED, hexToRgb, rgbToHex, rgbToOklab, normalizeHex, getList, nearestIndex } from "./names.js";

const ISSUE_URL = "https://github.com/meodai/color-names/issues/new";
const PROTECTED_DISTANCE = 0.005; // same as tests/primary-distance.test.js

const filter = new Filter();

const escapeHTML = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// same normalization as tests/duplicates.test.js
const normalizeName = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SMALL_WORDS = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v.?|vs.?|via)$/i;

// APA-ish Title Case
function toTitleCase(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/([ :–—-])/)
    .map((word, i, all) => {
      const isEdge = i === 0 || i === all.length - 1;
      if (!isEdge && SMALL_WORDS.test(word) && all[i - 3] !== ":" && all[i + 1] !== ":") {
        return word.toLowerCase();
      }
      if (/[A-Z]|\../.test(word.slice(1))) return word; // intentional capitals
      return word.replace(/([A-Za-z0-9À-ÿ])/, (c) => c.toUpperCase());
    })
    .join("")
    .replace(/'/g, "’"); // the list uses typographic apostrophes
}

const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

const PROTECTED = protectedTargets.map((t) => ({
  ...t,
  lab: rgbToOklab(hexToRgb(t.hex.toLowerCase())),
}));

export function initSubmit(root) {
  const q = (sel) => root.querySelector(sel);
  const form = q("[data-form]");
  const colorInput = q("[data-color]");
  const hexInput = q("[data-hex]");
  const nameInput = q("[data-name]");
  const checks = q("[data-checks]");
  const similar = q("[data-similar]");
  const send = q("[data-send]");
  const blankBtn = q("[data-blank]");
  const dropperBtn = q("[data-dropper]");

  let data = null;
  let fuse = null;
  let names = new Set();
  let hex = "#f00f00";
  let verdict = { ok: false };

  function setColor(next) {
    const h = normalizeHex(next);
    if (!h) return;
    hex = h;
    colorInput.value = h;
    if (document.activeElement !== hexInput) hexInput.value = h;
    root.style.setProperty("--swatch", h);
    validate();
  }

  function randomBlank() {
    if (!data) return null;
    for (let i = 0; i < 500; i++) {
      const rgb = [0, 0, 0].map(() => Math.floor(Math.random() * 256));
      const [L, a, b] = rgbToOklab(rgb);
      if (nearestIndex(data, L, a, b) < 0) return rgbToHex(rgb);
    }
    return null;
  }

  colorInput.addEventListener("input", () => setColor(colorInput.value));
  hexInput.addEventListener("input", () => setColor(hexInput.value));
  hexInput.addEventListener("blur", () => (hexInput.value = hex));
  blankBtn.addEventListener("click", () => setColor(randomBlank()));

  // Chromium only
  if ("EyeDropper" in window) {
    dropperBtn.hidden = false;
    dropperBtn.addEventListener("click", async () => {
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        setColor(sRGBHex);
      } catch {
        // cancelled
      }
    });
  }

  function check() {
    const list = [];
    const raw = nameInput.value;
    const name = toTitleCase(raw);
    const lab = rgbToOklab(hexToRgb(hex));

    const taken = data?.byHex.get(hex);
    if (taken) {
      list.push({ level: "stop", text: `${hex} is already “${taken.name}”.`, swatch: hex });
    } else if (data) {
      const k = nearestIndex(data, ...lab);
      if (k >= 0) {
        const near = data.items[k];
        list.push({
          level: "warn",
          text: `Close to “${near.name}” (${near.hex}). A color further away is more likely to get in.`,
          swatch: near.hex,
        });
      } else {
        list.push({ level: "ok", text: "Nobody has named this color yet." });
      }
    }
    const guarded = PROTECTED.find((t) => distance(t.lab, lab) < PROTECTED_DISTANCE);
    if (guarded) {
      list.push({ level: "stop", text: `Too close to plain “${guarded.name}”, which is kept free.` });
    }

    if (raw.trim().length > 1) {
      if (filter.isProfane(raw)) {
        list.push({ level: "stop", text: "No slurs, no insults." });
      }
      const dupe = names.has(normalizeName(name));
      if (dupe) list.push({ level: "stop", text: `“${name}” is already on the list.` });
      if (name !== raw.trim()) {
        list.push({ level: "ok", text: `Will be listed as “${name}”.` });
      }
    }

    const ready = raw.trim().length > 1 && data && !list.some((c) => c.level === "stop");
    return { ok: ready, name, list };
  }

  function validate() {
    verdict = check();
    checks.innerHTML = verdict.list
      .map(
        (c) =>
          `<li class="submit__check submit__check--${c.level}"${
            c.swatch ? ` style="--dot:${c.swatch}"` : ""
          }>${escapeHTML(c.text)}</li>`,
      )
      .join("");
    send.disabled = !verdict.ok;
  }

  let similarTimer = 0;
  nameInput.addEventListener("input", () => {
    validate();
    clearTimeout(similarTimer);
    similarTimer = setTimeout(showSimilar, 250);
  });

  function showSimilar() {
    const raw = nameInput.value.trim();
    const hits = raw.length > 2 && fuse ? fuse.search(raw, { limit: 8 }) : [];
    similar.hidden = !hits.length;
    similar.querySelector("ul").innerHTML = hits
      .map(({ item }) => `<li style="--dot:${item.hex}">${escapeHTML(item.name)}</li>`)
      .join("");
  }

  function sendIssue(name) {
    const url = new URL(ISSUE_URL);
    url.searchParams.set("title", `New color name: ${name}`);
    url.searchParams.set("labels", "color-names");
    url.searchParams.set(
      "body",
      [
        `**Name:** ${name}`,
        `**Color:** ${hex}`,
        "",
        "```csv",
        `${name},${hex},`,
        "```",
        "",
        "Submitted from the color-names website.",
      ].join("\n"),
    );
    window.open(url, "_blank", "noopener");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    validate();
    if (verdict.ok) sendIssue(verdict.name);
  });

  document.addEventListener("color-names:suggest", (e) => setColor(e.detail.hex));

  const suggested = normalizeHex(new URLSearchParams(location.search).get("suggest"));
  setColor(suggested || hex);
  getList("default").then((d) => {
    data = d;
    names = new Set(d.items.map((i) => normalizeName(i.name)));
    fuse = new Fuse(d.items, { keys: ["name"], threshold: 0.35 });
    if (!suggested) setColor(randomBlank() || hex);
    validate();
  });
}
