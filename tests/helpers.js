import { test as base, expect } from "@playwright/test";

// every test fails on an error the page throws, even one nothing on screen shows
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "errors thrown in the page").toEqual([]);
  },
});
export { expect };

// the wall, loaded and done flying in (its dev hook, window.__wall, says when)
// the first visit's intro is seen already, unless a test is about it (intro: true)
export async function openWall(page, path = "/", { intro = false } = {}) {
  if (!intro && !page.introSeen) {
    await page.addInitScript(() => localStorage.setItem("wall-intro-seen", "1"));
    page.introSeen = true;
  }
  await page.goto(path);
  await page.waitForFunction(() => window.__wall?.state().n > 0, null, { timeout: 45_000 });
  await page.waitForFunction(() => !window.__wall.state().busy && !window.__wall.state().anim, null, {
    timeout: 45_000,
  });
}

export const state = (page) => page.evaluate(() => window.__wall.state());
export const cam = (page) => page.evaluate(() => ({ ...window.__wall.cam }));
export const param = (page, key) => new URL(page.url()).searchParams.get(key);

// the camera settled: no flight, no eased input left
export const settled = (page) =>
  page.waitForFunction(() => {
    const s = window.__wall.state();
    return !s.anim && !s.moving && !s.busy;
  });

export async function openList(page) {
  await page.locator("[data-az]").click();
  await expect(page.locator(".az")).toBeVisible();
  await page.waitForFunction(() => window.__wall.state().azMix === 1);
  await settled(page);
}

// the search's swatch: its color, or "" when none is chosen
export const swatch = (page) =>
  page.evaluate(() => document.querySelector("input[type=color]").parentElement.style.background);
