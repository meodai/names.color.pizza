import { converter } from "culori";
import { hexToRgb, oklchString, rgbToOklab } from "./names.js";

// a color written every way the color page shows it (and the dataset gives)
const toLab = converter("lab");
const toRgb = converter("rgb");
const toHsl = converter("hsl");

const pct = (v) => `${Math.round(v * 100)}%`;
const round = (v) => Math.round(v);

export const FORMATS = {
  hex: { label: "Hex", fn: (c) => c },
  rgb: {
    label: "RGB",
    fn: (c) => {
      const { r, g, b } = toRgb(c);
      return `${round(r * 255)} ${round(g * 255)} ${round(b * 255)}`;
    },
  },
  hsl: {
    label: "HSL",
    fn: (c) => {
      const { h = 0, s, l } = toHsl(c);
      return `${round(h || 0)}° ${pct(s)} ${pct(l)}`;
    },
  },
  oklch: {
    label: "OKLCH",
    fn: (c) => oklchString(...rgbToOklab(hexToRgb(c))).replace(/^oklch\(|\)$/g, ""),
  },
  lab: {
    label: "LAB",
    fn: (c) => {
      const { l, a, b } = toLab(c);
      return `${round(l)} ${round(a)} ${round(b)}`;
    },
  },
  cmyk: {
    label: "CMYK",
    fn: (c) => {
      const { r, g, b } = toRgb(c);
      const k = 1 - Math.max(r, g, b);
      if (k === 1) return "0% 0% 0% 100%";
      return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(pct).join(" ");
    },
  },
};
