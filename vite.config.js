import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the build works as a GitHub project page
// (e.g. meodai.github.io/color-names/) without hardcoding the subpath.
export default defineConfig({
  base: './',
  // three pages: the color wall (home), the classic scroll of slides, and
  // the page for one color (color/#5c3a8e)
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        classic: resolve(import.meta.dirname, 'classic/index.html'),
        color: resolve(import.meta.dirname, 'color/index.html'),
      },
    },
  },
  // The submit form reads tests/protected-targets.json from the repo, one
  // level up, so the dev server may serve from there.
  server: {
    fs: { allow: ['..'] },
  },
});
