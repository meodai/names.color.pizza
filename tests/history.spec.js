import { test, expect, openWall, state, cam, param, settled } from "./helpers.js";

// things the site has gone wrong on before, each kept right from now on (the commit it was
// fixed in, in brackets)

const waitFree = (page) => page.waitForFunction(() => !window.__wall.state().busy && !window.__wall.state().anim);

test.describe("lists", () => {
  test("switching lists lets the found color and the hover go, and the address follows (6f14c9a6b)", async ({
    page,
  }) => {
    await openWall(page, "/?c=e56e24");
    const before = await state(page);
    expect(before.spot).toBe(true);
    await page.locator("[data-lists]").click();
    await page.locator('[data-list="short"]').click();
    await page.waitForFunction(() => window.__wall.state().list === "short" && !window.__wall.state().busy);
    const s = await state(page);
    expect(s.n).toBeLessThan(before.n);
    expect(s.spot).toBe(false);
    expect(s.chosen).toBeNull();
    expect(param(page, "list")).toBe("short");
    expect(param(page, "c")).toBeNull();
    await expect(page.locator("[data-tip]")).toBeHidden();
    await expect(page.locator('[data-list="short"]')).toHaveAttribute("aria-checked", "true");
    await page.locator("[data-lists]").click();
    await page.locator('[data-list="default"]').click();
    await page.waitForFunction(() => window.__wall.state().list === "default" && !window.__wall.state().busy);
    expect(param(page, "list")).toBeNull();
  });

  test("a list that doesn't load leaves the one shown, in the address too", async ({ page }) => {
    await page.route(/api\.color\.pizza\/.*list=short/, (r) => r.abort());
    await openWall(page);
    await page.locator("[data-lists]").click();
    await page.locator('[data-list="short"]').click();
    await expect(page.locator("[data-status]")).toContainText("didn’t load");
    await waitFree(page);
    expect((await state(page)).list).toBe("default");
    await expect(page.locator('[data-list="default"]')).toHaveAttribute("aria-checked", "true");
    expect(param(page, "list")).toBeNull();
  });

  test("the API's list is asked for by its version, not from an old cache (8d0738f92)", async ({ page }) => {
    const asked = [];
    page.on("request", (r) => r.url().includes("api.color.pizza") && asked.push(r.url()));
    await openWall(page);
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) expect(new URL(url).searchParams.get("v")).toBeTruthy();
  });
});

test.describe("cells", () => {
  test("a model chosen while the cells are worked out gets its own (6f14c9a6b)", async ({ page }) => {
    await openWall(page, "/?view=cells");
    await page.locator('[data-model="oklab"]').click();
    await page.waitForFunction(() => window.__wall.state().cellsMix === 1, null, { timeout: 90_000 });
    const s = await state(page);
    expect(s.model).toBe("oklab");
    expect(s.view).toBe("cells");
  });

  test("a list chosen while the cells are worked out gets its own (6f14c9a6b)", async ({ page }) => {
    await openWall(page, "/?view=cells");
    await page.locator("[data-lists]").click();
    await page.locator('[data-list="bestOf"]').click();
    await page.waitForFunction(
      () => window.__wall.state().list === "bestOf" && window.__wall.state().cellsMix === 1,
      null,
      { timeout: 90_000 },
    );
    expect((await state(page)).view).toBe("cells");
  });
});

