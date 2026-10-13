# Color Names — Microsite Contents

The text content for the microsite. One single, top-to-bottom scroll, built as a
sequence of **slides**: each section is one full-bleed moment. Minimal words. This doc is only about the copy — what each slide _says_.

**Voice:** warm, precise, a little playful. Pro-human, never anti-AI

**Slide rule:** if a slide needs a paragraph, it's trying to do two slides' work.
A few words per slide.

**Audience:** designers & artists, the curious public, developers, and would-be
contributors/sponsors — everyone should find their door in.

**Dynamic values:** anything in `{{ }}` is computed at build time, not hardcoded.

- `{{yearsRunning}}` — years since the first git commit of the repo.
- `{{colorCount}}` — total number of names (currently 31,908).
- `{{namedFraction}}` — share of RGB space named (currently ~0.19%).

> Section order is a first draft — to be reviewed in this doc.

---

Actual page :D

https://meodai.github.io/color-names/

Oldish bot page:
https://parrot.color.pizza/

Possible Section pens:
https://codepen.io/meodai/pen/zdgXJj
https://codepen.io/meodai/pen/oNEbJPo
https://codepen.io/meodai/pen/wvXWyrw
https://codepen.io/editor/meodai/pen/019f0e2a-86fc-7ab0-bb81-9fca26a7db6e
https://codepen.io/meodai/pen/YzgrwPz/517f3bb82f97ba90f77af0a4aff9f786
https://codepen.io/meodai/pen/qBMqwvw/e6b942944f629daf57ca909d9d032c0e
https://codepen.io/meodai/pen/YzjwZmq/c79a77bc747d527a6ac2a609dfac0e4a
https://codepen.io/meodai/pen/QZmjWe

---

## Claim

- "Every color deserves a name." _(or)_ "{{colorCount}} colors, named by people."

---

## Quote — decorative interlude

> The names of color function like a thread attached to a frightfully slender
> needle, capable of stitching together our most delicate emotions and memories.
> When the needle hits the target, we feel either pleasure or empathy.
>
> — Kenya Hara, _White_

---

## What this is

- "{{colorCount}} color names. Each one chosen by a person."

---

## Live name search

- "Find a color. Or find a name."

---

## The scale & the hunt

- "So far, {{namedFraction}} of all colors have a name."

---

## Nearest named color

- "Pick any color — meet its closest name."

---

## Wall of names — Best Of

- "A few favorites."

---

## How it's made — people, time, rules

- "{{yearsRunning}} years. By hand."
- The rules: Title Case · original & clear · no duplicates · no slurs or brands.
- Said once, gently: we prefer names made by people over names made by machines.
- Stat line: {{colorCount}} names · {{yearsRunning}} years · [N] contributors.

---

## Use it

- "Free, open, drop it in."
- `npm install color-name-list`
- Formats: JSON · CSV · YAML · TOON · UMD · XML · HTML · SCSS
- API: `api.color.pizza` — no limits, self-hostable.
  - e.g. `api.color.pizza/v1/?values=00f,f00&list=bestOf`
- Lists: Full · Best Of · Short. License: MIT.

---

## Contribute & support

- "Add a name." · "Keep it alive."
- "Submit a name" → GitHub. "Sponsor" → GitHub Sponsors.
- Runs on ~$540/year, community-funded.

---

## Footer

- "Made by people. Add yours."
- Links: GitHub · API · related tools · License (MIT).

---

## Open questions / to decide

- Final slide order (esp. whether "How it's made" should come earlier).
- Exact hero headline.
- Whether one decorative quote is enough, or a couple of quote-breaths punctuate
  the scroll.
