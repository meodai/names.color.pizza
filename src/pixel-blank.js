// A color not drawn yet wears a blank paint chip in pixel art, its patch the color itself:
// Gold Tint's drawing, redrawn here so it costs no fetch. Its own drawing replaces it once
// published (art-colors-runner/pixel), so nothing here needs to know which names wait.

// a card's atlas slot when it has no drawing; -1 is still unknown, and shows the color
export const NOT_DRAWN = -2;

const SIZE = 64;
const [X, Y, W, H] = [19, 14, 26, 36];
const INK = [70, 63, 60];
const CARD = [248, 246, 241];
const LABEL = [202, 199, 192];

// what each pixel is: null for none, "patch" for the color
function part(x, y) {
  x -= X;
  y -= Y;
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  // the outline, its corners cut round
  const edge = y === 0 || y === H - 1 ? 2 : y === 1 || y === H - 2 ? 1 : 0;
  if (x < edge || x > W - 1 - edge) return null;
  if (edge === 2 || x === edge || x === W - 1 - edge) return INK;
  if (y >= 2 && y <= 26 && x >= 2 && x <= W - 3) return "patch";
  if (((y === 28 || y === 29) && x >= 2 && x <= 7) || (y === 31 && x >= 2 && x <= 4)) return LABEL;
  return CARD;
}

// RGBA, row by row from the top; the patch in `patch`
export function blankPixels(patch) {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const p = part(x, y);
      if (!p) continue;
      px.set([...(p === "patch" ? patch : p), 255], (y * SIZE + x) * 4);
    }
  return px;
}

// for the renderer: the chip with a white patch, and beside it where the patch is, side by side
// so they filter alike
export function blankTexture() {
  const px = new Uint8Array(SIZE * 2 * SIZE * 4);
  const chip = blankPixels([255, 255, 255]);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const from = (y * SIZE + x) * 4;
      px.set(chip.subarray(from, from + 4), (y * SIZE * 2 + x) * 4);
      if (part(x, y) === "patch") px.set([255, 255, 255, 255], (y * SIZE * 2 + SIZE + x) * 4);
    }
  return { px, width: SIZE * 2, height: SIZE };
}

// where the chip has paint, a pixel wider all round, at (u, v), 0–1 across and down
export const blankCovers = (u, v) =>
  u * SIZE >= X - 1 && u * SIZE < X + W + 1 && v * SIZE >= Y - 1 && v * SIZE < Y + H + 1;

// as an image, for a color's hex
const urls = new Map();
export function blankURL(hex) {
  if (!urls.has(hex)) {
    const n = parseInt(hex.slice(1), 16);
    const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
    canvas.getContext("2d").putImageData(new ImageData(blankPixels([n >> 16, (n >> 8) & 255, n & 255]), SIZE), 0, 0);
    urls.set(hex, canvas.toDataURL());
  }
  return urls.get(hex);
}
