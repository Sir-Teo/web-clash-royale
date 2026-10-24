import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

test("Bomb Tower's native shell, attached Bomber and hit particles render on desktop and phone", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("attack-impacts");
  await page.locator("#attack-card").selectOption("bomb-tower");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`);
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const impacts = async () => JSON.parse((await diagnostic.getAttribute("data-attack-impacts"))!);
  const projectile = async () => JSON.parse((await diagnostic.getAttribute("data-projectiles"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  let nativeShell = false;
  for (let i = 0; i < 50 && !((await impacts())["bomb-tower"] > 0); i++) {
    await step();
    nativeShell ||= (await projectile()).some((p: any) =>
      p.sprites.some((sprite: any) => sprite.name === "projectile_bomb"));
  }
  expect(nativeShell).toBe(true);
  expect((await impacts())["bomb-tower"]).toBeGreaterThan(0);
  await expect.poll(async () => (await state()).clips.SparkleBlue ?? 0).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("bomb-tower-impact.png"), fullPage: true });
  expect(errors).toEqual([]);
});
