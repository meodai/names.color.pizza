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
    {
      // a name's own page (color/<slug>/) is only written by the build; in dev that address
      // would fall back to the wall, whose links then pile up under it. So it's the color page
      // at the name's #hex; anything deeper keeps the #hex it came with
      name: "color-pages-in-dev",
      async configureServer(server) {
        const { slugsOf } = await import("./src/names.js");
        const items = existsSync(csv)
          ? readFileSync(csv, "utf8")
              .split("\n")
              .slice(1)
              .filter(Boolean)
              .map((line) => {
                const [name, hex] = line.split(",");
                return { name, hex: hex.toLowerCase() };
              })
          : [];
        const slugs = slugsOf(items);
        const hexOf = new Map(items.map((it) => [slugs.get(it.name), it.hex]));
        server.middlewares.use((req, res, next) => {
          const path = req.url.split("?")[0];
          if (!/^\/color\/[^/.]+\//.test(path)) return next();
          const hex = hexOf.get(path.match(/^\/color\/([^/]+)\/$/)?.[1]);
          res.writeHead(302, { Location: hex ? `/color/#${hex.slice(1)}` : "/color/" });
          res.end();
        });
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
