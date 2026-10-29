import { test, expect } from "@playwright/test";
import { CARD_MAP, type CardId } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of [
  "golem",
  "hound",
  "musketeers",
  "saving",
  "mirror",
  "pressure",
  "blast",
  "late",
])
  test(`AI army ${scenario} funds a legal native formation and advances to a real Crown hit`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/tests/fixtures/combat.html?scene=ai-army-${scenario}`);
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
    const advance = async (five = false) => {
      const before = (await state()).time;
      await page.locator(five ? "#five" : "#second").click();
      await expect
        .poll(async () => (await state()).time)
        .toBeGreaterThan(before + (five ? 4.99 : 0.99));
    };
    const initial = await state();
    await advance();
    await advance();
    expect((await state()).actions).toEqual([]);
    await advance();
    if (scenario === "saving") {
      expect((await state()).actions).toEqual([]);
      for (let i = 0; i < 15 && !(await state()).actions.length; i++)
        await advance();
    }
    const placed = await state();
    expect(placed.actions).toHaveLength(1);
    if (scenario === "pressure" || scenario === "late") {
      if (scenario === "pressure")
        expect(placed.actions[0].card).toBe("musketeer");
      else
        expect(["knight", "skeletons", "archers"]).toContain(
          placed.actions[0].card,
        );
      expect(placed.armyBodies.filter((e: any) => e.card === "golem")).toEqual(
        [],
      );
    } else {
      const card: CardId =
        scenario === "hound"
          ? "lava-hound"
          : ["musketeers", "mirror", "blast"].includes(scenario)
            ? "three-musketeers"
            : "golem";
      const body: CardId = card === "three-musketeers" ? "musketeer" : card;
      const target = initial.enemyCrowns.find(
        (e: any) => e.lane === (scenario === "blast" ? "left" : "right"),
      );
      expect(placed.actions[0].card).toBe(
        scenario === "mirror" ? "mirror" : card,
      );
      expect(placed.actions[0].y).toBeLessThan(14.5);
      const cost = CARD_MAP[card].cost + (scenario === "mirror" ? 1 : 0);
      expect(placed.elixir).toBeGreaterThanOrEqual(Math.min(2, 10 - cost));
      if (scenario === "saving")
        expect(placed.actions[0].tick / 30).toBeGreaterThanOrEqual(11);
      expect(
        placed.armyBodies.filter((e: any) => e.card === body),
      ).toHaveLength(CARD_MAP[card].count);
      await expect
        .poll(async () =>
          (await state()).armyBodies
            .filter((e: any) => e.card === body)
            .every((e: any) => e.native),
        )
        .toBe(true);
      if (scenario === "blast") {
        expect(placed.actions[0]).not.toMatchObject({ x: 3.5, y: 9 });
        for (let i = 0; i < 8 && (await state()).hostileRockets; i++)
          await advance();
        const safe = await state();
        expect(safe.hostileRockets).toBe(0);
        expect(
          safe.armyBodies.filter((e: any) => e.card === body),
        ).toHaveLength(CARD_MAP[card].count);
        expect(
          safe.armyBodies
            .filter((e: any) => e.card === body)
            .every((e: any) => e.hp === e.maxHp),
        ).toBe(true);
      }
      for (
        let i = 0;
        i < 8 && !(await state()).armyHits.some((e: any) => e.card === body);
        i++
      ) {
        const current = await state();
        const distance = Math.min(
          ...current.armyBodies
            .filter((e: any) => e.card === body)
            .map((e: any) => Math.hypot(e.x - target.x, e.y - target.y)),
        );
        if (distance <= 12) break;
        await advance(true);
      }
      for (
        let i = 0;
        i < 25 && !(await state()).armyHits.some((e: any) => e.card === body);
        i++
      )
        await advance();
      const hit = await state(),
        impact = hit.armyHits.find((e: any) => e.card === body);
      expect(impact).toMatchObject({
        x: target.x,
        y: target.y,
        value: CARD_MAP[body].damage,
      });
      const damaged = hit.enemyCrowns.find((e: any) => e.id === target.id);
      expect(damaged).toBeDefined();
      expect(target.hp - damaged.hp).toBeGreaterThanOrEqual(
        CARD_MAP[body].damage,
      );
      expect(
        hit.armyBodies.some(
          (e: any) => e.card === body && e.native && e.target === target.id,
        ),
      ).toBe(true);
      expect(hit.actions[0]).toEqual(placed.actions[0]);
      if (["golem", "hound", "musketeers", "blast"].includes(scenario))
        await page.screenshot({
          path: info.outputPath(`ai-army-${scenario}-hit.png`),
          fullPage: true,
        });
    }
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
