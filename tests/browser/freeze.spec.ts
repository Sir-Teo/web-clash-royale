import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native Freeze covers both teams, holds on pause and clears with the area", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("freeze");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const status = page.locator("#destruction");
  const areas = async () =>
    JSON.parse((await status.getAttribute("data-freeze-areas"))!);
  const state = async () =>
    JSON.parse((await status.getAttribute("data-state"))!);
  const cold = async () =>
    JSON.parse((await status.getAttribute("data-cold-filter"))!);
  await page.locator("#freeze-cast").click();
  await expect.poll(async () => (await areas()).length).toBe(2);
  expect((await areas()).map((area: { team: string }) => area.team)).toEqual([
    "blue",
    "red",
  ]);
  expect((await state()).particles).toBe(220);
  expect((await state()).clips.snowflake_anim).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-freeze-start.png"),
    fullPage: true,
  });
  await page.locator("#second").click();
  await expect
    .poll(async () =>
      (await areas()).map((area: { frame: number }) => area.frame),
    )
    .toEqual([30, 30]);
  await expect.poll(async () => (await cold()).length).toBe(2);
  expect((await cold()).map((actor: { frame: number }) => actor.frame)).toEqual(
    [0, 0],
  );
  await page.locator("#step").click();
  await expect
    .poll(async () =>
      (await cold()).map((actor: { frame: number }) => actor.frame),
    )
    .toEqual([6, 6]);
  const heldAreas = await areas();
  const heldParticles = await state();
  const heldCold = await cold();
  await page.waitForTimeout(180);
  expect(await areas()).toEqual(heldAreas);
  expect(await state()).toEqual(heldParticles);
  expect(await cold()).toEqual(heldCold);
  await page.screenshot({
    path: info.outputPath("native-freeze-active.png"),
    fullPage: true,
  });
  for (let i = 0; i < 3; i++) await page.locator("#second").click();
  await expect.poll(async () => (await areas()).length).toBe(0);
  for (let i = 0; i < 5; i++) await page.locator("#second").click();
  expect((await state()).particles).toBe(0);
  expect(await cold()).toEqual([]);
  await page.locator("#reset").click();
  expect(await areas()).toEqual([]);
  expect(errors).toEqual([]);
});
