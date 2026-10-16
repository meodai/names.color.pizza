// Small drawings beside "On screen", "In print" and "As light", as tall as their label,
// in the label's color: three cells for red, green and blue; four dithered dots for cyan,
// magenta, yellow and black; a thermometer for how warm the color is as light.

// all three as wide as the four dots of print
const WIDTH = 51;
const svg = (w, body) =>
  `<svg class="mix-viz" viewBox="0 0 ${w} 12" width="${w}" height="12" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;

// red, green and blue, 0–1 each: three cells side by side in one box, a line between them,
// each filled from its left edge
export function screenViz(rgb) {
  const cell = (WIDTH - 1) / 3;
  return svg(
    WIDTH,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="11" fill="none" stroke="currentColor"/>` +
      `<path d="M${(cell + 0.5).toFixed(1)} 0v12M${(2 * cell + 0.5).toFixed(1)} 0v12" stroke="currentColor"/>` +
      rgb
        .map((v, i) => {
          const x = Math.round(i * cell) + 1;
          const w = Math.round(v * (Math.round((i + 1) * cell) - x));
          return w ? `<rect x="${x}" y="1" width="${w}" height="10" fill="currentColor"/>` : "";
        })
        .join(""),
  );
}

// a 4 × 4 ordered dither: which cells are inked at a coverage
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let clipId = 0;

// cyan, magenta, yellow and black, 0–1 each: a round dot each, dithered as dense as the ink
export function printViz(cmyk) {
  const id = `mix-dot-${++clipId}`;
  const dots = cmyk
    .map((v, i) => {
      const x = i * 13;
      let cells = "";
      for (let y = 0; y < 12; y += 1)
        for (let cx = 0; cx < 12; cx += 1)
          if (BAYER[(y % 4) * 4 + (cx % 4)] < Math.round(v * 16)) cells += `M${x + cx} ${y}h1v1h-1z`;
      return `<g clip-path="url(#${id}-${i})"><path d="${cells}" fill="currentColor"/></g><circle cx="${x + 6}" cy="6" r="5.5" fill="none" stroke="currentColor" shape-rendering="geometricPrecision"/>`;
    })
    .join("");
  const clips = cmyk.map((_, i) => `<clipPath id="${id}-${i}"><circle cx="${i * 13 + 6}" cy="6" r="5.5"/></clipPath>`).join("");
  return svg(WIDTH, `<defs>${clips}</defs>${dots}`);
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
