import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native deployment dust follows per-unit source counts, timing, pause and cleanup", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-state"))!,
    );
  const step = async (selector = "#step", amount = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + amount - 0.001);
  };
  for (const [card, count] of [
    ["knight", 166],
    ["archers", 332],
    ["giant", 266],
    ["pekka", 133],
    ["goblins", 0],
  ] as const) {
    await page.locator("#death-card").selectOption(card);
    await page.locator("#spawn").click();
    await expect.poll(async () => (await state()).particles).toBe(count);
    expect((await state()).draws).toBe(0);
    await step();
    await step();
    expect((await state()).draws).toBe(0);
    await step();
    await step();
    if (count) {
      const held = await state();
      expect(held.draws).toBeGreaterThan(0);
      expect(held.draws).toBeLessThan(45);
      expect(held.clips.d3_green_dark).toBeGreaterThan(0);
      await page.waitForTimeout(200);
      expect(await state()).toEqual(held);
      if (card === "knight" || card === "giant")
        await page.screenshot({
          path: info.outputPath(`${card}-native-deployment.png`),
          fullPage: true,
        });
    }
    await step("#second", 1);
    await step("#second", 1);
    await step("#second", 1);
    expect((await state()).particles).toBe(0);
    expect((await state()).draws).toBe(0);
  }
  expect(errors).toEqual([]);
});
