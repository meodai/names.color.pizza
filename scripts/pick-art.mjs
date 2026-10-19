// A share of the colors whose art is picked again, on a core of its own (pages.mjs): the
// same works in the same order as there, so each pick comes out as it would there
import { parentPort, workerData } from "node:worker_threads";
import { bucketed, pickArt, unpackWork } from "../src/art.js";

const works = [];
for (const [museum, text] of workerData.texts) {
  for (const w of JSON.parse(text)) {
    const work = unpackWork(w, museum);
    if (work) works.push(work);
  }
}
const near = bucketed(works);

// sent on in small batches, so the lists don't all wait here
let batch = [];
for (const hex of workerData.hexes) {
  const art = pickArt(near, hex);
  batch.push([hex, art?.length ? JSON.stringify(art) : ""]);
  if (batch.length === 250) {
    parentPort.postMessage(batch);
    batch = [];
  }
}
parentPort.postMessage(batch);
