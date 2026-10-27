import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const team of ["blue", "red"])
  test(`lane-aware destinations and fresh Cannon acquisition on ${team}`, async ({
    page,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-distant-targets"))!,
      );
    const traces = [];
    for (const version of [31, 32]) {
      await page.goto(
        `/tests/fixtures/combat.html?scene=distant-targets&rules=${version}&team=${team}`,
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
              value.bodies.length === 1 &&
              value.bodies[0].native &&
              value.bodies[0].candidates.every((body: any) => body.native)
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      const initial = await state();
      expect(initial.version).toBe(version);
      expect(initial.bodies[0].policy).toBe(version === 32);
      expect(initial.bodies[0].lane).toBe(version === 32 ? 1 : undefined);
      await page.locator("#step").click();
      await expect
        .poll(async () => (await state()).tick)
        .toBe(initial.tick + 3);
      const selected = await state(),
        body = selected.bodies[0];
      expect(body.target).toBe(body.candidates[version === 32 ? 1 : 0].id);
      expect(body.candidates.map((target: any) => target.hp)).toEqual([
        1e6, 3052, 5232,
      ]);
      await page
        .locator("main")
        .screenshot({
          path: info.outputPath(`distant-${team}-rules-${version}.png`),
        });
      await page.locator("#rebuild").click();
      await expect
        .poll(async () => (await state()).bodies[0].native, { timeout: 30000 })
        .toBe(true);
      expect((await state()).bodies).toEqual(selected.bodies);
      await page.locator("#range-out").click();
      await page.locator("#step").click();
      await expect
        .poll(async () => (await state()).tick)
        .toBe(initial.tick + 6);
      const removed = await state();
      expect(removed.stage).toBe(1);
      expect(removed.bodies[0].target).toBe(
        body.candidates[version === 32 ? 2 : 0].id,
      );
      expect(removed.bodies[0].candidates[1].hp).toBe(0);
      await page.locator("#range-out").click();
      for (let step = 1; step <= 3; step++) {
        await page.locator("#second").click();
        await expect
          .poll(async () => (await state()).tick)
          .toBe(initial.tick + 6 + step * 30);
      }
      const hit = await state();
      expect(hit.bodies[0].target).toBe(body.candidates[0].id);
      expect(hit.bodies[0].candidates[0].hp).toBeLessThan(1e6);
      expect(hit.bodies[0].candidates[2].hp).toBe(5232);
      traces.push({ version, selected, removed, hit });
    }
    await info.attach("distant-target-traces", {
      body: JSON.stringify(traces, null, 2),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });
