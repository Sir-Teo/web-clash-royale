import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Bowler rolls a native boulder through ground targets on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("bowler");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-bowler"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 25 && (await data()).shots === 0; i++) await advance();
  await expect.poll(async () => (await data()).visuals.length).toBe(1);
  expect((await data()).visuals[0].sprites.map((sprite: any) => sprite.name)).toEqual([
    "bowler_projectile", "bowler_projectile_shadow",
  ]);
  for (let i = 0; i < 7; i++) await advance();
  expect((await data()).visuals).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("bowler-rolling-boulder.png"), fullPage: true });
  for (let i = 0; i < 25 && (await data()).shots > 0; i++) await advance();
  const result = await data();
  expect(result.hits).toBeGreaterThanOrEqual(2);
  expect(result.enemies.filter((enemy: any) => enemy.card === "knight").every((enemy: any) => enemy.hp < 10000)).toBe(true);
  expect(result.enemies.filter((enemy: any) => enemy.card === "minions").every((enemy: any) => enemy.hp === 10000)).toBe(true);
  expect(errors).toEqual([]);
});
