import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Giant Skeleton's native three-second bomb hits and pushes ground and air", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("giant-skeleton");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const diagnostic = page.locator("#destruction");
  const state = async () => JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const skeleton = async () => JSON.parse((await diagnostic.getAttribute("data-giant-skeleton"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  await expect.poll(async () => (await skeleton()).alive).toBe(true);
  await page.locator("#kill-giant-skeleton").click();
  await step();
  const armed = await skeleton();
  expect(armed.alive).toBe(false);
  expect(armed.bombs).toHaveLength(1);
  expect(armed.bombs[0].remaining).toBeGreaterThan(2.8);
  expect(armed.visuals.length).toBeGreaterThan(0);
  expect(armed.targets.every((target: any) => target.hp === 10000)).toBe(true);
  for (let i = 0; i < 8; i++) await step();
  await page.screenshot({ path: info.outputPath("giant-skeleton-bomb-fuse.png"), fullPage: true });
  for (let i = 0; i < 25 && !(await skeleton()).hits; i++) await step();
  const blast = await skeleton();
  expect(blast.hits).toBe(1);
  expect(blast.bombs).toHaveLength(0);
  expect(blast.targets.find((target: any) => !target.air)?.hp).toBeLessThan(10000);
  expect(blast.targets.some((target: any) => target.air && target.hp < 10000))
    .toBe(true);
  expect(blast.impactAudio).toBe(1);
  expect(blast.particles).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("giant-skeleton-bomb-blast.png"), fullPage: true });
  expect(errors).toEqual([]);
});
