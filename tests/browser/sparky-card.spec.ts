import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Sparky charges and splashes ground defenders with its native cannon", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("sparky");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-sparky"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async (seconds = false) => {
    const before = await time();
    await page.locator(seconds ? "#second" : "#step").click();
    await expect.poll(time, { timeout: 15000 })
      .toBeGreaterThan(before + (seconds ? 0.99 : 0.099));
  };
  for (let i = 0; i < 4; i++) await advance(true);
  expect((await data()).charge).toBeGreaterThan(3.9);
  expect((await data()).loadCues).toEqual(["load-1", "load-2", "load-3"]);
  await page.screenshot({ path: info.outputPath("sparky-charged.png"), fullPage: true });
  for (let i = 0; i < 15 && !(await data()).shots.length; i++) await advance();
  expect((await data()).shots).toHaveLength(1);
  expect((await data()).visuals[0].sprites.some((sprite: any) => sprite.name === "zapMachine_projectile")).toBe(true);
  await page.screenshot({ path: info.outputPath("sparky-shot.png"), fullPage: true });
  for (let i = 0; i < 12 && (await data()).shots.length; i++) await advance();
  expect((await data()).shots).toHaveLength(0);
  expect((await data()).hits).toBe(1);
  expect((await data()).enemies.filter((enemy: any) => enemy.card === "knight").map((enemy: any) => enemy.hp)).toEqual([8427, 8427]);
  expect((await data()).enemies.filter((enemy: any) => enemy.card === "minions").every((enemy: any) => enemy.hp === 10000)).toBe(true);
  await page.screenshot({ path: info.outputPath("sparky-hit.png"), fullPage: true });
  expect(errors).toEqual([]);
});
