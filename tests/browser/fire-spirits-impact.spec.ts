import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("three Fire Spirits splash ground and air with native projectiles and particles", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await page.locator("#attack-card").selectOption("fire-spirits");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const spirits = async () => JSON.parse((await diagnostic.getAttribute("data-fire-spirits"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await spirits()).alive).toBe(3);
  for (let i = 0; i < 40 && !(await spirits()).shots.length; i++) await step();
  const flight = await spirits();
  expect(flight.shots.length).toBeGreaterThan(0);
  expect(flight.visuals.length).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("fire-spirits-projectile.png"), fullPage: true });
  for (let i = 0; i < 40 && (await spirits()).hits < 3; i++) await step();
  const impact = await spirits();
  expect(impact.hits).toBe(3);
  expect(impact.alive).toBe(0);
  expect(impact.targets.find((target: any) => !target.air)?.hp).toBeLessThan(10000);
  expect(impact.targets.some((target: any) => target.air && target.hp < 10000))
    .toBe(true);
  expect(impact.particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("fire-spirits-splash.png"), fullPage: true });
  expect(errors).toEqual([]);
});