test.describe("the camera", () => {
  test("home, by key or button, lets a found card go (18bb52071)", async ({ page }) => {
    await openWall(page, "/?c=e56e24");
    expect((await state(page)).spot).toBe(true);
    await page.locator("[data-home]").click();
    expect((await state(page)).spot).toBe(false);
    for (const key of ["+", "-", "0"]) {
      await openWall(page, "/?c=e56e24");
      expect((await state(page)).spot).toBe(true);
      await page.keyboard.press(key);
      expect((await state(page)).spot, `after ${key}`).toBe(false);
    }
  });

  test("going home starts the turning again once it's there (7d8f875a6)", async ({ page }) => {
    await openWall(page);
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 330, { steps: 5 });
    await page.mouse.up();
    await settled(page);
    expect((await state(page)).idle).toBe(false);
    await page.locator("[data-home]").click();
    await page.waitForFunction(() => window.__wall.state().idle);
  });

  test("with reduced motion it doesn't turn on its own", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWall(page);
    expect((await state(page)).idle).toBe(false);
    // away from home first: only then is there a home button
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 330, { steps: 5 });
    await page.mouse.up();
    await settled(page);
    await page.locator("[data-home]").click();
    await settled(page);
    expect((await state(page)).idle).toBe(false);
  });

  test("a found card on a phone stays under the size where cards dissolve (f63eb411f)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openWall(page, "/?c=e56e24");
    await settled(page);
    const w = await page.evaluate(() => window.__wall.box("#e56e24").w);
    expect(w).toBeLessThan(0.5 * 320);
  });

  test("typing in the search never flies the camera (89b8b8156)", async ({ page }) => {
    await openWall(page);
    await page.locator(".wall__search").click();
    const before = await cam(page);
    await page.keyboard.type("wasd");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowLeft");
    const after = await cam(page);
    expect(after.target).toEqual(before.target);
    expect(after.dist).toBeCloseTo(before.dist, 5);
    expect((await state(page)).moving).toBe(false);
  });

  test("nothing is drawn behind an open page (6f14c9a6b)", async ({ page }) => {
    await page.addInitScript(() => {
      window.__draws = 0;
      const count = (proto) => {
        const real = proto.drawArraysInstanced;
        proto.drawArraysInstanced = function (...a) {
          window.__draws++;
          return real.apply(this, a);
        };
      };
      count(WebGL2RenderingContext.prototype);
    });
    await openWall(page);
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    await page.waitForTimeout(1500);
    const a = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__draws)).toBe(a);
  });
});

test.describe("a color's page over the wall", () => {
  test("its neighbors are steps of their own: Back goes to the one before, close back to the wall (1cdc2069b, e9dac834c)", async ({
    page,
  }) => {
    await openWall(page);
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    const neighbors = page.locator(".wall__page [data-neighbors] a");
    await expect(neighbors.first()).toBeVisible({ timeout: 30_000 });
    await neighbors.nth(0).click();
    await page.waitForFunction(() => location.hash !== "#e56e24");
    const second = new URL(page.url()).hash;
    await expect(neighbors.nth(1)).toBeVisible({ timeout: 30_000 });
    await neighbors.nth(1).click();
    await page.waitForFunction((h) => location.hash !== h, second);
    await page.goBack();
    await page.waitForFunction((h) => location.hash === h, second);
    expect((await state(page)).open).toBe(true);
    await page.locator(".wall__page [data-close]").click();
    await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("the card handed over is gone once the page's own shows, and after closing (a41dd4bb0)", async ({ page }) => {
    for (const path of ["/", "/?view=pixel"]) {
      await openWall(page, path);
      await page.evaluate(() => window.__wall.open("#e56e24"));
      await page.waitForFunction(() => window.__wall.state().open);
      await expect(page.locator(".wall__page .color-hero__card .swatchcard--visible")).toBeAttached();
      await expect(page.locator(".wall__handoff")).toHaveCount(0);
      await page.goBack();
      await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
      await expect(page.locator(".wall__handoff")).toHaveCount(0);
    }
  });

  test("open and close with reduced motion (c45760282)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWall(page);
    for (const hex of ["#e56e24", "#72a7e1"]) {
      await page.evaluate((h) => window.__wall.open(h), hex);
      await page.waitForFunction(() => window.__wall.state().open);
      expect(await page.evaluate(() => !!document.activeElement.closest(".wall__page"))).toBe(true);
      await page.locator(".wall__page [data-close]").click();
      await page.waitForFunction(() => !window.__wall.state().open && !window.__wall.state().busy);
      expect(
        await page.evaluate(() => [...document.querySelector("[data-wall]").children].filter((e) => e.inert).length),
      ).toBe(0);
    }
  });

  test("a page on its own closes back to the wall as it was left (e9dac834c)", async ({ page }) => {
    await openWall(page, "/?model=oklab&list=bestOf");
    await page.evaluate(() => window.__wall.open("#e56e24"));
    await page.waitForFunction(() => window.__wall.state().open);
    const hex = new URL(page.url()).hash.slice(1);
    await page.reload();
    await page.locator("[data-close]").click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.waitForFunction(() => window.__wall?.state().n > 0);
    expect(param(page, "model")).toBe("oklab");
    expect(param(page, "list")).toBe("bestOf");
    expect(param(page, "c")).toBe(hex);
  });
});

test.describe("pixel art for the visit", () => {
  test("asked for once, kept for the visit; the colors in the address for that page only (7c99cfc7c)", async ({
    page,
  }) => {
    await openWall(page, "/?view=pixel");
    await openWall(page, "/");
    expect((await state(page)).view).toBe("pixel");
    // the colors asked for by the address are that page's; the visit stays in pixel art
    await openWall(page, "/?view=colors");
    expect((await state(page)).view).toBe("colors");
    await openWall(page, "/");
    expect((await state(page)).view).toBe("pixel");
  });
});

test.describe("the search", () => {
  test("ignores accents: creme finds Crème (c448a2b16)", async ({ page }) => {
    await openWall(page);
    await page.locator(".wall__search").click();
    await page.keyboard.type("creme");
    await expect(
      page
        .locator(".wall__result-name")
        .filter({ hasText: /^Crème/ })
        .first(),
    ).toBeVisible();
    await openWall(page, "/?view=az");
    await page.locator(".wall__search").click();
    await page.keyboard.type("creme");
    await expect(
      page
        .locator(".az__row strong")
        .filter({ hasText: /^Crème/ })
        .first(),
    ).toBeVisible();
  });
});

test.describe("first visits", () => {
  test("the intro shows once, until closed (2343c7328)", async ({ page }) => {
    await openWall(page, "/", { intro: true });
    await expect(page.locator("[data-intro]")).toBeVisible();
    await page.locator("[data-intro-close]").click();
    await expect(page.locator("[data-intro]")).toBeHidden();
    await openWall(page, "/", { intro: true });
    await page.waitForTimeout(1000);
    await expect(page.locator("[data-intro]")).toBeHidden();
  });

  test("the intro's invitation folds under its count, opened and closed by it", async ({ page }) => {
    await openWall(page, "/", { intro: true });
    const fold = page.locator(".wall__intro-adopt");
    const summary = page.locator("[data-adopted-count]");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(/adopted by|Support the list/);
    await expect(fold).not.toHaveAttribute("open");
    await expect(fold.locator("p")).toBeHidden();
    await summary.click();
    await expect(fold).toHaveAttribute("open");
    await expect(fold.locator("p")).toBeVisible();
    await summary.click();
    await expect(fold).not.toHaveAttribute("open");
  });

  test("over the GitHub chip, top right; the ? beside GitHub brings it back and says so", async ({ page }) => {
    await openWall(page, "/", { intro: true });
    const help = page.locator("[data-intro-open]");
    const intro = page.locator("[data-intro]");
    await expect(intro).toBeVisible();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    // measured once it has come in, its buttons too
    await page.waitForTimeout(1500);
    // over the chip: its top with the chip's, its right edge with the chip's, clear of the search
    const [h, i] = [await help.boundingBox(), await intro.boundingBox()];
    const find = await page.locator("[data-find]").boundingBox();
    expect(i.x).toBeGreaterThan(find.x + find.width + 8);
    expect(i.y).toBeLessThanOrEqual(h.y + 1);
    expect(Math.abs(i.x + i.width - (h.x + h.width))).toBeLessThan(2);
    // the buttons to the right
    const got = await page.locator("[data-intro-close]").boundingBox();
    expect(i.x + i.width - (got.x + got.width)).toBeLessThan(40);
    await page.locator("[data-intro-close]").click();
    await expect(intro).toBeHidden();
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await help.click();
    await expect(intro).toBeVisible();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-intro-close]")).toBeFocused();
  });

  test("its × closes it too, and it goes as it came", async ({ page }) => {
    await openWall(page, "/", { intro: true });
    const intro = page.locator("[data-intro]");
    await expect(intro).toBeVisible();
    await page.locator("[data-intro-x]").click();
    await expect(intro).toHaveClass(/is-leaving/);
    await expect(intro).toBeHidden();
    await expect(page.locator("[data-intro-open]")).toBeVisible();
  });

  test("on a phone: no ?, and the intro bottom left as before", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openWall(page, "/", { intro: true });
    await expect(page.locator("[data-intro-open]")).toBeHidden();
    const i = await page.locator("[data-intro]").boundingBox();
    expect(i.x).toBeLessThan(30);
    expect(i.y + i.height).toBeGreaterThan(500);
  });

  test("the View label beside the switch opens it too", async ({ page }) => {
    await openWall(page);
    const hint = page.locator("[data-mode-hint]");
    await expect(hint).toBeVisible();
    await hint.click();
    await expect(page.locator("[data-modes]")).toHaveClass(/is-open/);
  });

  test("the search's hint shimmers until it's first used (dcde584c2)", async ({ page }) => {
    await openWall(page);
    await expect(page.locator("[data-hint]")).toHaveClass(/is-new/);
    await page.locator(".wall__search").click();
    await page.keyboard.type("r");
    await expect(page.locator("[data-hint]")).not.toHaveClass(/is-new/);
    await openWall(page);
    await expect(page.locator("[data-hint]")).not.toHaveClass(/is-new/);
  });
});

