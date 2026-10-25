import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import chargeFilter from "../../src/render/charge-filter-data.json" with { type: "json" };

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
  const filter = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-charge-filter"))!,
    );
  expect(await filter()).toEqual([
    expect.objectContaining({ applied: true, frame: expect.any(Number) }),
  ]);
  const marker = page.locator('.charge-marker[data-source="effect_charge"]');
  await expect(marker).toHaveCount(1);
  for (
    let i = 0;
    i < 4 && Number(await marker.getAttribute("data-frame")) < 4;
    i++
  )
    await step();
  expect(
    Number(await marker.getAttribute("data-frame")),
  ).toBeGreaterThanOrEqual(4);
  expect((await filter())[0].color[0]).toBeGreaterThan(0);
  await expect(marker.locator("svg text")).toHaveText("Charge!");
  for (let i = 0; i < 5 && (await filter())[0]?.frame < 24; i++)
    await step();
  const pulse = (await filter())[0];
  // A 0.1-second sample can pass the peak by one six-frame step.
  expect(pulse.frame).toBeGreaterThanOrEqual(24);
  expect(pulse.frame).toBeLessThanOrEqual(30);
  expect(pulse.color).toEqual(chargeFilter.colors[pulse.frame]);
  await page.screenshot({
    path: info.outputPath("native-prince-charge-filter.png"),
    fullPage: true,
  });
  const frame = await marker.getAttribute("data-frame");
  const filterFrame = (await filter())[0].frame;
  await page.waitForTimeout(180);
  expect(await marker.getAttribute("data-frame")).toBe(frame);
  expect((await filter())[0].frame).toBe(filterFrame);
  for (let i = 0; i < 18 && (await marker.count()) > 0; i++) await step();
  await expect(marker).toHaveCount(0);
  expect(await filter()).toEqual([]);
  await page.locator("#scenario").selectOption("deployment");
  await expect(marker).toHaveCount(0);
  expect(errors).toEqual([]);
});
