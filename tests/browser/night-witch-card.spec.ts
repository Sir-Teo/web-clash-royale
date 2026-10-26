import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Night Witch summons native Bats and releases four after defeat", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("night-witch");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-night-witch"))!);
  const time = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-state"))!).time;
  const advance = async (seconds = false) => {
    const before = await time();
    await page.locator(seconds ? "#second" : "#step").click();
    await expect.poll(time, { timeout: 15000 }).toBeGreaterThan(before + (seconds ? 0.99 : 0.099));
  };
  await expect.poll(async () => (await data()).alive).toBe(true);
  expect((await data()).bats).toHaveLength(0);
  await advance();
  expect((await data()).bats).toHaveLength(2);
  expect((await data()).summons).toBe(1);
  expect((await data()).summonCues).toBe(1);
  for (let i = 0; i < 7 && (await data()).particles === 0; i++) await advance();
  expect((await data()).particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("night-witch-summon.png"), fullPage: true });
  const prior = new Set((await data()).bats.map((bat: any) => bat.id));
  await page.locator("#kill-night-witch").click();
  for (let i = 0; i < 30 && (await data()).alive; i++) await advance();
  const after = await data();
  expect(after.alive).toBe(false);
  expect(after.bats.filter((bat: any) => !prior.has(bat.id))).toHaveLength(4);
  expect(after.deathCues).toBe(1);
  await page.screenshot({ path: info.outputPath("night-witch-death-bats.png"), fullPage: true });
  expect(errors).toEqual([]);
});
