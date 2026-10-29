import { test, expect } from "@playwright/test";
import { CARD_MAP } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "xbow",
  "mortar",
  "weak",
  "saving",
  "pressure",
  "screen",
  "king",
  "mortar-king",
  "blast",
])
  test(`AI siege ${scenario} uses a real legal placement and Crown attack`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-siege-${scenario}`);
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
    if (scenario === "saving") {
      expect((await state()).actions).toEqual([]);
      for (let i = 0; i < 8 && !(await state()).actions.length; i++)
        await second();
      const funded = await state();
      expect(funded.actions).toHaveLength(1);
      expect(funded.actions[0].card).toBe("x-bow");
      expect(funded.actions[0].tick / 30).toBeGreaterThanOrEqual(5.6);
      expect(funded.elixir).toBeGreaterThanOrEqual(2);
    } else if (scenario === "pressure" || scenario === "screen") {
      const result = await state();
      expect(result.actions).toHaveLength(1);
      if (scenario === "pressure")
        expect(result.actions[0].card).toBe("musketeer");
      else
        expect(
          CARD_MAP[result.actions[0].card as keyof typeof CARD_MAP].kind,
        ).toBe("troop");
      expect(result.buildings).toEqual([]);
    } else {
      const card = scenario.includes("mortar") ? "mortar" : "x-bow";
      const king = scenario.endsWith("king"),
        right = scenario === "weak" || scenario === "blast";
      const target = initial.enemyCrowns.find((entity: any) =>
        king ? entity.king : entity.lane === (right ? "right" : "left"),
      );
      const placed = await state();
      expect(placed.actions).toHaveLength(1);
      expect(placed.actions[0]).toMatchObject({
        card,
        x: right ? 14.5 : 3.5,
        y: king ? 18 : 14,
      });
      expect(placed.elixir).toBeGreaterThanOrEqual(2);
      expect(placed.buildings[0]).toMatchObject({ card, native: true });
      for (let i = 0; i < 17 && !(await state()).siegeHits.length; i++)
        await second();
      const hit = await state();
      expect(hit.siegeHits[0]).toMatchObject({
        x: target.x,
        y: target.y,
        value: CARD_MAP[card].damage,
      });
      const damaged = hit.enemyCrowns.find(
        (entity: any) => entity.id === target.id,
      );
      expect(target.hp - damaged.hp).toBeGreaterThanOrEqual(
        CARD_MAP[card].damage,
      );
      expect(hit.buildings[0]).toMatchObject({
        target: target.id,
        native: true,
      });
      expect(hit.actions).toEqual(placed.actions);
      if (scenario === "blast")
        expect(hit.buildings[0].hp).toBeGreaterThan(
          hit.buildings[0].maxHp * 0.75,
        );
      if (["xbow", "mortar", "king", "mortar-king"].includes(scenario))
        await page.screenshot({
          path: info.outputPath(`ai-siege-${scenario}-crown-hit.png`),
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
