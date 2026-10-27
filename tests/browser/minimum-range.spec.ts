import { test, expect } from "@playwright/test";
import { expectedBuildings } from "./native-assets";

test("Mortar respects target-size blind spots for both teams and earlier recordings", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-minimum-range"))!,
    ) as {
      version: number;
      time: number;
      mode: string;
      bodies: {
        id: number;
        team: string;
        targetRadius: number;
        minimum: number;
        gap: number;
        targetHp: number;
        native: boolean;
        pending?: unknown;
        shots: number;
      }[];
    };
  const traces: unknown[] = [];
  for (const version of [25, 26]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=minimum-range&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedBuildings} buildings loaded`,
      { timeout: 60000 },
    );
    for (const mode of ["small", "large"]) {
      await page.locator("#minimum-target").selectOption(mode);
      await expect
        .poll(async () => {
          const current = await state();
          return (
            current.mode === mode &&
            current.time === 0 &&
            current.bodies.length === 2 &&
            current.bodies.every((body) => body.native)
          );
        })
        .toBe(true);
      const initial = await state(),
        shoots = version === 26 ? mode === "large" : mode === "small";
      expect(initial.version).toBe(version);
      expect(new Set(initial.bodies.map((body) => body.team)).size).toBe(2);
      for (const body of initial.bodies) {
        expect(body.targetRadius).toBe(mode === "large" ? 1 : 0.5);
        expect(body.minimum).toBeCloseTo(
          version === 25 ? 4.5 : mode === "large" ? 4.1 : 4.6,
        );
        expect(body.gap >= body.minimum).toBe(shoots);
      }
      await page.locator("#step").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(0.1);
      for (const body of (await state()).bodies)
        expect(!!body.pending).toBe(shoots);
      for (let second = 0; second < 3; second++)
        await page.locator("#second").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(3.1);
      const active = await state();
      for (const body of active.bodies)
        expect(
          body.targetHp <
            initial.bodies.find((entry) => entry.id === body.id)!.targetHp,
        ).toBe(shoots);
      traces.push({ version, mode, initial, active });
      await page
        .locator("main")
        .screenshot({
          path: info.outputPath(`mortar-${mode}-rules-${version}.png`),
        });
      if (version === 26 && mode === "large") {
        await page.locator("#rebuild").click();
        await expect
          .poll(async () => (await state()).bodies.every((body) => body.native))
          .toBe(true);
        expect(await state()).toEqual(active);
      }
    }
  }
  await info.attach("minimum-range-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
