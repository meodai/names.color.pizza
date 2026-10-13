import { hexToRgb, rgbToOklab } from "./names.js";

// browsers can't set User-Agent; Wikimedia accepts Api-User-Agent instead
const AGENT = "ColorNamesBot/1.0 (https://github.com/meodai/color-names) color-pages";
const io = {
  fetch: (url, options = {}) => fetch(url, { ...options, headers: { "Api-User-Agent": AGENT, ...options.headers } }),
  parse: (html) => new DOMParser().parseFromString(html, "text/html"),
  pixels: (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = SAMPLE;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
          resolve(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }),
  parallelPictures: 8,
};

// a bare "%" ("100% Cocoa") isn't an escape
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function configure(options) {
  Object.assign(io, options);
}

const caches = [];
const cache = () => {
  const c = new Map();
  caches.push(c);
  return c;
};
export const forget = () => caches.forEach((c) => c.clear());

const SMALL = ["the", "a", "in", "of", "an", "on"];

const COMMON = ["light", "dark", "pale", "deep", "bright", "soft", "pastel", "medium", "dull", "vivid",
  "red", "orange", "yellow", "green", "blue", "purple", "violet", "pink", "brown", "black", "white",
  "grey", "gray", "cyan", "magenta", "teal", "gold", "silver", "beige", "tan"];

const withoutAccents = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function nameVariants(name) {
  const words = name.split(" ");
  const out = new Set([name]);
  for (let i = words.length; i >= 2; i--) {
    for (let j = 1; j <= i - 2; j++) out.add(words.slice(j, i).join(" "));
  }
  for (let k = words.length - 1; k >= 2; k--) out.add(words.slice(0, k).join(" "));
  words.forEach((w) => out.add(w));
  const kept = [...out].filter((v) => {
    const low = v.toLowerCase();
    return !SMALL.includes(low) && !SMALL.some((s) => low.startsWith(s + " ") || low.endsWith(" " + s));
  });
  // Wikipedia has "Shoshin", not "Shōshin"
  const spelled = kept.flatMap((v) => (withoutAccents(v) !== v ? [v, withoutAccents(v)] : [v]));
  // plain color words have the most general articles, so they go last
  const plainWord = (v) => COMMON.includes(v.toLowerCase());
  const ordered = [...spelled.filter((v) => !plainWord(v)), ...spelled.filter(plainWord)];
  const extra = [];
  for (const v of ordered) {
    if (/['’]s$/.test(v)) extra.push(v.slice(0, -2));
    if (!/\s/.test(v)) extra.push(`${v} (color)`);
  }
  return [...new Set([...ordered, ...extra])];
}

const wikiCache = cache();
function wikiSummary(title) {
  if (!wikiCache.has(title)) {
    if (wikiCache.size > 20000) wikiCache.clear();
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}?redirect=true`;
    wikiCache.set(
      title,
      io.fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    );
  }
  return wikiCache.get(title);
}

// plain "Black Mesa" is a disambiguation page; "Black Mesa (video game)" must be searched for
async function wikiTitlesFor(name) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  Object.entries({
    action: "query",
    format: "json",
    origin: "*",
    generator: "prefixsearch",
    gpssearch: name,
    gpslimit: "10",
    prop: "pageprops",
    ppprop: "disambiguation",
    redirects: "1",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await io.fetch(url);
    const pages = Object.values((await res.json()).query?.pages || {});
    const exactish = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(.+\\))?$`, "i");
    return pages
      .filter((p) => exactish.test(p.title) && !p.pageprops?.disambiguation)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => p.title)
      .slice(0, 3);
  } catch {
    return [];
  }
}

const mediaCache = cache();
function wikiMedia(title) {
  if (!mediaCache.has(title)) {
    if (mediaCache.size > 20000) mediaCache.clear();
    const url = `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}?redirect=true`;
    mediaCache.set(
      title,
      io.fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    );
  }
  return mediaCache.get(title);
}

