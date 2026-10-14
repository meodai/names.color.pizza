// A name's link preview lives at media.color.pizza/cards/<key>.png; the key
// changes with the name, its color or the design, so no cache shows an old one.

import { createHash } from "node:crypto";

export const DESIGN = 3; // bump to remake every preview
export const cardKey = ({ name, hex }) => createHash("sha1").update(`${DESIGN}|${name}|${hex}`).digest("hex");
export const cardURL = (it) => `https://media.color.pizza/cards/${cardKey(it)}.png`;
