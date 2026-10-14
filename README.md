<img align="left" height="96" width="96" src="https://names.color.pizza/logo/cockatoo-fill.svg" alt="Color Names logo" />

# names.color.pizza

Every name in the [Color Names](https://github.com/meodai/color-names) list, one page each.

**[names.color.pizza](https://names.color.pizza)**

<br clear="left" />

The home page is a wall of all ~32,000 names as cards, hue across and light to dark down, with search by name or hex. Each name gets its own page: what the color looks like in words, how it mixes on screen and in print, its neighbors and complements, what Wikipedia and Wiktionary say about the name, and pictures and public-domain art that share its color.

## Where things come from

| What                                            | From                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The names                                       | [`meodai/color-names`](https://github.com/meodai/color-names), checked out at build time; its git history gives each name's "added on" date |
| Wikipedia and Wiktionary text, Commons pictures | the `data` branch, renewed every night by [`scripts/collect.mjs`](scripts/collect.mjs)                                                      |
| One-sentence descriptions                       | the `descriptions` branch, written by a language model for each new name                                                                    |
| Art and pictures, their palettes and credits    | [media.color.pizza](https://media.color.pizza), and as a public dump in [`meodai/art-colors`](https://github.com/meodai/art-colors)         |
| Link previews                                   | rendered at build time by [`scripts/previews.mjs`](scripts/previews.mjs)                                                                    |

The art comes from the open-access collections of the [Cleveland Museum of Art](https://www.clevelandart.org/open-access), the [Art Institute of Chicago](https://www.artic.edu/open-access/open-access-images) and the [Metropolitan Museum of Art](https://www.metmuseum.org/hubs/open-access), and from the [Public Domain Image Archive](https://pdimagearchive.org) of The Public Domain Review. Pictures from Wikimedia Commons keep their own licenses; each one shows its author and license on the page.

## Run it

```sh
git clone https://github.com/meodai/names.color.pizza
cd names.color.pizza
git clone https://github.com/meodai/color-names   # the list and its history
git worktree add .data data                       # optional: the nightly copies
git worktree add .descriptions descriptions       # optional: the descriptions
npm install
npm run dev
```

`npm run build` makes the full static site in `dist/`: the pages from Vite, then a page per name, the sitemap and the link previews. Without `.data` the pages have no Wikipedia text; without `.descriptions`, no descriptions. Prettier keeps the code tidy: `npm run format`.

## Deploying

A push to `main` builds the site and deploys it to GitHub Pages ([`deploy.yml`](.github/workflows/deploy.yml)). Every night [`data.yml`](.github/workflows/data.yml) renews the `data` branch and rebuilds the site.

## License

MIT, like the [Color Names](https://github.com/meodai/color-names) list.
