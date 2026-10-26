import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { expectedAnimations } from "./native-assets";

test("scene replacement trims cold sprite frames and regenerates the same rendered pixels", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=sprite-cache");
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-sprite-cache"))!,
    ) as {
      frames: number;
      bytes: number;
      sceneBytes: number;
      loaded: number;
    ready: boolean;
      tick: number;
      actions: number;
      bodies: { id: number; card: string; x: number; y: number; hp: number }[];
    };
  await expect
    .poll(async () => (await state()).loaded, { timeout: 60000 })
    .toBe(expectedAnimations);
  await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
  for (let i = 0; i < 2; i++) await page.locator("#second").click();
  await expect.poll(async () => (await state()).tick).toBe(60);
  // Begin from a fresh, paused pose so earlier movement damping is settled.
  await page.locator("#rebuild").click();
  await page.locator("#warm-sprite-cache").click();
  await expect
    .poll(async () => (await state()).bytes)
    .toBeGreaterThan(16 * 1048576);
  const before = await state();
  const canvas = page.locator("canvas");
  const pixels = async () =>
    sharp(await canvas.screenshot())
      .raw()
      .toBuffer();
  const original = await pixels();
  await page.locator("#rebuild").click();
  await expect
    .poll(async () => (await state()).bytes)
    .toBeLessThan(before.bytes);
  const after = await state();
  expect(after.bytes).toBeLessThanOrEqual(8 * 1048576 + after.sceneBytes);
  expect(after.frames).toBeLessThan(before.frames);
  expect(after.loaded).toBe(expectedAnimations);
  expect(after.tick).toBe(before.tick);
  expect(after.actions).toBe(before.actions);
  expect(after.bodies).toEqual(before.bodies);
  expect((await pixels()).equals(original)).toBe(true);
  await page.screenshot({
    path: info.outputPath("sprite-cache-rebuilt.png"),
    fullPage: true,
  });
  const settled = await state();
  await page.locator("#rebuild").click();
  await expect
    .poll(async () => (await state()).bytes)
    .toBeLessThanOrEqual(8 * 1048576 + after.sceneBytes);
  expect((await state()).bodies).toEqual(settled.bodies);
  expect((await pixels()).equals(original)).toBe(true);
  expect(errors).toEqual([]);
});
