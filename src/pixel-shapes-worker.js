// Off the main thread: where each small drawing of an atlas sheet has paint, a pixel wider all
// round, as a row of bits per line of a tile (pixel-space.js asks, hover and clicks use it).
self.onmessage = async ({ data: { n, blob, tile, cols, per } }) => {
  const sheet = await createImageBitmap(blob, { premultiplyAlpha: "none" });
  const g = new OffscreenCanvas(sheet.width, sheet.height).getContext("2d", { willReadFrequently: true });
  g.drawImage(sheet, 0, 0);
  const alpha = g.getImageData(0, 0, sheet.width, sheet.height).data;
  const rows = new Uint16Array(per * tile);
  const own = new Uint16Array(tile);
  for (let k = 0; k < per; k++) {
    const x0 = (k % cols) * tile;
    const y0 = Math.floor(k / cols) * tile;
    if (y0 >= sheet.height) break;
    own.fill(0);
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) if (alpha[((y0 + y) * sheet.width + x0 + x) * 4 + 3] > 24) own[y] |= 1 << x;
    for (let y = 0; y < tile; y++) {
      const near = own[y] | (y ? own[y - 1] : 0) | (y < tile - 1 ? own[y + 1] : 0);
      rows[k * tile + y] = near | (near << 1) | (near >> 1);
    }
  }
  self.postMessage({ n, rows }, [rows.buffer]);
};
