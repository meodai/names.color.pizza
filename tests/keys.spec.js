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
    expect(Math.hypot(...b.eye.map((v, i) => v - a.eye[i]))).toBeLessThan(0.5);
  });

  test("the fly keys fly as in a game: W goes where it looks, an arrow turns on the spot, the wheel orbits again without a jump", async ({
    page,
  }) => {
    await openWall(page);
    await page.bringToFront();
    await page.evaluate(() => window.focus());
    const gap = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    const hold = async (key, until) => {
      await page.keyboard.down(key);
      await expect.poll(until, { timeout: 20_000 }).toBe(true);
      await page.keyboard.up(key);
      await settled(page);
    };
    const start = await cam(page);
    // forward along the view, the orbit's distance as it was
    await hold("w", async () => gap((await cam(page)).eye, start.eye) > 5);
    const went = await cam(page);
    const dir = went.eye.map((v, i) => (v - start.eye[i]) / gap(went.eye, start.eye));
    expect(dir.reduce((sum, v, i) => sum + v * start.fwd[i], 0)).toBeGreaterThan(0.99);
    expect(went.dist).toBeCloseTo(start.dist, 3);
    // turned about the camera, not the point it looked at
    await hold("ArrowLeft", async () => Math.abs((await cam(page)).yaw - went.yaw) > 0.05);
    const turned = await cam(page);
    expect(gap(turned.eye, went.eye)).toBeLessThan(0.5);
    // the wheel: the same view, then an orbit
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1);
    await page.waitForTimeout(50);
    expect(gap((await cam(page)).eye, turned.eye)).toBeLessThan(2);
    await settled(page);
    // the wheel zooms the orbit in again
    const orbiting = await cam(page);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await cam(page)).dist, { timeout: 20_000 }).toBeLessThan(orbiting.dist * 0.9);
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

  test("the views close on Escape, focus on the one shown", async ({ page }) => {
    await openWall(page);
    await page.locator('[data-mode][aria-checked="true"]').click();
    await expect(page.locator("[data-modes]")).toHaveClass(/is-open/);
    await page.locator('[data-mode="cells"]').focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-modes]")).not.toHaveClass(/is-open/);
    await expect(page.locator('[data-mode][aria-checked="true"]')).toBeFocused();
  });

  test("the list menu: up and down through it, Escape closes it, and the camera stays", async ({ page }) => {
    await openWall(page);
    await page.locator("[data-lists]").click();
    const menu = page.locator("[data-list-menu]");
    await expect(menu).toBeVisible();
    const items = menu.locator("[data-list]");
    const first = await page.evaluate(() => document.activeElement.dataset.list);
    const yaw = (await cam(page)).yaw;
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement.dataset.list)).not.toBe(first);
    await page.keyboard.press("ArrowUp");
    expect(await page.evaluate(() => document.activeElement.dataset.list)).toBe(first);
    expect((await cam(page)).yaw).toBeCloseTo(yaw, 1);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator("[data-lists]")).toBeFocused();
    expect(await items.count()).toBeGreaterThan(1);
  });

  test("on a phone, Escape closes the menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openWall(page);
    await page.locator("[data-menu]").click();
    await expect(page.locator("[data-menu]")).toHaveAttribute("aria-expanded", "true");
    await page.locator("body").press("Escape");
    await expect(page.locator("[data-menu]")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-menu]")).toBeFocused();
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
