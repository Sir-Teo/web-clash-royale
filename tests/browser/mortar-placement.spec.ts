import { test, expect } from "@playwright/test";
import { expectedBuildings } from "./native-assets";

test("Mortar placement marks its blind spot and clears it when hidden or switching cards", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedBuildings} buildings loaded`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page
        .locator("#destruction")
        .getAttribute("data-placement-range"))!,
    ) as {
      placement: null | {
        card: string;
        minimumRange: number;
        valid: boolean;
        count: number;
      };
      cursorVisible: boolean;
      visible: boolean;
      inner: number;
      outer: number;
      color: number;
    };
  await page.locator("#death-card").selectOption("mortar");
  await page.locator("#preview-formation").click();
  await expect.poll(async () => (await state()).visible).toBe(true);
  const initial = await state();
  expect(initial.placement).toMatchObject({
    card: "mortar",
    minimumRange: 4.5,
    valid: true,
    count: 1,
  });
  expect(initial.inner).toBeLessThan(4.5);
  expect(initial.outer).toBeGreaterThan(4.5);
  expect(initial.color).toBe(0xffcf78);
  await expect(page.locator(".placement-feedback")).toContainText(
    "Blind spot: 4.5 tiles",
  );
  const label = await page.locator(".placement-feedback").boundingBox();
  expect(label!.x).toBeGreaterThanOrEqual(0);
  expect(label!.x + label!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: info.outputPath("mortar-blind-spot-preview.png"),
    fullPage: true,
  });
  await page.locator("#preview-invalid").click();
  await expect.poll(async () => (await state()).color).toBe(0xff536a);
  expect((await state()).placement).toMatchObject({
    minimumRange: 4.5,
    valid: false,
  });
  await expect(page.locator(".placement-feedback")).toHaveText(
    "Not enough elixir",
  );
  await page.locator("#preview-hide").click();
  await expect.poll(async () => (await state()).placement).toBeNull();
  expect(await state()).toMatchObject({ cursorVisible: false, visible: false });
  for (const card of ["cannon", "knight"] as const) {
    await page.locator("#death-card").selectOption(card);
    await page.locator("#preview-formation").click();
    await expect.poll(async () => (await state()).placement?.card).toBe(card);
    expect((await state()).placement?.minimumRange).toBe(0);
    expect((await state()).visible).toBe(false);
    await expect(page.locator(".placement-feedback")).not.toContainText(
      "Blind spot",
    );
  }
  await page.locator("#death-card").selectOption("mortar");
  await page.locator("#preview-formation").click();
  await expect.poll(async () => (await state()).visible).toBe(true);
  expect((await state()).placement?.minimumRange).toBe(4.5);
  if (info.project.name !== "desktop") {
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => (await state()).visible).toBe(true);
    await page.screenshot({
      path: info.outputPath("mortar-blind-spot-landscape.png"),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
