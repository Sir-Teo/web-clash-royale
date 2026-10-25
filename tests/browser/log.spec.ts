import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("The Log rolls with native artwork, source trail and wooden breakup on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("log");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const diagnostic = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const shots = async () =>
    JSON.parse((await diagnostic.getAttribute("data-projectiles"))!);
  const advance = async (selector = "#step", amount = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + amount - 0.001);
  };
  await advance();
  expect((await shots())[0].sprites.map((sprite: any) => sprite.name)).toEqual([
    "log_projectile",
    "log_projectile_shadow",
  ]);
  for (let i = 0; i < 5; i++) await advance();
  expect((await shots())[0].sprites.map((sprite: any) => sprite.name)).toEqual([
    "log_roll_projectile",
  ]);
  const mid = await state();
  expect(mid.particles).toBeGreaterThan(0);
  expect(mid.draws).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-log-roll.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(mid);
  for (let i = 0; i < 4; i++) await advance("#second", 1);
  expect(await shots()).toHaveLength(0);
  expect((await state()).particles).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
