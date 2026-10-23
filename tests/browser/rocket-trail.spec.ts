import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Rocket carries native smoke, sparks and glow into its explosion on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("rocket");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const diagnostic = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const shots = async () =>
    JSON.parse((await diagnostic.getAttribute("data-projectiles"))!);
  const advance = async (selector = "#second", amount = 1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + amount - 0.001);
  };
  await advance();
  expect((await shots())[0].sprites.map((sprite: any) => sprite.name)).toEqual([
    "projectile_rocket",
    "projectile_shadow_rocket",
  ]);
  const midflight = await state();
  expect(midflight.clips.fireball_trail1).toBeGreaterThan(0);
  expect(midflight.clips.fireball_trail3).toBeGreaterThan(0);
  expect(midflight.clips.Sparkle).toBeGreaterThan(0);
  expect(midflight.draws).toBeGreaterThan(0);
  expect(midflight.particles).toBeLessThan(1280);
  await page.screenshot({
    path: info.outputPath("native-rocket-trail.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(midflight);
  for (let i = 0; i < 4; i++) await advance();
  expect(await shots()).toHaveLength(0);
  expect((await state()).particles).toBeGreaterThan(0);
  for (let i = 0; i < 5; i++) await advance();
  expect((await state()).particles).toBe(0);
  expect(errors).toEqual([]);
});
