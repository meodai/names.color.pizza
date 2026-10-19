import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// changes whenever the names do, so browsers fetch a new list from the API then
const csv = resolve(import.meta.dirname, "color-names/src/colornames.csv");
const LIST_KEY = existsSync(csv) ? createHash("sha1").update(readFileSync(csv)).digest("hex").slice(0, 8) : "dev";
import { defineConfig } from "vite";

// relative base: works as a GitHub project page without hardcoding the subpath
const MEDIA = {
  target: "https://media.color.pizza",
  changeOrigin: true,
  headers: { origin: "https://names.color.pizza" },
  rewrite: (p) => p.replace(/^\/media/, ""),
};

export default defineConfig({
  base: "./",
  define: { __LIST_KEY__: JSON.stringify(LIST_KEY) },
  // the bucket under the local preview's own address: it lets only the site read it into
  // WebGL, and its edge cache would hand a local origin's answer to the site. Asked as the
  // site, so what lands in the cache is just what the site gets
  server: { proxy: { "/media": MEDIA } },
  preview: { proxy: { "/media": MEDIA } },
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
        color: resolve(import.meta.dirname, "color/index.html"),
        adopt: resolve(import.meta.dirname, "adopt/index.html"),
        supporters: resolve(import.meta.dirname, "supporters/index.html"),
        legal: resolve(import.meta.dirname, "legal/index.html"),
        notFound: resolve(import.meta.dirname, "not-found/index.html"),
      },
    },
  },
  // the submit form reads ../tests/protected-targets.json
  server: {
    fs: { allow: [".."] },
  },
});
