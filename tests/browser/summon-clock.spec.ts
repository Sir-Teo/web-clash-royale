import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Witch summons native Skeletons serially and keeps the wave fixed while paused", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=summon-witch");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-witch-wave"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.099);
  };
  expect((await state()).children).toEqual([]);
  await step();
  expect((await state()).children).toHaveLength(1);
  expect((await state()).index).toBe(1);
  await step();
  await step();
  expect((await state()).children).toHaveLength(2);
  expect((await state()).index).toBe(2);
  await step();
  await step();
  await step();
  await expect
    .poll(async () => (await state()).children.every((c: any) => c.native))
    .toBe(true);
  const wave = await state();
  expect(wave.children).toHaveLength(3);
  expect(wave.index).toBe(0);
  expect(wave.timer).toBeCloseTo(6.9, 8);
  expect(wave.cues).toBe(1);
  expect(wave.births).toEqual([1 / 30, 0.3, 0.6]);
  await page.screenshot({
    path: info.outputPath("witch-serial-skeleton-wave.png"),
    fullPage: true,
  });
  await page.waitForTimeout(160);
  expect(await state()).toEqual(wave);
  expect(errors).toEqual([]);
});
