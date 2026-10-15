// Standard.site: the list is a publication of @color.pizza on atproto and
// each color page one of its documents, so a shared link shows who publishes
// it. A record's key is a TID made from the day the color was named and its
// slug: the pages and the upload agree on it without storing 32k keys.

export const DID = "did:plc:4yp6cg5mvnn4ecrs4o5hjmih";
export const FIRST_DAY = "2017-04-23";

const S32 = "234567abcdefghijklmnopqrstuvwxyz";
const DAY = 86_400_000_000n;

// FNV-1a, 64 bits
function hash(text) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h;
}

// microseconds since 1970 and a 10-bit clock id, in the sortable base32 of a TID
export function tid(micros, clock) {
  let n = (BigInt(micros) << 10n) | BigInt(clock & 1023);
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = S32[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

const dayMicros = (day) => BigInt(Date.parse(`${day}T00:00:00Z`)) * 1000n;

// somewhere in the day it was named, by its slug
export function documentKey(slug, day = FIRST_DAY) {
  const h = hash(slug);
  return tid(dayMicros(day) + (h % DAY), Number((h >> 40n) % 1024n));
}

export const PUBLICATION_KEY = tid(dayMicros(FIRST_DAY), 0);
export const PUBLICATION = `at://${DID}/site.standard.publication/${PUBLICATION_KEY}`;
export const documentURI = (slug, day) => `at://${DID}/site.standard.document/${documentKey(slug, day)}`;
