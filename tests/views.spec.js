import { test, expect, openWall, state, param, cam, openList, settled } from "./helpers.js";

test.describe("the address and the views", () => {
  test("the count in the title comes from the list", async ({ page }) => {
    await openWall(page);
    await expect(page).toHaveTitle(/^Color Names — [\d,]+ colors, named by people$/);
    expect(await page.title()).not.toContain("{{");
  });

  test("a model in the address is the one shown, and choosing another writes it", async ({ page }) => {
    await openWall(page, "/?model=oklch");
    expect((await state(page)).model).toBe("oklch");
    await expect(page.locator('[data-model="oklch"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-model="hsl"]').click();
    expect((await state(page)).model).toBe("hsl");
    expect(param(page, "model")).toBe("hsl");
  });

  test("view=cells opens in cells and keeps it in the address", async ({ page }) => {
    await openWall(page, "/?view=cells");
    await page.waitForFunction(() => window.__wall.state().cellsMix === 1, null, { timeout: 60_000 });
    expect((await state(page)).view).toBe("cells");
    expect(param(page, "view")).toBe("cells");
    await expect(page.locator('[data-mode="cells"]')).toHaveAttribute("aria-checked", "true");
  });

  test("view=pixel opens in pixel art", async ({ page }) => {
    await openWall(page, "/?view=pixel");
    expect((await state(page)).view).toBe("pixel");
    expect(param(page, "view")).toBe("pixel");
    await expect(page.locator("html")).toHaveClass(/is-pixel/);
  });

  test("no view in the address is the colors, and the address stays without one", async ({ page }) => {
    await openWall(page);
    expect((await state(page)).view).toBe("colors");
    expect(param(page, "view")).toBeNull();
  });

  test("view=az opens on the list at once: no entrance, no flight, nothing drawn behind", async ({ page }) => {
    await openWall(page, "/?view=az");
    await expect(page.locator(".az")).toBeVisible();
    await expect(page.locator(".az")).not.toHaveClass(/is-entering/);
    const s = await state(page);
    expect(s.view).toBe("az");
    expect(s.azMix).toBe(1);
    expect(s.idle).toBe(false);
    expect(await page.locator(".az__row").count()).toBeGreaterThan(5);
    // the rows start below the header, not under it
    const top = await page.locator(".az__list").evaluate((l) => parseFloat(l.style.getPropertyValue("--az-top")));
    expect(top).toBeGreaterThan(30);
  });

  test("the list pulls the camera out and back to where it was", async ({ page }) => {
    await openWall(page);
    await page.evaluate(() => Object.assign(window.__wall.cam, { dist: 150, yaw: 1.1, pitch: 0.3 }));
    // the idle turn goes on until the list opens: what it opens from is what it comes back to
    const before = await cam(page);
    await openList(page);
    expect(param(page, "view")).toBe("az");
    expect(Math.round((await cam(page)).dist)).toBe(860);
    await page.locator(".brand").click();
    await expect(page.locator(".az")).toBeHidden();
    await settled(page);
    const c = await cam(page);
    expect(Math.round(c.dist)).toBe(150);
    expect(c.yaw).toBeCloseTo(before.yaw, 1);
    expect(c.pitch).toBeCloseTo(before.pitch, 2);
    expect(param(page, "view")).toBeNull();
    expect((await state(page)).azMix).toBe(0);
  });

  test("the logo from a list opened by link goes back to the model in the address, else RGB", async ({ page }) => {
    await openWall(page, "/?view=az");
    await page.locator(".brand").click();
    await expect(page.locator(".az")).toBeHidden();
    expect((await state(page)).model).toBe("rgb");
    await openWall(page, "/?model=oklab&view=az");
    await page.locator(".brand").click();
    await expect(page.locator(".az")).toBeHidden();
    expect((await state(page)).model).toBe("oklab");
  });

  test("a model chosen from the list leaves the list for it", async ({ page }) => {
    await openWall(page);
    await openList(page);
    await page.locator('[data-model="oklch"]').click();
    await expect(page.locator(".az")).toBeHidden();
    const s = await state(page);
    expect(s.view).toBe("colors");
    expect(s.model).toBe("oklch");
  });
});
