import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Hog Rider clears the river and lands with native dust on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("hog-jump");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-state"))!,
    );
  const hogs = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-hog-jump"))!,
    );
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 80 && !(await hogs()).some((h: any) => h.height > 1); i++)
    await step();
  const airborne = await hogs();
  expect(
    airborne.some((h: any) => h.height > 1 && h.y > 14.8 && h.y < 17.2),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("hog-river-jump.png"),
    fullPage: true,
  });
  for (let i = 0; i < 40 && !((await state()).particles >= 50); i++)
    await step();
  const landing = await state();
  expect(landing.particles).toBeGreaterThanOrEqual(50);
  expect(landing.ground).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("hog-native-landing.png"),
    fullPage: true,
  });
  await page.waitForTimeout(180);
  expect(await state()).toEqual(landing);
  expect(errors).toEqual([]);
});
