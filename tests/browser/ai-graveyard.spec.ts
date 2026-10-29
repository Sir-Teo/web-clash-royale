import { test, expect } from "@playwright/test";
import { CARD_MAP, type CardId } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "weak",
  "saving",
  "king",
  "mirror",
  "pressure",
  "guard",
  "blast",
  "late",
])
  test(`AI Graveyard ${scenario} saves, casts and produces real native Skeleton pressure`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-graveyard-${scenario}`,
    );
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
    const areas = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-graveyard-areas"))!,
      );
    const births = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-graveyard-births"))!,
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
      for (let i = 0; i < 4 && !(await state()).actions.length; i++)
        await second();
    }
    const placed = await state();
    expect(placed.actions).toHaveLength(1);
    if (scenario === "pressure" || scenario === "late") {
      if (scenario === "pressure")
        expect(placed.actions[0].card).toBe("musketeer");
      else
        expect(CARD_MAP[placed.actions[0].card as CardId].kind).toBe("troop");
      expect(await areas()).toEqual([]);
    } else {
      const right = scenario === "weak" || scenario === "mirror";
      const target = initial.enemyCrowns.find((e: any) =>
        scenario === "king" ? e.king : e.lane === (right ? "right" : "left"),
      );
      expect(placed.actions[0]).toMatchObject({
        card: scenario === "mirror" ? "mirror" : "graveyard",
        x: scenario === "king" ? 9 : right ? 17.3 : 0.7,
        y: scenario === "king" ? 29 : 24.5,
      });
      expect(placed.elixir).toBeGreaterThanOrEqual(2);
      await expect
        .poll(areas)
        .toMatchObject([{ team: "red", card: "graveyard" }]);
      expect((await areas())[0].frame).toBeGreaterThan(0);
      expect(await births()).toEqual([]);
      for (let i = 0; i < 18 && !(await state()).graveyardHits.length; i++)
        await second();
      const hit = await state();
      expect(hit.graveyardHits[0]).toMatchObject({
        x: target.x,
        y: target.y,
        value: 81,
      });
      expect((await births()).some((e: any) => e.team === "red")).toBe(true);
      expect(
        hit.defenders.some(
          (e: any) =>
            e.card === "skeletons" && e.native && e.target === target.id,
        ),
      ).toBe(true);
      const damaged = hit.enemyCrowns.find((e: any) => e.id === target.id);
      expect(target.hp - damaged.hp).toBeGreaterThanOrEqual(81);
      expect(hit.enemyKingActive).toBe(scenario === "king");
      expect(hit.actions[0]).toEqual(placed.actions[0]);
      expect(
        hit.actions.filter(
          (a: any) => a.card === "graveyard" || a.card === "mirror",
        ),
      ).toEqual(placed.actions);
      if (["weak", "saving", "king"].includes(scenario))
        await page.screenshot({
          path: info.outputPath(`ai-graveyard-${scenario}-hit.png`),
          fullPage: true,
        });
    }
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
