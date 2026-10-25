import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Ice Spirit projectile splashes and freezes ground and air with native effects", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await page.locator("#attack-card").selectOption("ice-spirit");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const spirit = async () => JSON.parse((await diagnostic.getAttribute("data-ice-spirit"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 30 && !(await spirit()).shots.length; i++) await step();
  const shot = await spirit();
  expect(shot.alive).toBe(false);
  expect(shot.shots).toHaveLength(1);
  expect(shot.visuals).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("ice-spirit-projectile.png"), fullPage: true });
  for (let i = 0; i < 30 && !(await spirit()).hits; i++) await step();
  const impact = await spirit();
  expect(impact.hits).toBe(1);
  const ground = impact.targets.find((target: any) => !target.air);
  const air = impact.targets.filter((target: any) => target.air);
  expect(ground).toMatchObject({ card: "giant", air: false });
  expect(ground.hp).toBeLessThan(10000);
  expect(ground.stun).toBeGreaterThan(0);
  expect(air.some((target: any) => target.hp < 10000 && target.stun > 0))
    .toBe(true);
  expect(impact.cold.length).toBeGreaterThanOrEqual(2);
  expect(impact.particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("ice-spirit-freeze.png"), fullPage: true });
  expect(errors).toEqual([]);
});
