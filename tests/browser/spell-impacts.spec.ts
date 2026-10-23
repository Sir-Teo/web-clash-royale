import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native Zap and 15-arrow volley render, pause, and clear on phone and desktop", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("spell-impacts");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const status = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await status.getAttribute("data-state"))!);
  const impacts = async () =>
    JSON.parse((await status.getAttribute("data-spell-impacts"))!);
  const advance = async (selector = "#step", seconds = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + seconds - 0.001);
  };
  expect((await impacts()).arrowSprites).toEqual([5, 5, 5]);
  await advance();
  await advance();
  expect((await impacts()).zap).toBe(1);
  expect((await state()).particles).toBe(34);
  expect((await state()).clips.electricity).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-zap.png"),
    fullPage: true,
  });
  for (let i = 0; i < 25 && (await impacts()).arrows < 3; i++) await advance();
  expect((await impacts()).arrows).toBe(3);
  const volley = await state();
  const marks = Object.entries(volley.clips)
    .filter(([name]) => name.startsWith("Arrow_enemy_ground_anim_"))
    .reduce((sum, [, count]) => sum + Number(count), 0);
  expect(marks).toBe(15);
  expect(volley.draws).toBeLessThan(80);
  await page.screenshot({
    path: info.outputPath("native-arrow-volley.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(volley);
  for (let i = 0; i < 4; i++) await advance("#second", 1);
  expect((await state()).particles).toBe(0);
  expect((await state()).draws).toBe(0);
  expect(errors).toEqual([]);
});
