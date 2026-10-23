import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Lumberjack drops the native bottle and leaves a friendly Rage area", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("lumberjack");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-lumberjack"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time, { timeout: 15000 }).toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 40 && !(await data()).bottles.length; i++) await advance();
  expect((await data()).alive).toBe(false);
  expect((await data()).bottles).toHaveLength(1);
  expect((await data()).visuals[0].sprites.some((sprite: any) => sprite.name === "rage_bottle_fall")).toBe(true);
  await page.screenshot({ path: info.outputPath("lumberjack-bottle.png"), fullPage: true });
  for (let i = 0; i < 10 && !(await data()).areas.length; i++) await advance();
  expect((await data()).bottles).toHaveLength(0);
  expect((await data()).impacts, JSON.stringify(await data())).toBe(1);
  expect((await data()).areas).toHaveLength(1);
  expect((await data()).friends).toEqual([
    { card: "knight", raged: true }, { card: "minions", raged: true },
    { card: "minions", raged: true }, { card: "minions", raged: true },
  ]);
  expect((await data()).enemies).toEqual([{ card: "knight", raged: false }]);
  await page.screenshot({ path: info.outputPath("lumberjack-rage.png"), fullPage: true });
  for (let i = 0; i < 8; i++) await page.locator("#second").click();
  await expect.poll(async () => (await data()).areas.length).toBe(0);
  expect(errors).toEqual([]);
});
