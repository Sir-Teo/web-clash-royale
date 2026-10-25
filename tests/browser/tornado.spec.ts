import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Tornado displays native whirl, particles and ring while pulling troops on desktop and phone", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("tornado");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const node = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await node.getAttribute("data-state"))!);
  const areas = async () =>
    JSON.parse((await node.getAttribute("data-tornado-areas"))!);
  const troops = async () =>
    JSON.parse((await node.getAttribute("data-tornado-entities"))!);
  await expect.poll(async () => (await troops()).length).toBeGreaterThan(1);
  const before = await troops();
  await page.locator("#tornado-cast").click();
  await page.locator("#second").click();
  await expect.poll(async () => (await state()).time).toBeGreaterThan(0.99);
  expect(await areas()).toHaveLength(1);
  expect((await areas())[0].frame).toBe(30);
  expect(
    (await troops()).every((troop: any, i: number) => troop.y > before[i].y),
  ).toBe(true);
  const active = await state();
  expect(active.clips.whirl_animation_fx).toBeGreaterThan(0);
  expect(active.particles).toBeGreaterThan(100);
  expect(active.draws).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-tornado-active.png"),
    fullPage: true,
  });
  await page.waitForTimeout(250);
  expect(await state()).toEqual(active);
  for (let i = 0; i < 4; i++) await page.locator("#second").click();
  await expect.poll(async () => (await areas()).length).toBe(0);
  expect(errors).toEqual([]);
});
