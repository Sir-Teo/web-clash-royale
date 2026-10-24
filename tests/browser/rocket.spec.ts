import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("Rocket native flight and moving trails pause, rebuild and expire after both blasts", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("rocket");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const output = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await output.getAttribute("data-state"))!);
  const rockets = async () =>
    JSON.parse((await output.getAttribute("data-rockets"))!);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#second").click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + 0.99);
  };
  await expect.poll(async () => (await rockets()).shots.length).toBe(2);
  expect(
    (await rockets()).shots.every(
      (p: any) => p.sprites[0].name === "projectile_rocket",
    ),
  ).toBe(true);
  await step();
  await step();
  const held = await state(),
    flight = await rockets();
  expect(held.clips.fireball_trail3).toBeGreaterThan(0);
  expect(held.particles).toBeLessThanOrEqual(1280);
  expect(flight.shots.every((p: any) => p.position[1] > 2.4)).toBe(true);
  await page.screenshot({
    path: info.outputPath("rocket-flight.png"),
    fullPage: true,
  });
  await page.waitForTimeout(200);
  expect(await state()).toEqual(held);
  expect(await rockets()).toEqual(flight);
  await page.locator("#rebuild").click({ force: true });
  await expect.poll(async () => (await state()).time).toBe(0);
  await expect.poll(async () => (await state()).particles).toBeGreaterThan(0);
  expect((await rockets()).shots).toEqual(flight.shots);
  expect((await state()).particles).toBe(held.particles);
  expect((await state()).clips).toEqual(held.clips);
  await step();
  await step();
  expect((await rockets()).impacts).toBe(2);
  const shake = JSON.parse((await output.getAttribute("data-shake"))!);
  expect(shake.lastEffect).toBe("Rocket_explosion");
  expect(shake.remaining).toBeGreaterThan(0);
  expect((await rockets()).shots).toHaveLength(0);
  expect((await state()).particles).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("rocket-impact.png"),
    fullPage: true,
  });
  for (let i = 0; i < 6; i++) await step();
  expect((await state()).particles).toBe(0);
  expect((await state()).draws).toBe(0);
  expect(errors).toEqual([]);
});
