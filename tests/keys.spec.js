import { test, expect, openWall, state, cam, openList, settled } from "./helpers.js";

test.describe("the keys", () => {
  test("in the space, a held arrow turns the camera and letting go stops it", async ({ page }) => {
    await openWall(page);
    // a page without focus lets go of held keys, as a window losing it does
    await page.bringToFront();
    await page.evaluate(() => window.focus());
    const before = await cam(page);
    // held until it turns: drawn in software, a frame can take a good part of a second
    await page.keyboard.down("ArrowLeft");
    await expect
      .poll(async () => Math.abs((await cam(page)).yaw - before.yaw), { timeout: 20_000 })
      .toBeGreaterThan(0.05);
    await page.keyboard.up("ArrowLeft");
    await settled(page);
    const a = await cam(page);
    await page.waitForTimeout(1500);
    expect((await cam(page)).yaw).toBeCloseTo(a.yaw, 3);
  });

  test("a key held when ⌘ goes down doesn't stay held", async ({ page }) => {
    await openWall(page);
    await page.keyboard.down("w");
    await page.waitForTimeout(150);
    await page.keyboard.down("Meta");
    await page.keyboard.up("w");
    await page.keyboard.up("Meta");
    await settled(page);
    const a = await cam(page);
    await page.waitForTimeout(400);
    const b = await cam(page);
    expect(Math.abs(b.dist - a.dist)).toBeLessThan(0.5);
  });

  test("/ goes to the search", async ({ page }) => {
    await openWall(page);
    await page.keyboard.press("/");
    await expect(page.locator(".wall__search")).toBeFocused();
  });

  test("in the list the arrows, Page and End move the list, not the camera", async ({ page }) => {
    await openWall(page, "/?view=az");
    const list = page.locator(".az__list");
    await list.evaluate((l) => (l.scrollTop = 0));
    await page.evaluate(() => document.activeElement?.blur());
    const before = await cam(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => list.evaluate((l) => l.scrollTop)).toBe(64);
    await page.keyboard.press("PageDown");
    await expect.poll(() => list.evaluate((l) => l.scrollTop)).toBeGreaterThan(400);
    await page.keyboard.press("End");
    await expect
      .poll(() => list.evaluate((l) => Math.round(l.scrollHeight - l.clientHeight - l.scrollTop)))
      .toBeLessThan(2);
    await page.keyboard.press("Home");
    await expect.poll(() => list.evaluate((l) => l.scrollTop)).toBe(0);
    const after = await cam(page);
    expect(after.yaw).toBeCloseTo(before.yaw, 3);
    expect(after.dist).toBeCloseTo(before.dist, 3);
  });

  test("in the list's search, up and down move the list", async ({ page }) => {
    await openWall(page, "/?view=az");
    const list = page.locator(".az__list");
    await list.evaluate((l) => (l.scrollTop = 0));
    await page.locator(".wall__search").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => list.evaluate((l) => l.scrollTop)).toBe(128);
  });

  test("in the view switcher the arrows go from view to view", async ({ page }) => {
    await openWall(page);
    await page.locator('[data-mode][aria-checked="true"]').click();
    await expect(page.locator("[data-modes]")).toHaveClass(/is-open/);
    await page.locator('[data-mode="colors"]').focus();
    const yaw = (await cam(page)).yaw;
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-mode="cells"]')).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-mode="colors"]')).toBeFocused();
    expect((await state(page)).view).toBe("colors");
    expect((await cam(page)).yaw).toBeCloseTo(yaw, 1);
  });

  test("a list just opened ends its entrance at the first key", async ({ page }) => {
    await openWall(page);
    await page.locator("[data-az]").click();
    await page.locator(".wall__search").click();
    await page.keyboard.type("bl");
    await expect(page.locator(".az")).not.toHaveClass(/is-entering/);
    await openList(page).catch(() => {});
  });
});
