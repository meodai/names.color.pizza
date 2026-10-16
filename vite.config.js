import { resolve } from "node:path";
import { defineConfig } from "vite";

// relative base: works as a GitHub project page without hardcoding the subpath
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "strip-html-comments",
      transformIndexHtml: {
        order: "post",
        handler: (html) => html.replace(/\s*<!--[\s\S]*?-->/g, ""),
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        classic: resolve(import.meta.dirname, "classic/index.html"),
        color: resolve(import.meta.dirname, "color/index.html"),
        legal: resolve(import.meta.dirname, "legal/index.html"),
      },
    },
  },
  // the submit form reads ../tests/protected-targets.json
  server: {
    fs: { allow: [".."] },
  },
});
