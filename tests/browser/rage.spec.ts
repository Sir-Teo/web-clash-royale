import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Local version-5 Rage renders on both teams, holds while paused and releases troop and tower colors", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("rage");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const node = page.locator("#destruction");
  const state = async (key: string) =>
    JSON.parse((await node.getAttribute(`data-${key}`))!);
  await page.locator("#rage-cast").click();
  await page.locator("#second").click();
  await expect.poll(async () => (await state("rage-areas")).length).toBe(2);
  expect(
    (await state("rage-areas")).map((a: { team: string }) => a.team),
  ).toEqual(["blue", "red"]);
  await expect.poll(async () => (await state("rage-filter")).length).toBe(2);
  await expect
    .poll(async () => (await state("rage-structures")).length)
    .toBe(2);
  expect(
    (await state("rage-entities")).every(
      (e: { rage?: unknown; hp: number }) => e.rage && e.hp === 1666,
    ),
  ).toBe(true);
  expect((await state("state")).particles).toBeGreaterThan(0);
  const held = await state("rage-areas"),
    colors = await state("rage-filter");
  await page.waitForTimeout(180);
  expect(await state("rage-areas")).toEqual(held);
  expect(await state("rage-filter")).toEqual(colors);
  await page.screenshot({
    path: info.outputPath("native-rage-active.png"),
    fullPage: true,
  });
  if (info.project.name !== "desktop") {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await state("rage-areas")).toEqual(held);
    await page.screenshot({
      path: info.outputPath("native-rage-landscape.png"),
      fullPage: true,
    });
  }
  for (let i = 0; i < 6; i++) await page.locator("#second").click();
  await expect.poll(async () => (await state("rage-areas")).length).toBe(0);
  await expect.poll(async () => (await state("rage-filter")).length).toBe(0);
  await expect
    .poll(async () => (await state("rage-structures")).length)
    .toBe(0);
  await page.locator("#rage-towers").click();
  await page.locator("#step").click();
  // A five-tile cloud also reaches each adjacent friendly King Tower.
  await expect
    .poll(async () => (await state("rage-structures")).length)
    .toBe(4);
  expect(
    (await state("rage-structures")).every(
      (a: { parts: number }) => a.parts >= 2,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("native-rage-towers.png"),
    fullPage: true,
  });
  await page.locator("#reset").click();
  await expect
    .poll(async () => (await state("rage-structures")).length)
    .toBe(0);
  expect(errors).toEqual([]);
});
