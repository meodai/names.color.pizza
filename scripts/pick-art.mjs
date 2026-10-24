// A share of the colors whose art is picked again, on a core of its own (pages.mjs): the
// same works in the same order as there, so each pick comes out as it would there
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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

// each list written to the spool, and only whether there is one sent on, in small batches
let batch = [];
for (const hex of workerData.hexes) {
  const art = pickArt(near, hex);
  if (art?.length) writeFileSync(join(workerData.spool, `${hex.slice(1)}.json`), JSON.stringify(art));
  batch.push([hex, art?.length ? 1 : 0]);
  if (batch.length === 250) {
    parentPort.postMessage(batch);
    batch = [];
  }
}
parentPort.postMessage(batch);