const fileOf = (url) => {
  const s = url.replace(/[?#].*$/, "");
  return decode(s.match(/\/([^/]+\.\w{3,4})\/\d+px-[^/]*$/)?.[1] || s.split("/").pop() || s)
    .replace(/^File:/, "")
    .replace(/ /g, "_")
    .toLowerCase();
};

async function wikiImages(titles, limit = 8, skip = []) {
  const lists = await Promise.all(titles.map(wikiMedia));
  const seen = new Set(skip.map(fileOf));
  const images = [];
  for (const list of lists) {
    for (const item of list?.items || []) {
      if (item.type !== "image" || !item.srcset?.length) continue;
      if (/\.svg$/i.test(item.title) || seen.has(fileOf(item.title))) continue;
      // mostly icons and white space at this size
      if (/map|locat|logo|flag|icon|diagram|chart/i.test(item.title)) continue;
      seen.add(fileOf(item.title));
      images.push({
        srcset: item.srcset.map((s) => `https:${s.src} ${s.scale}`).join(", "),
        src: `https:${item.srcset[0].src}`,
        alt: item.caption?.text || "",
        link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      });
    }
  }
  return images.slice(0, limit);
}

// disambiguation pages list the main meanings first
async function wikiMeanings(title, limit = 2) {
  try {
    const res = await io.fetch(
      `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`
    );
    if (!res.ok) return [];
    const doc = io.parse(await res.text());
    const titles = [];
    for (const li of doc.querySelectorAll("li")) {
      const href = li.querySelector('a[rel="mw:WikiLink"]')?.getAttribute("href") || "";
      const target = decode(href.replace(/^\.\//, "").split("#")[0]).replace(/_/g, " ");
      if (!target || target.includes(":")) continue; // Wikipedia:, Help: …
      if (!titles.includes(target)) titles.push(target);
      if (titles.length >= limit) break;
    }
    return titles;
  } catch {
    return [];
  }
}

// full-text search is too loose ("Lingering Storm" finds typhoons), so nearmatch by default
async function wikiSearch(query, limit = 2, what = "nearmatch") {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  Object.entries({
    action: "query",
    format: "json",
    origin: "*",
    list: "search",
    srwhat: what,
    srsearch: query,
    srlimit: String(limit),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await io.fetch(url);
    return ((await res.json()).query?.search || []).map((r) => r.title);
  } catch {
    return [];
  }
}

// titles are case-sensitive after the first letter: "Deep fried", not "Deep Fried"
const sentenceCase = (t) => t[0] + t.slice(1).toLowerCase();

async function wikiEntries(name) {
  const sentence = sentenceCase(name);
  const [full, asSentence] = await Promise.all([
    wikiSummary(name),
    sentence !== name ? wikiSummary(sentence) : null,
  ]);
  const ambiguous = [full, asSentence].find((p) => p?.type === "disambiguation");
  const found = [full, asSentence].some((p) => p && p.type !== "disambiguation" && p.extract);
  const [meanings, specific, searched] = await Promise.all([
    ambiguous ? wikiMeanings(ambiguous.title || name) : [],
    wikiTitlesFor(name),
    found || ambiguous ? [] : wikiSearch(name),
  ]);
  const titles = [
    ...new Set([
      ...meanings,
      ...specific.slice(0, 2),
      name,
      sentence,
      ...searched,
      ...nameVariants(name).flatMap((v) => (/\s/.test(v) ? [v, sentenceCase(v)] : [v])),
    ]),
  ];
  const pages = await Promise.all(titles.map(wikiSummary));

  // ambiguous words ("Bianchi") resolve to "Bianchi (company)" via full-text search on the whole name
  const ambiguousWords = titles.filter(
    (t, k) => !/\s/.test(t) && pages[k]?.type === "disambiguation" && name.includes(t)
  );
  if (ambiguousWords.length) {
    const hits = await wikiSearch(name, 6, "text");
    const meant = hits.filter((h) => ambiguousWords.some((w) => h.startsWith(`${w} (`))).slice(0, 2);
    const extra = await Promise.all(meant.map(wikiSummary));
    // after the name's own articles, before the words' generic ones
    const own = titles.findIndex((t) => t === sentence) + 1;
    pages.splice(Math.max(own, 1), 0, ...extra);
  }

  const seen = new Set();
  return pages
    .filter((p) => p && p.type !== "disambiguation" && p.extract)
    .filter((p) => {
      const id = p.wikibase_item || p.title;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 4)
    .map((p) => ({
      title: p.title,
      blocks: p.extract_html ? summaryBlocks(p.extract_html) : [{ text: p.extract }],
      image: p.thumbnail?.source,
      link: p.content_urls?.desktop?.page,
    }));
}

const dictCache = cache();
function wiktionary(term) {
  if (!dictCache.has(term)) {
    if (dictCache.size > 20000) dictCache.clear();
    dictCache.set(
      term,
      io.fetch(
        `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term.replace(/ /g, "_"))}`
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (data?.en?.length ? { term, senses: data.en } : null))
        .catch(() => null)
    );
  }
  return dictCache.get(term);
}

const plain = (html) => io.parse(html).body.textContent.trim();

async function dictionaryEntries(name) {
  const whole = [name, name.toLowerCase(), name.toLowerCase().replace(/ /g, "-")];
  for (const term of [...new Set(whole)]) {
    const hit = await wiktionary(term);
    if (hit) return [shapeEntry(hit, true)].filter(Boolean);
  }
  const words = [...new Set(name.toLowerCase().replace(/['’]s\b/g, "").split(/[\s-]+/))]
    .filter((w) => w.length > 2 && !SMALL.includes(w))
    .slice(0, 3);
  const hits = await Promise.all(words.map(wiktionary));
  return hits.map((h) => h && shapeEntry(h)).filter(Boolean);
}

function shapeEntry({ term, senses }, whole = false) {
  const parts = senses
    .map((sense) => ({
      part: sense.partOfSpeech,
      definitions: sense.definitions.map((d) => plain(d.definition)).filter(Boolean).slice(0, 2),
    }))
    .filter((p) => p.definitions.length)
    .slice(0, 2);
  if (!parts.length) return null;
  return {
    term,
    whole,
    parts,
    link: `https://en.wiktionary.org/wiki/${encodeURIComponent(term.replace(/ /g, "_"))}`,
  };
}

async function pronunciations(term) {
  try {
    const res = await io.fetch(
      `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(term.replace(/ /g, "_"))}`
    );
    if (!res.ok) return [];
    const doc = io.parse(await res.text());
    const english = doc.getElementById("English")?.closest("section");
    return [...(english?.querySelectorAll("audio source") || [])]
      .map((source) => {
        const src = source.getAttribute("src") || "";
        return { type: source.getAttribute("type") || "", src: src.startsWith("//") ? `https:${src}` : src };
      })
      .filter((s) => s.src);
  } catch {
    return [];
  }
}

// plain text only, so Wikipedia's markup never reaches the page
function summaryBlocks(html) {
  const doc = io.parse(html);
  const blocks = [];
  doc.body.querySelectorAll("p, ul").forEach((el) => {
    if (el.tagName === "P") {
      const text = el.textContent.trim();
      if (text) blocks.push({ text });
    } else {
      blocks.push({ items: [...el.querySelectorAll("li")].map((li) => li.textContent.trim()) });
    }
  });
  return blocks;
}

export const isWhole = (entries) => entries.length === 1 && entries[0].whole;
export const baseTitle = (t) => t.replace(/\s*\(.*\)$/, "").toLowerCase();

export async function lookupName(name) {
  const [definitions, entries] = await Promise.all([dictionaryEntries(name), wikiEntries(name)]);
  const [images, sounds] = await Promise.all([
    entries.length
      ? wikiImages(
          entries.map((e) => e.title),
          8,
          entries.map((e) => e.image).filter(Boolean)
        )
      : [],
    Promise.all(definitions.map(async (d) => [d.term, await pronunciations(d.term)])),
  ]);
  return { definitions, entries, images, sounds: Object.fromEntries(sounds.filter(([, s]) => s.length)) };
}

export const SAMPLE = 40;
const NEAR = 0.05; // OKLab distance that still counts as "this color"
// standard thumbnail sizes, the only ones Wikimedia serves to scripts
const MEASURE_WIDTH = 60;
const SHOW_WIDTH = 500;

function showable(info) {
  const [path] = info.thumburl.split("?");
  if (info.width <= SHOW_WIDTH || !/\/\d+px-[^/]+$/.test(path)) return info.url;
  return path.replace(/\/\d+px-([^/]+)$/, `/${SHOW_WIDTH}px-$1`);
}

async function commonsSearch(term, limit = 40) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6", // File:
    // JPEGs leave out most flags, diagrams and swatches
    gsrsearch: `${term} filemime:image/jpeg`,
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size",
    iiurlwidth: String(MEASURE_WIDTH),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await io.fetch(url);
    const pages = Object.values((await res.json()).query?.pages || {});
    return pages
      .map((p) => ({ title: p.title, info: p.imageinfo?.[0] }))
      .filter((p) => p.info?.thumburl)
      .map(({ title, info }) => ({
        title: title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
        measure: info.thumburl,
        image: showable(info),
        ratio: info.width / info.height,
        link: info.descriptionurl,
      }));
  } catch {
    return [];
  }
}

function shareOf(data, target) {
  const limit = NEAR * NEAR;
  let near = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [L, a, b] = rgbToOklab([data[i], data[i + 1], data[i + 2]]);
    if ((L - target[0]) ** 2 + (a - target[1]) ** 2 + (b - target[2]) ** 2 < limit) near++;
  }
  return near / (data.length / 4);
}

async function measureAll(candidates, target) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const { measure, ...candidate } = candidates[next++];
      const data = await io.pixels(measure);
      if (data) results.push({ ...candidate, share: shareOf(data, target) });
    }
  };
  await Promise.all(Array.from({ length: io.parallelPictures }, worker));
  return results;
}

export async function lookupPictures(hex, terms, count = 12) {
  const lists = await Promise.all([...new Set(terms.filter(Boolean))].map((t) => commonsSearch(t)));
  const seen = new Set();
  const candidates = lists.flat().filter((c) => !seen.has(c.link) && seen.add(c.link));
  const measured = await measureAll(candidates, rgbToOklab(hexToRgb(hex)));
  return (
    measured
      // a noticeable patch, but not a flat swatch
      .filter((p) => p.share >= 0.04 && p.share <= 0.85)
      .sort((a, b) => b.share - a.share)
      .slice(0, count)
  );
}
