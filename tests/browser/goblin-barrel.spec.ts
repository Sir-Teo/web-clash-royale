import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Goblin Barrel flies with original art and bursts into three Goblins on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("goblin-barrel");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const node = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await node.getAttribute("data-state"))!);
  const shots = async () =>
    JSON.parse((await node.getAttribute("data-projectiles"))!);
  const goblins = async () =>
    JSON.parse((await node.getAttribute("data-barrel-goblins"))!);
  const advance = async (selector = "#second", amount = 1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + amount - 0.001);
  };
  await advance();
  expect((await shots())[0].sprites.map((sprite: any) => sprite.name)).toEqual([
    "spell_goblin_barrel_projectile",
    "Barrel_shadow",
  ]);
  expect((await shots())[0].sprites[0].frame).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-goblin-barrel-flight.png"),
    fullPage: true,
  });
  await page.waitForTimeout(200);
  const held = await state();
  expect(await state()).toEqual(held);
  await advance();
  await advance();
  for (let i = 0; i < 4 && (await goblins()).length < 3; i++)
    await advance("#step", 0.1);
  expect(await shots()).toHaveLength(0);
  expect(await goblins()).toHaveLength(3);
  expect((await goblins()).every((goblin: any) => goblin.deploy > 0)).toBe(
    true,
  );
  const impact = await state();
  expect(
    impact.clips.crate_particle_1 || impact.clips.crate_particle_2,
  ).toBeGreaterThan(0);
  expect(impact.particles).toBeGreaterThan(40);
  await page.screenshot({
    path: info.outputPath("native-goblin-barrel-landing.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
