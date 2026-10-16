// Small drawings beside "On screen", "In print" and "As light", as tall as their label,
// in the label's color: three bars for red, green and blue; four dithered dots for cyan,
// magenta, yellow and black; a thermometer for how warm the color is as light.

const svg = (w, body) =>
  `<svg class="mix-viz" viewBox="0 0 ${w} 12" width="${w}" height="12" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;

// red, green and blue, 0–1 each: a bar each, filled from the bottom
export function screenViz(rgb) {
  return svg(
    17,
    rgb
      .map((v, i) => {
        const x = i * 6;
        const h = Math.round(v * 10);
        return `<rect x="${x + 0.5}" y="0.5" width="4" height="11" fill="none" stroke="currentColor"/>${h ? `<rect x="${x + 1}" y="${11 - h}" width="3" height="${h}" fill="currentColor"/>` : ""}`;
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
  return svg(51, `<defs>${clips}</defs>${dots}`);
}

// a color temperature in kelvin: warmer (fewer kelvin) fills more of the tube
const COOLEST = 12000;
const WARMEST = 1000;
export function lightViz(kelvin) {
  const warm = Math.min(1, Math.max(0, (Math.log(COOLEST) - Math.log(kelvin)) / (Math.log(COOLEST) - Math.log(WARMEST))));
  const len = 30;
  const fill = Math.round(warm * len);
  return svg(
    44,
    `<circle cx="6" cy="6" r="5.5" fill="currentColor" shape-rendering="geometricPrecision"/>` +
      `<rect x="10.5" y="3.5" width="${len + 3}" height="5" rx="2.5" fill="none" stroke="currentColor" shape-rendering="geometricPrecision"/>` +
      (fill ? `<rect x="10" y="4" width="${fill + 2}" height="4" fill="currentColor"/>` : ""),
  );
}
