self.onmessage = (e) => {
  const { X, Y, Z, r, lo, voxel, dims } = e.data;
  const n = X.length;
  const [nx, ny, nz] = dims;

  // a little wider than a name's reach, so 3×3×3 neighbor cells suffice
  const G = r + voxel;
  const gx = Math.ceil((nx * voxel) / G) + 2;
  const gy = Math.ceil((ny * voxel) / G) + 2;
  const gz = Math.ceil((nz * voxel) / G) + 2;
  const cellOf = (x, y, z) => {
    const ix = Math.min(gx - 1, Math.max(0, Math.floor((x - lo[0]) / G) + 1));
    const iy = Math.min(gy - 1, Math.max(0, Math.floor((y - lo[1]) / G) + 1));
    const iz = Math.min(gz - 1, Math.max(0, Math.floor((z - lo[2]) / G) + 1));
    return (iz * gy + iy) * gx + ix;
  };
  const cells = gx * gy * gz;
  const start = new Int32Array(cells + 1);
  const home = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    home[i] = cellOf(X[i], Y[i], Z[i]);
    start[home[i] + 1]++;
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[home[i]]++] = i;

  const owners = new Uint16Array(nx * ny * nz);
  // past r by about half a cell's diagonal, so the quick nearest-grid-point check never misses
  const reach = r + voxel * 0.9;
  const r2 = reach * reach;
  let k = 0;
  for (let vz = 0; vz < nz; vz++) {
    const z = lo[2] + (vz + 0.5) * voxel;
    const iz = Math.floor((z - lo[2]) / G) + 1;
    for (let vy = 0; vy < ny; vy++) {
      const y = lo[1] + (vy + 0.5) * voxel;
      const iy = Math.floor((y - lo[1]) / G) + 1;
      for (let vx = 0; vx < nx; vx++, k++) {
        const x = lo[0] + (vx + 0.5) * voxel;
        const ix = Math.floor((x - lo[0]) / G) + 1;
        let best = -1;
        let bd = r2;
        for (let dz = -1; dz <= 1; dz++) {
          const cz = iz + dz;
          if (cz < 0 || cz >= gz) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const cy = iy + dy;
            if (cy < 0 || cy >= gy) continue;
            const row = (cz * gy + cy) * gx;
            for (let dx = -1; dx <= 1; dx++) {
              const cx = ix + dx;
              if (cx < 0 || cx >= gx) continue;
              const c = row + cx;
              for (let s = start[c], e2 = start[c + 1]; s < e2; s++) {
                const i = order[s];
                const d = (X[i] - x) ** 2 + (Y[i] - y) ** 2 + (Z[i] - z) ** 2;
                if (d < bd) {
                  bd = d;
                  best = i;
                }
              }
            }
          }
        }
        owners[k] = best + 1;
      }
    }
    if (vz % 16 === 0) self.postMessage({ progress: vz / nz });
  }
  self.postMessage({ owners }, [owners.buffer]);
};
