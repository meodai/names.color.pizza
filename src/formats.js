import { converter } from "culori";

// a color written every way the color page shows it (and the dataset gives)
const toLab = converter("lab");
const toRgb = converter("rgb");
const toHsl = converter("hsl");
const toOklch = converter("oklch");

const pct = (v) => `${Math.round(v * 100)}%`;
const round = (v) => Math.round(v);

// culori has no CMYK: the plain one, without a print profile
export function cmykOf(c) {
  const { r, g, b } = toRgb(c);
  const k = 1 - Math.max(r, g, b);
  return k === 1 ? [0, 0, 0, 1] : [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

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
    fn: (c) => {
      const { l, c: chroma, h } = toOklch(c);
      // a gray has no hue, however small a tint rounding leaves it
      return `${(l * 100).toFixed(1)}% ${chroma.toFixed(3)} ${(chroma < 0.0005 ? 0 : h).toFixed(1)}`;
    },
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
    fn: (c) => cmykOf(c).map(pct).join(" "),
  },
};
