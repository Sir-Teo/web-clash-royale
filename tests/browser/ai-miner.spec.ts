import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "weak",
  "collector",
  "king",
  "mirror",
  "pressure",
  "blast",
])
  test(`AI Miner ${scenario} uses its tunnel, native art and real target damage`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-miner-${scenario}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedBuildings} buildings loaded`,
    );
    const state = async () =>
      JSON.parse(
        (await page.locator("#destruction").getAttribute("data-ai-defense"))!,
      );
    const miner = async () =>
      JSON.parse(
        (await page.locator("#destruction").getAttribute("data-miner"))!,
      );
    const second = async () => {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    };
    const initial = await state();
    await second();
    await second();
    expect((await state()).actions).toEqual([]);
    await second();
    const placed = await state();
    expect(placed.actions).toHaveLength(1);
    if (scenario === "pressure") {
      expect(placed.actions[0].card).toBe("musketeer");
      expect(await miner()).toMatchObject({ traveling: 0, units: 0 });
    } else {
      expect(placed.actions[0].card).toBe(
        scenario === "mirror" ? "mirror" : "miner",
      );
      expect(placed.actions[0].y).toBeGreaterThan(18);
      expect(placed.elixir).toBeGreaterThanOrEqual(2);
      await expect
        .poll(miner)
        .toMatchObject({ traveling: 1, units: 0, arrivals: 0 });
      await expect.poll(async () => (await miner()).trails).toHaveLength(1);
      if (scenario === "weak")
        await page.screenshot({
          path: info.outputPath("ai-miner-tunnel.png"),
          fullPage: true,
        });
      const target =
        scenario === "collector"
          ? initial.enemyBuildings[0]
          : initial.enemyCrowns.find((e: any) =>
              scenario === "king"
                ? e.king
                : e.lane === (scenario === "blast" ? "left" : "right"),
            );
      for (let i = 0; i < 10 && !(await state()).minerHits.length; i++)
        await second();
      const hit = await state(),
        amount = scenario === "collector" ? 194 : 78;
      expect(hit.minerHits[0]).toMatchObject({
        x: target.x,
        y: target.y,
        value: amount,
      });
      expect(await miner()).toMatchObject({
        traveling: 0,
        units: 1,
        arrivals: 1,
        trails: [],
      });
      expect(hit.defenders.find((e: any) => e.card === "miner")).toMatchObject({
        target: target.id,
        native: true,
      });
      const damaged = [...hit.enemyCrowns, ...hit.enemyBuildings].find(
        (e: any) => e.id === target.id,
      );
      expect(target.hp - damaged.hp).toBeGreaterThanOrEqual(amount);
      expect(hit.actions).toEqual(placed.actions);
      if (["weak", "collector", "king"].includes(scenario))
        await page.screenshot({
          path: info.outputPath(`ai-miner-${scenario}-hit.png`),
          fullPage: true,
        });
    }
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
