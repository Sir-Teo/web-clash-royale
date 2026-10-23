import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Knight and Prince leave native ground dust while moving on desktop and phone", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("footsteps");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-state"))!,
    );
  const dust = (clips: Record<string, number>) =>
    (clips.d2 ?? 0) + (clips.d3 ?? 0) + (clips.d4 ?? 0);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 40 && !(dust((await state()).clips) > 0); i++) {
    await step();
  }
  const held = await state();
  expect(dust(held.clips)).toBeGreaterThan(0);
  expect(held.ground).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-footsteps.png"),
    fullPage: true,
  });
  await page.waitForTimeout(180);
  expect(await state()).toEqual(held);
  for (let i = 0; i < 40 && !((await state()).clips.d1 > 0); i++) await step();
  const charge = await state();
  expect(charge.clips.d1).toBeGreaterThan(0);
  expect(charge.particles).toBeGreaterThanOrEqual(12);
  expect(
    await page.locator("#destruction").getAttribute("data-charge-cues"),
  ).toBe("1");
  await page.screenshot({
    path: info.outputPath("native-prince-charge.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
