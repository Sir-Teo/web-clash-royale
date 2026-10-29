import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "weak",
  "collector",
  "king",
  "mirror",
  "pressure",
  "blast",
  "guard",
])
  test(`AI Barrel ${scenario} follows flight, native child arrival and actual target hits`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-barrel-${scenario}`);
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
    const shots = async () =>
      JSON.parse(
        (await page.locator("#destruction").getAttribute("data-projectiles"))!,
      );
    const advance = async (small = false) => {
      const before = (await state()).time;
      await page.locator(small ? "#step" : "#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + (small ? 0.099 : 0.99));
    };
    const initial = await state();
    await advance();
    await advance();
    expect((await state()).actions).toEqual([]);
    await advance();
    const placed = await state();
    expect(placed.actions).toHaveLength(1);
    if (scenario === "pressure") {
      expect(placed.actions[0].card).toBe("musketeer");
      expect(placed.barrelChildren).toEqual([]);
    } else {
      const target =
        scenario === "collector"
          ? initial.enemyBuildings[0]
          : initial.enemyCrowns.find((e: any) =>
              scenario === "king"
                ? e.king
                : e.lane ===
                  (["blast", "guard"].includes(scenario) ? "left" : "right"),
            );
      expect(placed.actions[0]).toMatchObject({
        card: scenario === "mirror" ? "mirror" : "goblin-barrel",
        x: target.x,
        y: target.y,
      });
      expect(placed.elixir).toBeGreaterThanOrEqual(2);
      expect(placed.barrelChildren).toEqual([]);
      await expect
        .poll(async () =>
          (await shots()).some((shot: any) =>
            shot.sprites.some(
              (sprite: any) => sprite.name === "spell_goblin_barrel_projectile",
            ),
          ),
        )
        .toBe(true);
      if (scenario === "weak")
        await page.screenshot({
          path: info.outputPath("ai-barrel-flight.png"),
          fullPage: true,
        });
      for (let i = 0; i < 3; i++) await advance();
      for (let i = 0; i < 15 && !(await state()).barrelChildren.length; i++)
        await advance(true);
      const arrived = await state();
      expect(arrived.barrelChildren).toHaveLength(3);
      expect(
        arrived.barrelChildren.every((e: any) => e.deploy > 0 && e.hp > 0),
      ).toBe(true);
      await expect
        .poll(async () =>
          (await state()).barrelChildren.every((e: any) => e.native),
        )
        .toBe(true);
      for (let i = 0; i < 4 && !(await state()).barrelHits.length; i++)
        await advance();
      const hit = await state();
      expect(hit.barrelHits[0]).toMatchObject({
        x: target.x,
        y: target.y,
        value: 135,
      });
      const defenders = hit.barrelChildren.filter((e: any) => e.hp > 0);
      expect(defenders.length).toBeGreaterThan(0);
      expect(
        defenders.every((e: any) => e.native && e.target === target.id),
      ).toBe(true);
      const damaged = [...hit.enemyCrowns, ...hit.enemyBuildings].find(
        (e: any) => e.id === target.id,
      );
      expect(target.hp - damaged.hp).toBeGreaterThanOrEqual(135);
      expect(hit.actions[0]).toEqual(placed.actions[0]);
      expect(
        hit.actions.filter(
          (action: any) =>
            action.card === "goblin-barrel" || action.card === "mirror",
        ),
      ).toEqual(placed.actions);
      if (["weak", "collector", "king"].includes(scenario))
        await page.screenshot({
          path: info.outputPath(`ai-barrel-${scenario}-hit.png`),
          fullPage: true,
        });
    }
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
