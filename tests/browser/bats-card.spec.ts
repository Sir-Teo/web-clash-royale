import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("five native Bats loop their wiggle filter and strike an airborne defender", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("bats");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const data = async () => JSON.parse((await page.locator("#destruction").getAttribute("data-bats"))!);
  await expect.poll(async () => (await data()).wiggle.length).toBe(5);
  expect((await data()).units).toHaveLength(5);
  expect((await data()).units.every((e: any) => e.air)).toBe(true);
  expect((await data()).wiggle.every((e: any) => e.applied)).toBe(true);
  await page.screenshot({ path: info.outputPath("bats-swarm.png"), fullPage: true });
  for (let i = 0; i < 30 && (await data()).airTargets[0].hp === 10000; i++)
    await page.locator("#step").click();
  expect((await data()).airTargets[0].hp).toBeLessThan(10000);
  expect((await data()).airTargets[1].hp).toBe(10000);
  expect((await data()).hits).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("bats-attack.png"), fullPage: true });
  expect(errors).toEqual([]);
});
