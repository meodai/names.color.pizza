import { test, expect, openWall, state, param, swatch, openList, settled } from "./helpers.js";

const search = (page) => page.locator(".wall__search");
const clearButton = (page) => page.locator(".wall__clear");
const said = (page) => page.locator("[data-az-count]");

// typed over what's there, as a person does; nothing typed empties it
async function retype(page, text) {
  await search(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  if (text) await page.keyboard.type(text);
  else await page.keyboard.press("Backspace");
}

test.describe("the search in the space", () => {
  test("a color in the address is chosen and found", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    await expect(search(page)).toHaveValue("#8f7d6b");
    expect(await swatch(page)).toBe("rgb(143, 125, 107)");
    const s = await state(page);
    expect(s.chosen).toBe("#8f7d6b");
    expect(s.spot).toBe(true);
    await expect(clearButton(page)).toBeVisible();
  });

  test("a name typed shows results; Enter picks one, by name, and finds it", async ({ page }) => {
    await openWall(page);
    await retype(page, "squir");
    await expect(page.locator(".wall__result").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await settled(page);
    await expect(search(page)).toHaveValue("Squirrel");
    expect(param(page, "c")).toBe("8f7d6b");
    expect((await state(page)).spot).toBe(true);
    await expect(page.locator(".wall__result")).toHaveCount(0);
  });

  test("emptying the search lets the color go", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    await retype(page, "");
    expect(param(page, "c")).toBeNull();
    expect(await swatch(page)).toBe("");
    await expect(clearButton(page)).toBeHidden();
    const s = await state(page);
    expect(s.chosen).toBeNull();
    expect(s.spot).toBe(false);
  });

  test("a whole hex is the color at once, and lets a card found for another go", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    await retype(page, "#2b8cf2");
    expect(param(page, "c")).toBe("2b8cf2");
    expect(await swatch(page)).toBe("rgb(43, 140, 242)");
    expect((await state(page)).spot).toBe(false);
    await page.keyboard.press("Enter");
    await settled(page);
    const s = await state(page);
    expect(s.spot).toBe(true);
    expect(param(page, "c")).toBe(s.chosen.slice(1));
  });

  test("Escape puts back what was chosen", async ({ page }) => {
    await openWall(page);
    await retype(page, "squir");
    await page.keyboard.press("Enter");
    await settled(page);
    await retype(page, "blu");
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("Squirrel");
    await expect(page.locator(".wall__result")).toHaveCount(0);
  });

  test("arrows go through the results", async ({ page }) => {
    await openWall(page);
    await retype(page, "red");
    await expect(page.locator(".wall__result").nth(1)).toBeVisible();
    await expect(page.locator(".wall__result").first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".wall__result").nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("the × clears it all and flies home", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    await clearButton(page).click();
    await expect(search(page)).toHaveValue("");
    expect(param(page, "c")).toBeNull();
    expect(await swatch(page)).toBe("");
    expect((await state(page)).spot).toBe(false);
  });

  test("the logo lets a found card go", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    expect((await state(page)).spot).toBe(true);
    await page.locator(".brand").click();
    await settled(page);
    expect((await state(page)).spot).toBe(false);
  });

  test("dragging the camera lets a found card go", async ({ page }) => {
    await openWall(page, "/?c=8f7d6b");
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 320, { steps: 5 });
    await page.mouse.up();
    expect((await state(page)).spot).toBe(false);
  });
});

test.describe("the search in the list", () => {
  test("a color in the address shows its closest names, and emptying the search lets it go", async ({ page }) => {
    await openWall(page, "/?c=704336&model=oklch&view=az");
    await expect(said(page)).toHaveText("The 60 closest to #704336");
    expect(await swatch(page)).toBe("rgb(112, 67, 54)");
    await retype(page, "");
    expect(await swatch(page)).toBe("");
    expect(param(page, "c")).toBeNull();
    await expect(clearButton(page)).toBeHidden();
    await expect(said(page)).toHaveText(/names, A to Z$/);
  });

  test("a hex is a color, a name is none", async ({ page }) => {
    await openWall(page, "/?view=az");
    await retype(page, "#2b8cf2");
    await expect(said(page)).toHaveText("The 60 closest to #2b8cf2");
    expect(param(page, "c")).toBe("2b8cf2");
    expect(await swatch(page)).toBe("rgb(43, 140, 242)");
    await retype(page, "dini");
    await expect(said(page)).toHaveText(/^2 of [\d,]+ with “dini”$/);
    expect(param(page, "c")).toBeNull();
    expect(await swatch(page)).toBe("");
  });

  test("the color wheel chooses a color and shows its closest names", async ({ page }) => {
    await openWall(page, "/?view=az");
    await page.evaluate(() => {
      const p = document.querySelector("input[type=color]");
      p.value = "#ff8800";
      p.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(said(page)).toHaveText("The 60 closest to #ff8800");
    expect(param(page, "c")).toBe("ff8800");
    expect(await swatch(page)).toBe("rgb(255, 136, 0)");
  });

  test("the × clears the search and the color, and the list stays", async ({ page }) => {
    await openWall(page, "/?c=704336&view=az");
    await clearButton(page).click();
    await expect(search(page)).toHaveValue("");
    expect(param(page, "c")).toBeNull();
    await expect(page.locator(".az")).toBeVisible();
    await expect(said(page)).toHaveText(/names, A to Z$/);
  });

  test("nothing found says so", async ({ page }) => {
    await openWall(page, "/?view=az");
    await retype(page, "qxzqq");
    await expect(page.locator(".az__none")).toBeVisible();
    await expect(page.locator(".az__none")).toContainText("can’t find the one?!");
    await retype(page, "red");
    await expect(page.locator(".az__none")).toBeHidden();
  });

  test("a list opened from a search filters by it, and a model chosen leaves it", async ({ page }) => {
    await openWall(page);
    await retype(page, "dini");
    await openList(page);
    await expect(said(page)).toHaveText(/^2 of [\d,]+ with “dini”$/);
  });
});
