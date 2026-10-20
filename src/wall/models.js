import { convertLabToLch, convertRgbToHsl } from "culori";
import { UNNAMED } from "../names.js";

// where each name sits in the space, by color model, and the size of its card there
export const CARD_W = 1;
export const CARD_H = 1.3; // square swatch over a 0.3 label strip
export const cardScale = (n) => Math.min(8, Math.max(1, Math.cbrt(3087 / Math.max(n, 1))));
export const LY = 180; // lightness → world height
export const R = 100;

export function hsl([r, g, b]) {
  const c = convertRgbToHsl({ r: r / 255, g: g / 255, b: b / 255 });
  return [c.h ?? 0, c.s, c.l];
}

export const polar = (deg, radius, y) => {
  const t = (deg * Math.PI) / 180;
  return [radius * Math.cos(t), y, -radius * Math.sin(t)];
};

export const RGB_SIDE = 125;
export const ROOT2 = Math.SQRT2;
export const ROOT3 = Math.sqrt(3);
export const ROOT6 = Math.sqrt(6);

export const MODELS = {
  // the cube stood on its black corner, white straight above
  rgb: {
    label: "RGB",
    place: (it) => {
      const [r, g, b] = it.rgb.map((v) => v / 255 - 0.5);
      return [((r - g) / ROOT2) * RGB_SIDE, ((r + g + b) / ROOT3) * RGB_SIDE, ((r + g - 2 * b) / ROOT6) * RGB_SIDE];
    },
  },
  oklab: {
    label: "OKLab",
    place: (it) => [it.a * LY, (it.L - 0.5) * LY, -it.b * LY],
  },
  // lightness as the radius, chroma as the height
  oklch: {
    label: "OKLCH",
    place: (it) => {
      const { c, h = 0 } = convertLabToLch({ l: it.L, a: it.a, b: it.b }, "oklch");
      return polar(h, it.L * R * 1.2, (c / 0.32) * LY * 0.55 - LY * 0.25);
    },
  },
  hsl: {
    label: "HSL",
    place: (it) => {
      const [h, s, l] = hsl(it.rgb);
      return polar(h, s * (l < 0.5 ? l : 1 - l) * 2 * R, (l - 0.5) * LY);
    },
  },
};
export const DEFAULT_MODEL = "rgb";
export const GEO = { LY, R, RGB_SIDE }; // cells.js undoes MODELS' placing with these
// the name map's "unnamed" distance, in wall units
export const CELL_REACH = UNNAMED * LY;
