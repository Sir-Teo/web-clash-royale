import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "furnace",
  "goblin",
  "barbarian",
  "saving",
  "pressure",
  "blast",
  "late",
])
  test(`AI ${scenario} reinforcement plan uses normal commands and source summons`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-spawner-${scenario}`);
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedBuildings} buildings loaded`,
    );
    const output = page.locator("#destruction");
    const state = async () =>
      JSON.parse((await output.getAttribute("data-ai-defense"))!);
    const second = async () => {
      const before = (await state()).time;
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + 0.99);
    };
    await second();
    await second();
    expect((await state()).actions).toEqual([]);
    await second();
    if (scenario === "saving") {
      expect((await state()).actions).toEqual([]);
      for (let i = 0; i < 10 && !(await state()).actions.length; i++)
        await second();
      const funded = await state();
      expect(funded.actions).toHaveLength(1);
      expect(funded.actions[0].card).toBe("barbarian-hut");
      expect(funded.actions[0].tick / 30).toBeGreaterThanOrEqual(8.4);
      expect(funded.elixir).toBeGreaterThanOrEqual(2);
    } else if (scenario === "pressure" || scenario === "late") {
      const result = await state();
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].card).toBe("knight");
      expect(result.buildings).toEqual([]);
    } else {
      const card =
        scenario === "goblin"
          ? "goblin-hut"
          : scenario === "barbarian"
            ? "barbarian-hut"
            : "furnace";
      const result = await state();
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        card,
        x: scenario === "blast" ? 6.5 : 9,
        y: scenario === "blast" ? 7.5 : 10,
      });
      expect(result.elixir).toBeGreaterThanOrEqual(2);
      expect(result.buildings[0]).toMatchObject({ card, native: true });
      expect(result.defenders).toEqual([]);
      await second();
      await second();
      const active = await state();
      const child =
        scenario === "goblin"
          ? "spear-goblins"
          : scenario === "barbarian"
            ? "barbarians"
            : "fire-spirits";
      expect(active.defenders).toHaveLength(scenario === "goblin" ? 1 : 2);
      for (const entity of active.defenders)
        expect(entity).toMatchObject({ card: child, native: true });
      expect(active.buildings[0].hp).toBeGreaterThan(
        active.buildings[0].maxHp * 0.8,
      );
      expect(active.actions).toEqual(result.actions);
      if (scenario !== "blast")
        await page.screenshot({
          path: info.outputPath(`ai-${card}-reinforcements.png`),
          fullPage: true,
        });
    }
    const width = await page.evaluate(() => ({
      viewport: innerWidth,
      content: document.body.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    expect(errors).toEqual([]);
  });
