# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A promotional **microsite** for the color-names project (the `color-name-list` npm
package, served at color.pizza). The site is a single, top-to-bottom scroll built
as a sequence of full-bleed **slides** — each section is one moment with minimal
copy.

This is the upstream project the microsite promotes:

- Live page: https://names.color.pizza/
- API: `api.color.pizza` (e.g. `api.color.pizza/v1/?values=00f,f00&list=bestOf`)
- Package: `npm install color-name-list`
- Lists: Full · Best Of · Short. License: MIT.

## Current state

Lives in `website/` of the color-names repo. Vite, plain ES modules, no
framework: `npm run dev`, `npm run build`, `npm run preview`. Formatted with
Prettier (`npm run format`). Comments only where the code would surprise, and
none in the HTML.

`npm test` runs Playwright end-to-end tests (`tests/`) against the dev server:
the address and views, the list, the search, the keys, a color's page over the
wall, the adopt page, and regressions from the history. Any error the page
throws fails a test. They use the wall's dev-only hook, `window.__wall`. Run
them before and after any change to the wall.

Data comes from `api.color.pizza` via `src/api.js`, one memoized fetch per list.

Pages (multi-page Vite build):

- `index.html` — the color wall (`src/wall.js`): every name as a card in WebGL,
  placed by color model (RGB, OKLab, OKLCH, HSL), shown as colors, cells or
  pixel art, or as the A–Z list; search by name or hex. `src/wall.js` keeps the
  camera, the drawing loop and the card's flights; the rest is in `src/wall/`:
  `address.js` (in `src/`, the only code that reads or writes the wall's
  query), `views.js` (the view switch), `search.js`, `list.js` (A–Z),
  `keys.js` (one router giving each key to one owner), `page.js` (a color's
  page over the wall), `renderer.js`, `models.js`, `math.js`.
- `color/index.html` — one color at `color/#hex` (`src/detail.js`); the build
  writes one page per name at `color/<slug>/`.
  Links between pages go through `siteURL()` / `colorURL()` in `src/names.js`.
- `adopt/`, `supporters/`, `legal/`, `not-found/`.

## Source of truth for content

`docs/contents.md` defines the copy and the slide sequence. Treat it as the spec.
Key conventions it establishes:

- **Slides, not paragraphs.** A few words per slide. "If a slide needs a paragraph,
  it's trying to do two slides' work."
- **Voice:** warm, precise, a little playful. Pro-human, never anti-AI. The "made by
  people, not machines" point is made once, gently.
- **Audience:** designers/artists, the curious public, developers, and would-be
  contributors/sponsors — every door should be findable.
- **Dynamic values** in `{{ }}` are computed at **build time**, never hardcoded:
  - `{{colorCount}}` — total number of names
  - `{{yearsRunning}}` — years since the repo's first git commit
  - `{{namedFraction}}` — share of RGB space named
  - These derive from upstream data (the color-name-list dataset / git history), so
    computing them means pulling from that source at build, not committing a literal.

The slide order in `docs/contents.md` is explicitly a first draft with open
questions (hero headline, slide order, number of decorative quote interludes) noted
at the bottom — check those before treating order as final.
