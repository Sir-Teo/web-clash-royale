import { test, expect } from "@playwright/test";

test("byte-identical troop atlases load as one texture", async ({ page }) => {
  const errors: string[] = [];
  const atlasRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/assets/animations/") && request.url().endsWith(".webp"))
      atlasRequests.push(request.url());
  });
  await page.goto("/tests/fixtures/animations.html");
  await expect(page.locator("#status")).toHaveText("49 families loaded", { timeout: 120000 });
  expect(await page.evaluate(() => (window as any).__animationTextures)).toEqual({
    references: 49,
    unique: 44,
    shared: true,
  });
  expect(atlasRequests).toHaveLength(44);
  expect(errors).toEqual([]);
});
