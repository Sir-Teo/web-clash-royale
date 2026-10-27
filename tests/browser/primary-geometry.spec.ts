import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

for (const team of ["blue", "red"])
  test(`fresh Hog scans respect source clipping and Crown sight on ${team}`, async ({
    page,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = async () =>
      JSON.parse(
        (await page
          .locator("#destruction")
          .getAttribute("data-primary-score"))!,
      );
    const traces = [];
    for (const version of [29, 30]) {
      await page.goto(
        `/tests/fixtures/combat.html?scene=primary-geometry&rules=${version}&team=${team}`,
      );
      await expect(page.locator("#status")).toContainText(
        `${expectedEffects} effects`,
        { timeout: 60000 },
      );
      await expect
        .poll(
          async () => {
            const current = await state();
            return current.bodies.length === 1 && current.bodies[0].native;
          },
          { timeout: 30000 },
        )
        .toBe(true);
      const initial = await state();
      expect(initial.version).toBe(version);
      expect(initial.bodies[0].policy).toBe(version === 30);
      await page.locator("#step").click();
      await expect
        .poll(async () => (await state()).tick)
        .toBe(initial.tick + 3);
      const selected = await state();
      const body = selected.bodies[0];
      expect(body.target).toBe(body.candidates[version === 30 ? 1 : 0].id);
      expect(
        body.candidates.every((candidate: any) => candidate.hp === 1e6),
      ).toBe(true);
      await page
        .locator("main")
        .screenshot({
          path: info.outputPath(
            `primary-geometry-${team}-rules-${version}.png`,
          ),
        });
      await page.locator("#rebuild").click();
      await expect
        .poll(async () => (await state()).bodies[0].native, { timeout: 30000 })
        .toBe(true);
      expect((await state()).bodies).toEqual(selected.bodies);
      await page.locator("#range-out").click();
      for (let step = 1; step <= 3; step++) {
        await page.locator("#second").click();
        await expect
          .poll(async () => (await state()).tick)
          .toBe(initial.tick + 3 + step * 30);
      }
      const landed = await state();
      expect(landed.bodies[0].target).toBe(body.target);
      for (const candidate of landed.bodies[0].candidates)
        if (candidate.id === body.target)
          expect(candidate.hp).toBeLessThan(1e6);
        else expect(candidate.hp).toBe(1e6);
      traces.push({ version, initial, selected, landed });
    }
    await info.attach("primary-geometry-traces", {
      body: JSON.stringify(traces, null, 2),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });
