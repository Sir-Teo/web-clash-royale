import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Lightning shows three highest-health strikes with native bolt and debris on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("lightning");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const diagnostic = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await diagnostic.getAttribute("data-state"))!);
  const impacts = async () =>
    JSON.parse((await diagnostic.getAttribute("data-attack-impacts"))!);
  const advance = async (selector = "#step", seconds = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + seconds - 0.001);
  };
  for (let i = 0; i < 8 && !(await impacts()).lightning; i++) await advance();
  expect((await impacts()).lightning).toBe(1);
  await advance();
  const first = await state();
  expect(
    first.clips.lightning_bolt || first.clips.lightning_bolt2,
  ).toBeGreaterThan(0);
  expect(first.clips.Sparkle).toBeGreaterThan(0);
  expect(first.particles).toBeGreaterThan(30);
  expect(first.draws).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-lightning-strike.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(first);
  await advance("#second", 1);
  expect((await impacts()).lightning).toBe(3);
  for (let i = 0; i < 6; i++) await advance("#second", 1);
  expect((await state()).particles).toBe(0);
  expect(errors).toEqual([]);
});
