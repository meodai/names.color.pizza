// Small drawings beside "On screen", "In print" and "As light", as tall as their label,
// in the label's color: three cells for red, green and blue; four dithered cells for cyan,
// magenta, yellow and black; a thermometer for how warm the color is as light.

// all three the same width
const WIDTH = 51;
const svg = (w, body) =>
  `<svg class="mix-viz" viewBox="0 0 ${w} 12" width="${w}" height="12" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;

// red, green and blue, 0–1 each: three cells side by side in one box, a line between them,
// each filled from its left edge, a pixel clear of its lines so they stay visible
export function screenViz(rgb) {
  const edges = cellEdges(3);
  return svg(
    WIDTH,
    box(edges) +
      rgb
        .map((v, i) => {
          const x = edges[i] + 2;
          const w = Math.round(v * (edges[i + 1] - 1 - x));
          return w ? `<rect x="${x}" y="2" width="${w}" height="8" fill="currentColor"/>` : "";
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
      let d = "";
      for (let y = 2; y < 10; y++)
        for (let x = edges[i] + 2; x < edges[i + 1] - 1; x++) if (BAYER[(y % 4) * 4 + (x % 4)] < level) d += `M${x} ${y}h1v1h-1z`;
      return d;
    })
    .join("");
  return svg(WIDTH, box(edges) + (inked ? `<path d="${inked}" fill="currentColor"/>` : ""));
}

// a color temperature in kelvin: warmer (fewer kelvin) fills more of the tube
const COOLEST = 12000;
const WARMEST = 1000;
export function lightViz(kelvin) {
  const warm = Math.min(1, Math.max(0, (Math.log(COOLEST) - Math.log(kelvin)) / (Math.log(COOLEST) - Math.log(WARMEST))));
  const len = WIDTH - 14;
  const fill = Math.round(warm * len);
  return svg(
    WIDTH,
    `<circle cx="6" cy="6" r="5.5" fill="currentColor" shape-rendering="geometricPrecision"/>` +
      `<rect x="10.5" y="3.5" width="${len + 3}" height="5" rx="2.5" fill="none" stroke="currentColor" shape-rendering="geometricPrecision"/>` +
      (fill ? `<rect x="10" y="4" width="${fill + 2}" height="4" fill="currentColor"/>` : ""),
  );
}
