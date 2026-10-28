import { test, expect } from "@playwright/test";
import { expectedBuildings, expectedEffects } from "./native-assets";

for (const scenario of ["quiet", "pressure", "blast", "late"])
  test(`AI Collector ${scenario} decision uses the normal timer and real card commands`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/tests/fixtures/combat.html?scene=ai-collector-${scenario}`,
    );
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
    const pump = async () =>
      JSON.parse((await output.getAttribute("data-collector"))!);
    const time = async () => (await state()).time;
    const second = async () => {
      const before = await time();
      await page.locator("#second").click();
      await expect.poll(time).toBeGreaterThan(before + 0.99);
    };
    await second();
    await second();
    expect((await state()).actions).toEqual([]);
    await second();
    const result = await state();
    if (scenario === "late") {
      expect(result.actions).toEqual([]);
      expect(result.elixir).toBeGreaterThan(8);
    } else if (scenario === "pressure") {
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].card).toBe("knight");
      expect(result.buildings).toEqual([]);
    } else {
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        card: "elixir-collector",
        x: scenario === "blast" ? 16.5 : 1.5,
        y: 1.5,
      });
      expect(result.elixir).toBeGreaterThanOrEqual(2);
      const building = result.buildings.find(
        (entity: any) => entity.card === "elixir-collector",
      );
      expect(building).toMatchObject({
        x: scenario === "blast" ? 16.5 : 1.5,
        y: 1.5,
        target: null,
      });
      if (scenario === "quiet") {
        for (let i = 0; i < 8; i++) await second();
        await expect.poll(async () => (await pump()).frame).toBeGreaterThan(0);
        expect((await pump()).collections).toBe(0);
        await page.screenshot({
          path: info.outputPath("ai-collector-rear-pump.png"),
          fullPage: true,
        });
        const before = (await state()).elixir;
        await second();
        await second();
        expect((await pump()).collections).toBe(1);
        expect((await state()).elixir - before).toBeGreaterThan(1);
        expect((await state()).actions).toEqual(result.actions);
      }
    }
    const width = await page.evaluate(() => ({
      viewport: innerWidth,
      content: document.body.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    expect(errors).toEqual([]);
  });