test.describe("the adopt page", () => {
  test("one last look before paying: taken meanwhile, no payment (fb0db2f67)", async ({ page }) => {
    let asked = 0;
    await page.route(/adoptions-test/, (r) => {
      asked++;
      r.fulfill({
        json: asked > 1 ? { "24-carrot": { amount: 50, by: "someone", on: "name", at: "2026-01-01" } } : {},
      });
    });
    await page.goto("/adopt/#e56e24");
    await page.locator("[data-by]").fill("David");
    const cta = page.locator("[data-cta]");
    await expect(cta).toHaveAttribute("aria-disabled", "false");
    await cta.click();
    await expect(page.locator("[data-lead]")).toContainText("Someone adopted 24 Carrot just now");
    expect(new URL(page.url()).hostname).toBe("localhost");
  });

  test("a payment that missed picks another, asking once at a time (fb0db2f67, 4848ecbf0)", async ({ page }) => {
    await page.route(/\/adopted\?session=/, (r) => r.fulfill({ json: { clash: true, wanted: "24-carrot" } }));
    await page.route(/adoptions-test/, (r) => r.fulfill({ json: {} }));
    let posts = 0;
    await page.route(/\/reassign/, async (r) => {
      posts++;
      await new Promise((done) => setTimeout(done, 800));
      r.fulfill({ json: { error: "taken" } });
    });
    await page.goto("/adopt/?session=x");
    await expect(page.locator("[data-name]")).toHaveText("So close.");
    const cta = page.locator("[data-cta]");
    await cta.click();
    await cta.click({ force: true });
    await expect(page.locator("[data-note]")).toContainText("was just taken too");
    expect(posts).toBe(1);
  });

  test("an account that isn't there can't be paid for; a bare Bluesky handle is on bsky.social (2f469d705)", async ({
    page,
  }) => {
    await page.route(/public\.api\.bsky\.app/, (r) => r.fulfill({ status: 400, json: { error: "InvalidRequest" } }));
    await page.goto("/adopt/#e56e24");
    await page.locator("[data-on]").selectOption("bluesky");
    await page.locator("[data-by]").fill("nobody");
    await expect(page.locator("[data-who-note]")).toContainText("@nobody.bsky.social");
    await expect(page.locator("[data-cta]")).toHaveAttribute("aria-disabled", "true");
    await page.locator("[data-on]").selectOption("anonymous");
    await expect(page.locator("[data-by]")).toBeHidden();
    await expect(page.locator("[data-cta]")).toHaveAttribute("aria-disabled", "false");
  });

  test("a hex adopts its closest name; ?name= one by name; none asked shows the wheel (ff9f28172)", async ({
    page,
  }) => {
    await page.goto("/adopt/#123457");
    await expect(page.locator("[data-cta]")).toContainText(/^Adopt \S/);
    await page.goto("/adopt/?name=24%20Carrot");
    await expect(page.locator("[data-cta]")).toContainText("Adopt 24 Carrot");
    await page.goto("/adopt/");
    await expect(page.locator("[data-pick]")).toBeVisible();
  });
});

