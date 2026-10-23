import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("both Fireballs produce their full native explosion, hold on pause and expire", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("fireball");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const status = page.locator("#destruction");
  const state = async () =>
    JSON.parse((await status.getAttribute("data-state"))!);
  // A click changes simulation immediately; the diagnostic updates on the next
  // rendered frame. Await that frame before sampling a manual step or pause.
  const advance = async (selector = "#step", seconds = 0.1) => {
    const before = (await state()).time;
    await page.locator(selector).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + seconds - 0.001);
  };
  for (
    let i = 0;
    i < 30 && (await status.getAttribute("data-impacts")) !== "2";
    i++
  )
    await advance();
  await expect(status).toHaveAttribute("data-impacts", "2");
  expect((await state()).particles).toBe(296);
  expect((await state()).draws).toBeGreaterThan(0);
  // Ground fragments begin at 100 ms and finish their 1-ms stagger by 131 ms.
  await advance();
  await advance();
  const early = await state();
  expect(early.clips.darken_gradient).toBe(2);
  expect(early.clips.explosion_cloud_1).toBeGreaterThan(60);
  expect(
    Object.keys(early.clips).filter((name) => name.startsWith("particle_coal")),
  ).toHaveLength(10);
  expect(early.draws).toBeLessThan(130);
  expect(early.tails.active).toBeGreaterThan(0);
  expect(early.tails.stretched).toBeGreaterThan(0);
  expect(early.tails.maxStretch).toBeGreaterThan(1);
  await page.screenshot({
    path: info.outputPath("native-fireball-impact.png"),
    fullPage: true,
  });
  await page.waitForTimeout(300);
  expect(await state()).toEqual(early);
  for (let i = 0; i < 4; i++) await advance();
  expect((await state()).clips.MolotovTrailParticle).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("native-fireball-flames.png"),
    fullPage: true,
  });
  for (let i = 0; i < 6; i++) await advance("#second", 1);
  expect((await state()).particles).toBe(0);
  expect((await state()).draws).toBe(0);
  expect((await state()).tails.active).toBe(0);
  expect(errors).toEqual([]);
});
