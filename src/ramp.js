import { DittoTones } from "dittotones";
import { tailwindRamps } from "dittotones/ramps/tailwind";
import { formatHex } from "culori";
import { complementOf, hexToRgb, oklabToRgb, rgbToHex, rgbToOklab } from "./names.js";

const ditto = new DittoTones({ ramps: tailwindRamps });

export function rampOf(hex) {
  const { scale, matchedShade } = ditto.generate(hex);
  return Object.entries(scale).map(([shade, color]) => (shade === matchedShade ? hex : formatHex(color)));
}

export const complementHex = (hex) => rgbToHex(oklabToRgb(...complementOf(rgbToOklab(hexToRgb(hex)))));
