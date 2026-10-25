import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Dark Prince charges with shielded art then loses his shield on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("dark-prince");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-dark-prince"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async () => {
    const before = await time();
    await page.locator("#step").click();
    await expect.poll(time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await data()).units[0]?.art).toBe("shielded");
  expect((await data()).units[0].shield).toBe(322);
  for (let i = 0; i < 20 && (await data()).hits < 2; i++) await advance();
  expect((await data()).hits).toBeGreaterThanOrEqual(2);
  expect((await data()).enemyHealth.filter((enemy: any) => enemy.card === "knight")
    .every((enemy: any) => enemy.hp < 10000)).toBe(true);
  expect((await data()).enemyHealth.filter((enemy: any) => enemy.card === "minions")
    .every((enemy: any) => enemy.hp === 10000)).toBe(true);
  await page.screenshot({ path: info.outputPath("dark-prince-shield-charge.png"), fullPage: true });
  await page.locator("#break-shield").click();
  for (let i = 0; i < 40 && (await data()).shieldBreaks === 0; i++) await advance();
  await expect.poll(async () => (await data()).units[0]?.art).toBe("unshielded");
  expect((await data()).units[0]).toMatchObject({ hp: 1184, shield: 0 });
  expect((await data()).shieldBreaks).toBe(1);
  for (let i = 0; i < 5; i++) await advance();
  await page.screenshot({ path: info.outputPath("dark-prince-unshielded.png"), fullPage: true });
  expect(errors).toEqual([]);
});
