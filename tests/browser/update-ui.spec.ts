import { expectedBuildings } from "./native-assets";
import { expect, test } from "@playwright/test";

test.skip(
  !process.env.ARENA_PRODUCTION,
  "Update registration is production-only",
);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({ version: 1, seenTutorial: true, sound: false }),
    );
    // The real lifecycle is covered by offline-updates.spec.ts. This controlled
    // waiting worker exposes the production game's actual lobby presentation.
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        controller: {},
        addEventListener() {},
        async register() {
          return {
            waiting: {
              postMessage() {
                (window as any).__updateRequested = true;
              },
            },
            installing: null,
            addEventListener() {},
          };
        },
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  await page.waitForFunction(
    (count) =>
      (window as any).__arena.state.loadedBuildings === count &&
      (window as any).__arena.state.nativePrincessTowers === 4 &&
      (window as any).__arena.state.nativeTowerPrincesses === 4,
    expectedBuildings,
  );
  await expect(
    page.getByRole("button", { name: "Update game", exact: true }),
  ).toBeVisible();
});

test("lobby update prompt fits phones and hides in settings and battles", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop") {
    for (const size of [
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      const box = (await page
        .getByRole("button", { name: "Update game", exact: true })
        .boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      if (size.width <= 720) {
        const banner = (await page
          .getByRole("status", { name: "Game update", exact: true })
          .boundingBox())!;
        const navigation = (await page.locator(".primary-nav").boundingBox())!;
        expect(banner.y + banner.height).toBeLessThanOrEqual(navigation.y - 4);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: info.outputPath("lobby-update.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Game update", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Update game", exact: true }),
  ).toBeVisible();
  await page.locator("#battle-button").click();
  await expect(page.locator("#hand .game-card")).toHaveCount(4);
  await expect(
    page.getByRole("status", { name: "Game update", exact: true }),
  ).toBeHidden();
});

test("dismissing an update keeps lobby navigation usable without showing it again", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Dismiss update", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Game update", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Game update", exact: true }),
  ).toBeHidden();
});

test("an accepted lobby update blocks game input while the worker activates", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "Update game", exact: true }).click();
  await expect(page.locator("#app")).toHaveJSProperty("inert", true);
  await expect(
    page.getByRole("status", { name: "Game update", exact: true }),
  ).toHaveClass(/applying/);
  expect(await page.evaluate(() => (window as any).__updateRequested)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath("applying-update.png"),
    animations: "disabled",
  });
});
