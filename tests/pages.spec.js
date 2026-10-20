import { test, expect, openWall, state } from "./helpers.js";

const inert = (page) =>
  page.evaluate(() =>
    [...document.querySelector("[data-wall]").children].filter((e) => e.inert).map((e) => e.className.split(" ")[0]),
  );

test.describe("a color's page over the wall", () => {
  test("opens at the color's address, with the wall out of reach and focus in the page", async ({ page }) => {
    await openWall(page);
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    expect(new URL(page.url()).pathname).toBe("/color/");
    expect(new URL(page.url()).hash).toBe("#e56e24");
    const away = await inert(page);
    expect(away).toEqual(expect.arrayContaining(["wall__bar", "wall__dock", "wall__canvas"]));
    expect(away).not.toContain("brand");
    expect(await page.evaluate(() => !!document.activeElement.closest(".wall__page"))).toBe(true);
  });

  test("closes back to the wall, everything in reach again", async ({ page }) => {
    await openWall(page);
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    await page.locator(".wall__page [data-close]").click();
    await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await inert(page)).toEqual([]);
  });

  test("Back closes it too", async ({ page }) => {
    await openWall(page);
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    await page.goBack();
    await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("in pixel art the address says so, and stops saying so once it's off", async ({ page }) => {
    await openWall(page, "/?view=pixel");
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    expect(new URL(page.url()).searchParams.get("view")).toBe("pixel");
    await page.goBack();
    await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
    await page.evaluate(async () => (await import("/src/pixel-mode.js")).setPixelMode(false));
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    expect(new URL(page.url()).searchParams.get("view")).toBeNull();
  });

  test("Back right away in pixel art brings the card home", async ({ page }) => {
    await openWall(page, "/?view=pixel");
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForTimeout(700);
    await page.goBack();
    await page.waitForFunction(() => !window.__wall.state().busy, null, { timeout: 10_000 });
    expect(await page.locator(".wall__handoff").count()).toBe(0);
    expect((await state(page)).open).toBe(false);
  });

  test("back from a color to the list it was opened from: no stray label, the list in place", async ({ page }) => {
    await openWall(page, "/?view=az");
    await page.locator(".az__row").nth(3).click();
    await page.waitForURL(/\/color\//);
    await page.locator("[data-close]").click();
    await page.waitForURL(/view=az/);
    await page.waitForFunction(() => window.__wall?.state().n > 0);
    await expect(page.locator(".az")).toBeVisible();
    await expect(page.locator(".wall__label:not([hidden])")).toHaveCount(0);
    const top = await page.locator(".az__list").evaluate((l) => parseFloat(l.style.getPropertyValue("--az-top")));
    expect(top).toBeGreaterThan(30);
  });
});

test.describe("the color page on its own", () => {
  test("a part's # scrolls there and keeps the hex", async ({ page }) => {
    await page.goto("/color/#e56e24");
    await expect(page.locator(".anchor").nth(1)).toBeAttached({ timeout: 30_000 });
    await expect(page.locator("[data-name]")).toHaveText("24 Carrot");
    await page
      .locator(".anchor")
      .nth(1)
      .evaluate((a) => a.click());
    expect(new URL(page.url()).hash).toBe("#e56e24");
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
    await expect(page.locator("[data-name]")).toHaveText("24 Carrot");
  });

  test("an odd hash doesn't break it", async ({ page }) => {
    await page.goto("/color/#-");
    await page.waitForURL((u) => u.pathname === "/");
  });

  test("a name's own address opens its color in dev, keeping the query", async ({ page }) => {
    await page.goto("/color/squirrel/?view=pixel");
    expect(new URL(page.url()).pathname).toBe("/color/");
    expect(new URL(page.url()).searchParams.get("view")).toBe("pixel");
    expect(new URL(page.url()).hash).toBe("#8f7d6b");
  });

  test("a pile of color/ segments falls back to the color page with its hex", async ({ page }) => {
    await page.goto("/color/squirrel/color/color/#72a7e1");
    expect(new URL(page.url()).pathname).toBe("/color/");
    expect(new URL(page.url()).hash).toBe("#72a7e1");
  });
});

test.describe("the list's drawings", () => {
  test("in pixel art each name has its drawing", async ({ page }) => {
    await openWall(page, "/?view=pixel");
    await page.locator("[data-az]").click();
    await expect(page.locator("img.az__icon").first()).toBeVisible({ timeout: 30_000 });
  });

  test("pixel art turned off takes them away", async ({ page }) => {
    await openWall(page, "/?view=pixel");
    await page.locator("[data-az]").click();
    await expect(page.locator("img.az__icon").first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(async () => (await import("/src/pixel-mode.js")).setPixelMode(false));
    await expect(page.locator(".az__icon")).toHaveCount(0);
  });
});
