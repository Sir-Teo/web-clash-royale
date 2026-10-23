import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("seven attackers render their archived hit particles on desktop and phone", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const status = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await status.getAttribute("data-state"))!);
  const impacts = async () =>
    JSON.parse((await status.getAttribute("data-attack-impacts"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.099);
  };
  for (const [card, clip] of [
    ["musketeer", "SteamSmall"],
    ["bomber", "Sparkle"],
    ["baby-dragon", "fireball_trail2"],
    ["wizard", "explosion_cloud_1"],
    ["cannon", "SteamSmall"],
    ["balloon", "Rock2Particle"],
    ["tesla", "Death_blue_sparkle2"],
  ] as const) {
    await page.locator("#attack-card").selectOption(card);
    await expect.poll(async () => (await state()).particles).toBe(0);
    for (let i = 0; i < 50 && !((await impacts())[card] > 0); i++) await step();
    expect((await impacts())[card]).toBeGreaterThan(0);
    await expect
      .poll(async () => (await state()).clips[clip] ?? 0)
      .toBeGreaterThan(0);
    if (card === "cannon")
      expect((await state()).clips.fireplace_particle).toBeGreaterThan(0);
    const held = await state();
    expect(held.draws).toBeGreaterThan(0);
    expect(held.draws).toBeLessThan(80);
    await page.waitForTimeout(180);
    expect(await state()).toEqual(held);
    if (["bomber", "wizard", "cannon", "balloon", "tesla"].includes(card)) {
      await step();
      await page.screenshot({
        path: info.outputPath(`${card}-native-hit.png`),
        fullPage: true,
      });
    }
  }
  await page.locator("#scenario").selectOption("deployment");
  await expect.poll(async () => (await state()).particles).toBe(0);
  expect((await state()).draws).toBe(0);
  expect(errors).toEqual([]);
});
