import { test, expect } from "./helpers.js";

test.describe("the adopt page", () => {
  test("its button does nothing until the page knows what it adopts", async ({ page }) => {
    // the markup as served, before any script
    const html = await (await page.request.get("/adopt/")).text();
    expect(html).toMatch(/<a class="adopt__cta" aria-disabled="true" data-cta>/);
    expect(html).not.toMatch(/buy\.stripe\.com/);
  });

  test("shown as just a name by default; a name enables paying for that color", async ({ page }) => {
    await page.goto("/adopt/#e56e24");
    await expect(page.locator("[data-on]")).toHaveValue("name");
    await expect(page.locator("[data-by]")).toHaveAttribute("placeholder", "Your name");
    const cta = page.locator("[data-cta]");
    await expect(cta).toContainText("Adopt 24 Carrot");
    await expect(cta).toHaveAttribute("aria-disabled", "true");
    await page.locator("[data-by]").fill("David");
    await expect(cta).toHaveAttribute("aria-disabled", "false");
    await expect(cta).toHaveAttribute("href", /client_reference_id=/);
    await expect(cta.locator(".hero__heart")).toBeAttached();
  });

  test("a taken color offers the free ones near it", async ({ page }) => {
    await page.goto("/adopt/?c=liberty");
    await expect(page.locator("[data-name]")).toHaveText("Liberty is adopted.");
    const others = page.locator(".adopt__others a");
    await expect(others.first()).toBeVisible();
    const name = await others.first().textContent();
    await others.first().click();
    await expect(page.locator("[data-name]")).toHaveText(`Adopt ${name}.`);
    await expect(page.locator(".adopt__others")).toBeHidden();
  });
});
