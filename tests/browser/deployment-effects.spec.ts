import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native troop deployment filter follows the archived color and pose timeline on both sides", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#death-card").selectOption("knight");
  await page.locator("#spawn").click();
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-deploy-filter"))!,
    );
  await expect.poll(async () => (await state()).length).toBe(2);
  expect(
    (await state()).map(
      (actor: { frame: number; color: number[]; applied: boolean }) => [
        actor.frame,
        actor.color,
        actor.applied,
      ],
    ),
  ).toEqual([
    [0, [150, 150, 150, 102, 255, 255, 255], true],
    [0, [150, 150, 150, 102, 255, 255, 255], true],
  ]);
  await page.screenshot({
    path: info.outputPath("native-troop-deployment-frame-0.png"),
    fullPage: true,
  });
  await page.waitForTimeout(150);
  expect(
    (await state()).map((actor: { frame: number }) => actor.frame),
  ).toEqual([0, 0]);
  await page.locator("#step").click();
  await expect
    .poll(async () =>
      (await state()).map((actor: { frame: number }) => actor.frame),
    )
    .toEqual([6, 6]);
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).length).toBe(0);
  await page.locator("#reset").click();
  expect(await state()).toEqual([]);
  expect(errors).toEqual([]);
});

test("native deployment dust follows per-unit source counts, timing, pause and cleanup", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-state"))!,
    );
  const step = async (selector = "#step", amount = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + amount - 0.001);
  };
  for (const [card, count] of [
    ["knight", 166],
    ["archers", 332],
    ["giant", 266],
    ["pekka", 133],
    ["goblins", 0],
  ] as const) {
    await page.locator("#death-card").selectOption(card);
    await page.locator("#spawn").click();
    await expect.poll(async () => (await state()).particles).toBe(count);
    expect((await state()).draws).toBe(0);
    await step();
    await step();
    expect((await state()).draws).toBe(0);
    await step();
    await step();
    if (count) {
      const held = await state();
      expect(held.draws).toBeGreaterThan(0);
      expect(held.draws).toBeLessThan(45);
      expect(held.clips.d3_green_dark).toBeGreaterThan(0);
      await page.waitForTimeout(200);
      expect(await state()).toEqual(held);
      if (card === "knight" || card === "giant")
        await page.screenshot({
          path: info.outputPath(`${card}-native-deployment.png`),
          fullPage: true,
        });
    }
    await step("#second", 1);
    await step("#second", 1);
    await step("#second", 1);
    expect((await state()).particles).toBe(0);
    expect((await state()).draws).toBe(0);
  }
  expect(errors).toEqual([]);
});

test("native card groups play independent staggered deployment filter frames", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=deployment");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  const units = async () => JSON.parse(
    (await page.locator("#destruction").getAttribute("data-deployment-timing"))!,
  ) as { id: number; team: string; age: number; deploy: number; delay: number }[];
  const filters = async () => JSON.parse(
    (await page.locator("#destruction").getAttribute("data-deploy-filter"))!,
  ) as { id: number; frame: number }[];
  for (const [id, delays] of [
    ["three-musketeers", [0, 0.1, 0.2]],
    ["minion-horde", [0, 0.066, 0.133, 0.2, 0.266, 0.333]],
    ["archers", [0, 0.2]],
  ] as const) {
    await page.locator("#reset").click();
    await expect.poll(async () => (await units()).length).toBe(0);
    await page.locator("#death-card").selectOption(id);
    await page.locator("#spawn").click();
    await expect.poll(async () => (await filters()).length).toBe(delays.length * 2);
    for (const team of ["blue", "red"])
      expect((await units()).filter((e) => e.team === team).map((e) => e.delay)).toEqual(delays);
    expect((await filters()).every((e) => e.frame === 0)).toBe(true);
    for (let step = 0; step < 2; step++) await page.locator("#step").click();
    await expect.poll(async () => (await units()).every((e) => e.age > 0.19)).toBe(true);
    const frames = new Map((await filters()).map((e) => [e.id, e.frame]));
    for (const unit of await units()) {
      const expected = Math.max(0, (unit.age - unit.delay) * 60);
      expect(frames.get(unit.id)).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
      expect(frames.get(unit.id)).toBeLessThanOrEqual(Math.floor(expected) + 1);
      expect(unit.deploy).toBeGreaterThan(0.7);
    }
    if (id === "three-musketeers")
      await page.screenshot({ path: info.outputPath("three-musketeers-staggered-filter.png"), fullPage: true });
    await page.locator("#second").click();
    await expect.poll(async () => (await filters()).length).toBe(0);
    expect((await units()).every((e) => e.deploy <= 0)).toBe(true);
  }
  expect(errors).toEqual([]);
});