test.describe("the supporters page", () => {
  test("all founding spots gone isn't said, the badge tells it, on one line", async ({ page }) => {
    const adopted = {};
    for (let k = 0; k < 50; k++)
      adopted[`color-${k}`] = { amount: 5, by: `patron${k}`, on: "name", at: "2026-01-01", founding: true };
    await page.route(/adoptions-test/, (r) => r.fulfill({ json: adopted }));
    await page.goto("/supporters/");
    await expect(page.locator("[data-counts]")).toBeVisible();
    await expect(page.locator("[data-counts]")).not.toContainText("founding spots");
    const badge = page.locator(".supporter__founding").first();
    await expect(badge).toHaveAttribute("title", "One of the first 50 patrons");
    expect(await badge.evaluate((b) => getComputedStyle(b).whiteSpace)).toBe("nowrap");
  });

  test("on a phone a long name sends the badge to the next line, whole", async ({ page }) => {
    await page.route(/adoptions-test/, (r) =>
      r.fulfill({
        json: {
          "color-0": { amount: 5, by: "averyverylongpatronname", on: "name", at: "2026-01-01", founding: true },
        },
      }),
    );
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/supporters/");
    const badge = page.locator(".supporter__founding").first();
    await expect(badge).toBeVisible();
    const name = await page.locator(".supporter__name").first().boundingBox();
    const b = await badge.boundingBox();
    // below the name, and one line high
    expect(b.y).toBeGreaterThan(name.y + name.height / 2);
    const line = await badge.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * 2);
    expect(b.height).toBeLessThan(line);
  });
});

test.describe("patrons, from a color to the supporters", () => {
  test("a color's adoption line names the patron, not in capitals, and links their place", async ({ page }) => {
    await page.goto("/color/#e56e24");
    const line = await page.evaluate(async () => {
      const { adoptedHTML } = await import("/src/adopter.js");
      const el = document.createElement("span");
      el.className = "hero__adopted";
      document.querySelector("[data-stats]").append(el);
      const out = [];
      for (const founding of [true, false]) {
        el.replaceChildren(
          ...adoptedHTML({ by: "vale.rocks", on: "website", at: "2026-10-20", amount: 5, founding }, "liberty"),
        );
        const a = el.querySelector(".hero__patron");
        out.push({
          text: el.textContent,
          link: a.textContent,
          href: a.getAttribute("href"),
          caps: getComputedStyle(a).textTransform,
        });
      }
      return out;
    });
    expect(line[0].text).toBe("Adopted October 20, 2026 by vale.rocks, founding patron");
    expect(line[1].link).toBe("patron");
    for (const l of line) {
      expect(l.href).toMatch(/supporters\/#color-liberty$/);
      expect(l.caps).toBe("none");
    }
  });

  test("the supporters page goes to the patron asked for, and lights their row", async ({ page }) => {
    const adopted = {};
    for (let k = 0; k < 40; k++)
      adopted[`color-${k}`] = { amount: 5 + (40 - k), by: `patron${k}`, on: "name", at: "2026-01-01" };
    adopted.liberty = { amount: 5, by: "vale.rocks", on: "website", at: "2026-10-20", founding: true };
    await page.route(/adoptions-test/, (r) => r.fulfill({ json: adopted }));
    await page.goto("/supporters/#color-liberty");
    const row = page.locator(".supporter.is-asked");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("vale.rocks");
    await expect(row).toBeInViewport();
  });
});

test.describe("on a phone", () => {
  for (const path of ["/supporters/", "/adopt/#e56e24", "/legal/"])
    test(`${path} fits the screen, no sideways scroll (4848ecbf0)`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(path);
      await page.waitForTimeout(2500);
      const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      expect(scroll).toBeLessThanOrEqual(width);
    });
});

test.describe("the page that isn't there", () => {
  test("shows its spiral of names, no sentence when no name was asked for (7a3dee36b)", async ({ page }) => {
    await page.goto("/not-found/");
    await expect(page.locator('[data-wheel-names] a, [data-wheel] a[href*="color/"]').first()).toBeAttached({
      timeout: 30_000,
    });
  });
});
