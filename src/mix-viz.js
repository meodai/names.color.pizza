// Small drawings beside "On screen", "In print" and "As light", as tall as their label,
// in the label's color: three cells for red, green and blue; four dithered cells for cyan,
// magenta, yellow and black; a thermometer for how warm the color is as light.

// all three the same width
const WIDTH = 75;
// drawn lying down, shown standing up: left becomes the bottom, so fills rise
const svg = (w, body) =>
  `<svg class="mix-viz" viewBox="0 0 12 ${w}" width="12" height="${w}" aria-hidden="true" shape-rendering="crispEdges"><g transform="rotate(-90) translate(${-w} 0)">${body}</g></svg>`;

// red, green and blue, 0–1 each: three cells side by side in one box, a line between them,
// each filled from its left edge, a pixel clear of its lines so they stay visible. Each fill
// has its ink's class: hovered or focused, the drawing shows its real colors (see the CSS)
export function screenViz(rgb) {
  const edges = cellEdges(3);
  return svg(
    WIDTH,
    box(edges) +
      rgb
        .map((v, i) => {
          // standing up, the first ink on top
          const at = 2 - i;
          const x = edges[at] + 2;
          const w = Math.round(v * (edges[at + 1] - 1 - x));
          return w ? `<rect class="mix-${"rgb"[i]}" x="${x}" y="2" width="${w}" height="8" fill="currentColor"/>` : "";
        })
        .join(""),
  );
}

// cells side by side in one box with a line between them; the box's edges at each line
const cellEdges = (n) => Array.from({ length: n + 1 }, (_, i) => Math.round((i * (WIDTH - 1)) / n));
const box = (edges) =>
  `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="11" fill="none" stroke="currentColor"/>` +
  `<path d="${edges
    .slice(1, -1)
    .map((e) => `M${e + 0.5} 0v12`)
    .join("")}" stroke="currentColor"/>`;

// a 4 × 4 ordered dither: which pixels are inked at a coverage
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// cyan, magenta, yellow and black, 0–1 each: a cell each, dithered as dense as the ink,
// a pixel clear of its lines
export function printViz(cmyk) {
  const edges = cellEdges(4);
  const inked = cmyk
    .map((v, i) => {
      const level = Math.round(v * 16);
      const at = 3 - i;
      let d = "";
      for (let y = 2; y < 10; y++)
        for (let x = edges[at] + 2; x < edges[at + 1] - 1; x++) if (BAYER[(y % 4) * 4 + (x % 4)] < level) d += `M${x} ${y}h1v1h-1z`;
      return d ? `<path class="mix-${"cmyk"[i]}" d="${d}" fill="currentColor"/>` : "";
    })
    .join("");
  return svg(WIDTH, box(edges) + inked);
}

// a color temperature in kelvin: warmer (fewer kelvin) fills more of the tube
const COOLEST = 12000;
const WARMEST = 1000;
export function lightViz(kelvin) {
  const warm = Math.min(1, Math.max(0, (Math.log(COOLEST) - Math.log(kelvin)) / (Math.log(COOLEST) - Math.log(WARMEST))));
  // one outline, the bulb flowing into a tube rounded only at its end; inside it, a pixel
  // clear all round, the mercury: the bulb full, the tube as far as the color is warm
  const join = Math.sqrt(5.5 ** 2 - 3.5 ** 2) + 6;
  const end = WIDTH - 0.5;
  const glass = `M${join.toFixed(2)} 2.5H${end - 3.5}A3.5 3.5 0 0 1 ${end - 3.5} 9.5H${join.toFixed(2)}A5.5 5.5 0 1 1 ${join.toFixed(2)} 2.5Z`;
  const reach = Math.round(10 + warm * (end - 2.5 - 10));
  // shown in its colors: cold blue where the scale starts, warm orange at its far end
  const heat = `<defs><linearGradient id="mix-heat" gradientUnits="userSpaceOnUse" x1="2" x2="${end - 2}" y1="0" y2="0"><stop offset="0" stop-color="#9ec5ff"/><stop offset="0.5" stop-color="#fff4e0"/><stop offset="1" stop-color="#ff7a1a"/></linearGradient></defs>`;
  return svg(
    WIDTH,
    heat +
      `<path d="${glass}" fill="none" stroke="currentColor" shape-rendering="geometricPrecision"/>` +
      `<circle class="mix-heat" cx="6" cy="6" r="4" fill="currentColor" shape-rendering="geometricPrecision"/>` +
      `<rect class="mix-heat" x="6" y="4" width="${reach - 6}" height="4" fill="currentColor"/>`,
  );
}
