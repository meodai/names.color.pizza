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
Prettier (`npm run format`); no tests or lint of its own. Comments only where
the code would surprise, and none in the HTML. Heavy sections load lazily from `src/main.js`:

- `src/color-space.js` — 3D point cloud across color spaces (three.js)
- `src/name-map.js` — OkHSL wheel where every pixel belongs to its closest
  name (OKLab); hatched ground has no name yet. Math in `src/okhsl.js`.
- `src/explore.js` — virtualized list of every name

Data comes from `api.color.pizza` via `src/api.js`, one memoized fetch per list.

Pages (multi-page Vite build):

- `index.html` — the color wall (`src/wall.js`): every name as a card in WebGL,
  hue across (wrapping), light to dark down, search by name or hex.
- `classic/index.html` — the previous home, the scroll of slides.
- `color/index.html` — one color at `color/#hex` (`src/detail.js`).
  Links between pages go through `siteURL()` / `colorURL()` in `src/names.js`.

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
