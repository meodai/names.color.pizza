// The space in pixel art (pixel-mode.js): every card its drawing instead of its color. An atlas
// of small drawings comes when first asked for, its sheets side by side, each card its color
// until its sheet is in; close up, cards get their full-size drawing, dithering in over it.
// The renderer does the drawing (wall.js); this keeps what it has and fetches what it lacks.
import { getList, slugsOf } from "./names.js";
import { pixelAtlas } from "./pixel-mode.js";

// full-size drawings kept on the GPU for the cards close by
export const DETAIL_SLOTS = 1024;
// a full-size drawing dithering in over its small one
export const DETAIL_IN_MS = 320;

// getDraw, getItems: the renderer and cards now (a new list brings new ones); onScreen: the
// cards on screen bigger than a size, nearest first; request: a frame
// getFocus: the card looked at (found, opened), which comes first
export function createPixelSpace({ getDraw, getItems, onScreen, request, reduceMotion, onToggle, onSlots, getFocus }) {
  const pixelArt = { on: false, k: 0, index: null, slots: null, sheets: [], loading: null, fadingUntil: 0 };
  async function pixelSlots() {
    pixelArt.names ??= slugsOf((await getList("default")).items);
    const items = getItems();
    const slots = new Float32Array(items.length);
    items.forEach((it, i) => (slots[i] = pixelArt.index.slot.get(pixelArt.names.get(it.name)) ?? -1));
    return slots;
  }
  // where each small drawing has paint, a pixel wider all round: what the mouse may land on,
  // worked out in a worker so the opening motion never waits for it
  const shapes = [];
  let shaper = null;
  function shapeSheet(n, blob) {
    shaper ??= Object.assign(new Worker(new URL("./pixel-shapes-worker.js", import.meta.url), { type: "module" }), {
      onmessage: ({ data }) => (shapes[data.n] = data.rows),
    });
    const { tile, cols, per } = pixelArt.index;
    shaper.postMessage({ n, blob, tile, cols, per });
  }
  // card i's drawing has paint at (u, v), 0–1 across and down its square; true while unknown
  function covers(i, u, v) {
    const slot = pixelArt.slots?.[i];
    const index = pixelArt.index;
    if (slot === undefined || slot < 0 || !index) return true;
    const rows = shapes[Math.floor(slot / index.per)];
    if (!rows) return true;
    const t = index.tile;
    const x = Math.min(t - 1, Math.max(0, Math.floor(u * t)));
    const y = Math.min(t - 1, Math.max(0, Math.floor(v * t)));
    return ((rows[(slot % index.per) * t + y] >> x) & 1) === 1;
  }
  async function loadPixelArt() {
    pixelArt.index = await pixelAtlas();
    getDraw().pixelInit(pixelArt.index.sheets.length);
    pixelArt.slots = await pixelSlots();
    getDraw().pixelSlots(pixelArt.slots);
    onSlots?.();
    await Promise.all(
      pixelArt.index.sheets.map(async (_, n) => {
        const blob = await fetch(pixelArt.index.sheetURL(n)).then((r) => r.blob());
        pixelArt.sheets[n] = await createImageBitmap(blob, { premultiplyAlpha: "none" });
        getDraw().pixelSheet(n, pixelArt.sheets[n]);
        request();
        shapeSheet(n, blob);
      }),
    );
  }
  // close up, every card bigger than DETAIL_PX on screen gets its full 64 × 64 tile, the
  // nearest first, a dozen fetched at a time; looked for a few times a second, whatever
  // the names do. Those done, the cards about to come close: a little smaller, or just
  // past the view's edges. When all slots are taken, the card seen longest ago gives its up
  const DETAIL_PX = 22;
  const AHEAD_PX = 12;
  const AHEAD_MARGIN = 0.3;
  const detail = {
    of: new Map(),
    owner: new Int32Array(DETAIL_SLOTS).fill(-1),
    seen: new Float64Array(DETAIL_SLOTS),
    loading: new Set(),
    queue: [],
    busy: 0,
    round: 0,
    looked: 0,
    failed: new Map(),
  };
  // look again soon, though the camera stays still
  const lookSoon = (ms) => {
    clearTimeout(detail.again);
    detail.again = setTimeout(request, ms);
  };
  function lookForDetail(time) {
    if (!pixelArt.on || !pixelArt.slots) return;
    // too soon: look once more after, in case the camera stops right now
    if (time - detail.looked < 120) {
      detail.later ||= setTimeout(() => {
        detail.later = 0;
        request();
      }, 130);
      return;
    }
    detail.looked = time;
    // the card looked at first, then the nearest that show: not those gone, too close to the
    // eye, which would only hold the others up
    const queue = [];
    const queued = new Set();
    let missing = 0;
    const want = (i) => {
      const slot = detail.of.get(i);
      if (slot !== undefined) return void (detail.seen[slot] = time);
      if (pixelArt.slots[i] < 0 || queued.has(i)) return;
      missing++;
      if (detail.loading.has(i) || (detail.failed.get(i)?.until ?? 0) > time) return;
      queued.add(i);
      queue.push(i);
    };
    const focus = getFocus?.() ?? -1;
    if (focus >= 0) want(focus);
    for (const { i, near } of onScreen(DETAIL_PX, DETAIL_SLOTS / 2)) if (near > 0) want(i);
    // only once every card showing has its own: the next ones never take a slot from them
    if (!missing)
      for (const { i, near } of onScreen(AHEAD_PX, DETAIL_SLOTS / 4, AHEAD_MARGIN))
        if (near > 0 && !detail.of.has(i)) want(i);
    detail.queue = queue;
    fetchDetail();
    if (missing) lookSoon(400);
  }
  function fetchDetail() {
    while (detail.busy < 12 && detail.queue.length) {
      const i = detail.queue.shift();
      detail.loading.add(i);
      const round = detail.round;
      detail.busy++;
      // a retry asks past the caches, which may keep the error
      const tries = detail.failed.get(i)?.tries ?? 0;
      fetch(pixelArt.index.tileURL(pixelArt.slots[i]) + (tries ? `&try=${tries}` : ""))
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((blob) => createImageBitmap(blob, { premultiplyAlpha: "none" }))
        .then((image) => {
          if (round !== detail.round) return;
          let slot = detail.owner.indexOf(-1);
          if (slot < 0) {
            slot = 0;
            for (let k = 1; k < DETAIL_SLOTS; k++) if (detail.seen[k] < detail.seen[slot]) slot = k;
            const was = detail.owner[slot];
            detail.of.delete(was);
            getDraw().pixelDetailOf(was, -1);
          }
          detail.failed.delete(i);
          detail.owner[slot] = i;
          detail.of.set(i, slot);
          detail.seen[slot] = performance.now();
          getDraw().pixelDetail(slot, image);
          getDraw().pixelDetailOf(i, slot, reduceMotion ? -1e9 : performance.now() % 1e6);
          pixelArt.fadingUntil = performance.now() + DETAIL_IN_MS;
          request();
        })
        .catch(() => {
          if (round !== detail.round) return;
          detail.failed.set(i, { until: performance.now() + 2000 * 2 ** Math.min(tries, 4), tries: tries + 1 });
          lookSoon(2100);
        })
        .finally(() => {
          detail.loading.delete(i);
          detail.busy--;
          fetchDetail();
        });
    }
  }
  // a new list builds a new renderer: it gets the slots and sheets back, the close ones anew
  async function restorePixelArt() {
    if (!pixelArt.index) return;
    getDraw().pixelInit(pixelArt.index.sheets.length);
    detail.round++;
    detail.of.clear();
    detail.loading.clear();
    detail.queue = [];
    detail.owner.fill(-1);
    detail.failed.clear();
    // the old list's slots would fetch the wrong drawings meanwhile
    pixelArt.slots = null;
    pixelArt.slots = await pixelSlots();
    getDraw().pixelSlots(pixelArt.slots);
    onSlots?.();
    pixelArt.sheets.forEach((sheet, n) => sheet && getDraw().pixelSheet(n, sheet));
    getDraw().pixelMix(pixelArt.k);
    request();
  }
  function togglePixelArt() {
    pixelArt.on = !pixelArt.on;
    onToggle?.(pixelArt.on);
    if (pixelArt.on) pixelArt.loading ??= loadPixelArt().catch((e) => console.error(e));
    const from = pixelArt.k;
    const to = pixelArt.on ? 1 : 0;
    const start = performance.now();
    const step = (now) => {
      const t = reduceMotion ? 1 : Math.min(1, (now - start) / 600);
      pixelArt.k = from + (to - from) * t * t * (3 - 2 * t);
      getDraw().pixelMix(pixelArt.k);
      request();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return Object.assign(pixelArt, { toggle: togglePixelArt, restore: restorePixelArt, lookForDetail, covers });
}
