import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const team of ["blue", "red"])
  test(`Barrel child formation, ordinal and actual Crown damage on ${team}`, async ({
    page,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-barrel-formation"))!,
      );
    const traces = [];
    for (const version of [32, 33]) {
      await page.goto(
        `/tests/fixtures/combat.html?scene=barrel-formation&rules=${version}&team=${team}`,
      );
      await expect(page.locator("#status")).toContainText(
        `${expectedEffects} effects`,
        { timeout: 60000 },
      );
      await expect
        .poll(
          async () => {
            const value = await state();
            return (
              value.children.length === 3 &&
              value.children.every((body: any) => body.native)
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      const initial = await state();
      expect(initial.version).toBe(version);
      expect(initial.target.hp).toBe(3052);
      const forward = team === "blue" ? -1 : 1;
      const expected =
        version === 33
          ? [
              [0, forward * 0.577],
              [-0.499, -forward * 0.288],
              [0.499, -forward * 0.288],
            ]
          : [
              [0, -0.5],
              [Math.sqrt(3) / 4, 0.25],
              [-Math.sqrt(3) / 4, 0.25],
            ];
      for (const [index, body] of initial.children.entries()) {
        expect(body.x).toBeCloseTo(initial.target.x + expected[index][0], 10);
        expect(body.y).toBeCloseTo(initial.target.y + expected[index][1], 10);
        expect(body.worldX).toBeCloseTo(body.x - 9, 6);
        expect(body.worldZ).toBeCloseTo(body.y - 16, 6);
        expect(body.bias).toBe([0, 400, 1600][index]);
        expect(body.lane).toBe(1);
      }
      await page
        .locator("main")
        .screenshot({
          path: info.outputPath(`barrel-${team}-rules-${version}.png`),
        });
      await page.locator("#rebuild").click();
      await expect
        .poll(
          async () =>
            (await state()).children.every((body: any) => body.native),
          { timeout: 30000 },
        )
        .toBe(true);
      expect((await state()).children).toEqual(initial.children);
      await page.locator("#range-out").click();
      await page.locator("#second").click();
      await expect
        .poll(async () => (await state()).tick)
        .toBe(initial.tick + 30);
      const hit = await state();
      expect(hit.target.hp).toBeGreaterThan(0);
      expect(hit.target.hp).toBeLessThan(initial.target.hp);
      traces.push({ version, initial, hit });
    }
    await info.attach("barrel-formation-traces", {
      body: JSON.stringify(traces, null, 2),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });
