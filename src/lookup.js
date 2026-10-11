/*
  Lookup — what Wikipedia and Wiktionary say about a color's name: the
  articles on it and on its words, the dictionary's definitions, the
  pictures in those articles and recordings of the words. The same code
  runs on the color page and in the nightly job that keeps a copy of it
  (scripts/collect.mjs), so the page can mostly read that copy instead of
  asking Wikipedia. Everything it returns is plain data (lookupName).

  In the browser it uses fetch and DOMParser; elsewhere, configure() hands
  it its own (Node: fetch with a User-Agent, linkedom's parser).
*/

// In a browser the User-Agent can't be set: Wikimedia asks scripts to say
// who they are with Api-User-Agent instead
const AGENT = "ColorNamesBot/1.0 (https://github.com/meodai/color-names) color-pages";
const io = {
  fetch: (url, options = {}) => fetch(url, { ...options, headers: { "Api-User-Agent": AGENT, ...options.headers } }),
  parse: (html) => new DOMParser().parseFromString(html, "text/html"),
};

// a "%" that isn't an escape ("100% Cocoa") stays as it is
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

// The lookups are shared between names ("Green" is in hundreds): kept for
// the run, and dropped once there are many, so a long run stays small
const caches = [];
const cache = () => {
  const c = new Map();
  caches.push(c);
  return c;
};
export const forget = () => caches.forEach((c) => c.clear());


const SMALL = ["the", "a", "in", "of", "an", "on"];

// "Venus Slipper Orchid" -> the full name, its runs of words, single words,
// without possessives; single words also as "Word (color)"
// color words and modifiers: their articles are the most general
const COMMON = ["light", "dark", "pale", "deep", "bright", "soft", "pastel", "medium", "dull", "vivid",
  "red", "orange", "yellow", "green", "blue", "purple", "violet", "pink", "brown", "black", "white",
  "grey", "gray", "cyan", "magenta", "teal", "gold", "silver", "beige", "tan"];

// "Shōshin" → "Shoshin", "Crème" → "Creme"
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
  // each without its accents too, right after it: Wikipedia has
  // "Shoshin", not "Shōshin"
  const spelled = kept.flatMap((v) => (withoutAccents(v) !== v ? [v, withoutAccents(v)] : [v]));
  // the distinctive words first; plain color words and modifiers ("Light",
  // "Yellow") have the most general articles, so they come last
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

// Titles like "Black Mesa (video game)": plain "Black Mesa" is only a
// disambiguation page, so the specific articles have to be searched for.
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

// The images inside the articles we show, as the old color pages did.
// SVGs and maps are skipped: they're mostly icons, flags and white space.
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

// a Wikimedia file's name, from a thumbnail URL or a media-list title, to
// tell when two are the same picture
// the file a picture's address is of, whatever size or tracking query
// (?utm_source=…) it's asked for with
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
      // maps, locators, logos and flags are mostly white space at this size
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

// When the name itself is a disambiguation page ("Voodoo or Vodou may refer
// to: …"), its editors list the main meanings first: take those, in order.
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

// Wikipedia's near-match search: titles that match ignoring case and
// punctuation ("Deep-Fried" finds Deep-fried, a redirect to Deep frying).
// Full-text search would be too loose: it gives "Lingering Storm" typhoons.
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

// titles are case-sensitive after the first letter, and the list writes
// names in Title Case: "Deep Fried" isn't an article, "Deep fried" is
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
  // the name's main meanings, its "Name (…)" articles, the name itself
  // (as written, then in sentence case), what search finds, then its parts
  const titles = [
    ...new Set([
      ...meanings,
      ...specific.slice(0, 2),
      name,
      sentence,
      ...searched,
      // the name's parts, multi-word ones also in sentence case
      ...nameVariants(name).flatMap((v) => (/\s/.test(v) ? [v, sentenceCase(v)] : [v])),
    ]),
  ];
  const pages = await Promise.all(titles.map(wikiSummary));

  // A word of the name that's ambiguous on its own ("Bianchi may refer
  // to…") is looked up with the rest of the name: of what a full-text search
  // for the whole name finds, an article on that word itself, "Bianchi
  // (company)". Only those: the search alone is too loose to trust.
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

/* —— Wiktionary: what the words of the name mean —— */

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

// definitions arrive as HTML; keep their text
const plain = (html) => io.parse(html).body.textContent.trim();

// The name as a whole first ("Black Mesa", "red-handed"); failing that,
// its words. A sense with no plain definition left is dropped.
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

// The recordings on the term's page, in the English section, each with its
// format: the page picks one its browser can play.
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

// A summary's paragraphs and list items, as plain text: keeps the breaks of
// the HTML version without putting Wikipedia's markup into the page.
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

// one entry for the whole name, rather than one per word
export const isWhole = (entries) => entries.length === 1 && entries[0].whole;
export const baseTitle = (t) => t.replace(/\s*\(.*\)$/, "").toLowerCase();

// Everything the color page shows about a name from Wikipedia and
// Wiktionary, as plain data:
//   definitions: [{ term, whole, parts: [{ part, definitions }], link }]
//   entries:     [{ title, blocks: [{ text } | { items }], image, link }]
//   images:      [{ src, srcset, alt, link }]  (addresses, not the files)
//   sounds:      { term: [{ type, src }] }
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
