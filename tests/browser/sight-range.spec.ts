import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native sight notices new targets in the outer ring on both teams", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-sight-range"))!,
    ) as {
      version: number;
      time: number;
      bodies: {
        id: number;
        card: string;
        team: string;
        sight: number;
        noticed: boolean;
        gap: number;
        targetHp: number;
        native: boolean;
        lock?: unknown;
        pending?: unknown;
      }[];
    };
  const traces: unknown[] = [];
  for (const version of [24, 25]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=sight-range&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of ["cannon", "musketeer", "inferno-tower"]) {
      await page.locator("#attack-card").selectOption(card);
      await expect
        .poll(async () => {
          const current = await state();
          return (
            current.time === 0 &&
            current.bodies.length === 2 &&
            current.bodies.every((body) => body.card === card && body.native)
          );
        })
        .toBe(true);
      const initial = await state();
      expect(initial.bodies.every((body) => !body.noticed)).toBe(true);
      expect(initial.version).toBe(version);
      expect(initial.bodies).toHaveLength(2);
      expect(new Set(initial.bodies.map((body) => body.team)).size).toBe(2);
      for (const body of initial.bodies)
        expect(body.gap <= body.sight).toBe(version === 25);
      await page.locator("#step").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(0.1);
      for (const body of (await state()).bodies) {
        expect(body.noticed).toBe(version === 25);
        expect(!!(body.lock || body.pending)).toBe(version === 25);
      }
      // Include Cannon's windup and the long projectile flight from this ring.
      for (let second = 0; second < 3; second++)
        await page.locator("#second").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(3.1);
      const active = await state();
      for (const body of active.bodies)
        expect(
          body.targetHp <
            initial.bodies.find((entry) => entry.id === body.id)!.targetHp,
        ).toBe(version === 25);
      traces.push({ version, card, initial, active });
      if (card === "inferno-tower") {
        await page.locator("main").screenshot({
          path: info.outputPath(`tower-sight-rules-${version}.png`),
        });
        if (version === 25) {
          await page.locator("#rebuild").click();
          await expect
            .poll(
              async () =>
                JSON.parse(
                  (await page
                    .locator("#destruction")
                    .getAttribute("data-inferno-beams"))!,
                ).length,
            )
            .toBe(2);
          expect(await state()).toEqual(active);
        }
      }
      if (version === 25) {
        await page.locator("#range-out").click();
        await page.locator("#step").click();
        await expect.poll(async () => (await state()).time).toBeCloseTo(3.2);
        for (const body of (await state()).bodies) {
          expect(body.noticed).toBe(false);
          expect(body.lock || body.pending).toBeUndefined();
        }
        if (card.startsWith("inferno-"))
          expect(
            JSON.parse(
              (await page
                .locator("#destruction")
                .getAttribute("data-inferno-beams"))!,
            ),
          ).toHaveLength(0);
      }
    }
  }
  await info.attach("sight-range-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
