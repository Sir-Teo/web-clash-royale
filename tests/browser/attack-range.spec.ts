import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native maximum reach starts both teams' attacks and cancels outside the ring", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-attack-range"))!,
    ) as {
      version: number;
      time: number;
      bodies: {
        id: number;
        card: string;
        team: string;
        reach: number;
        gap: number;
        hits: number;
        targetHp: number;
        native: boolean;
        lock?: unknown;
        pending?: unknown;
      }[];
    };
  const traces: unknown[] = [];
  for (const version of [23, 24]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=attack-range&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of [
      "musketeer",
      "balloon",
      "inferno-dragon",
      "inferno-tower",
    ]) {
      await page.locator("#attack-card").selectOption(card);
      await expect
        .poll(async () => {
          const current = await state();
          return current.time === 0 && current.bodies.length === 2 &&
            current.bodies.every((body) => body.card === card && body.native);
        })
        .toBe(true);
      const initial = await state();
      expect(initial.version).toBe(version);
      expect(initial.bodies).toHaveLength(2);
      expect(new Set(initial.bodies.map((body) => body.team)).size).toBe(2);
      for (const body of initial.bodies)
        expect(body.gap <= body.reach).toBe(version === 24);
      await page.locator("#step").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(0.1);
      for (const body of (await state()).bodies)
        expect(!!(body.lock || body.pending)).toBe(version === 24);
      await page.locator("#second").click();
      await expect.poll(async () => (await state()).time).toBeCloseTo(1.1);
      const active = await state();
      for (const body of active.bodies)
        expect(
          body.targetHp <
            initial.bodies.find((entry) => entry.id === body.id)!.targetHp,
        ).toBe(version === 24);
      traces.push({ version, card, initial, active });
      if (card === "inferno-tower") {
        await page.locator("main").screenshot({
          path: info.outputPath(`tower-range-rules-${version}.png`),
        });
        if (version === 24) {
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
      if (version === 24) {
        await page.locator("#range-out").click();
        await page.locator("#step").click();
        await expect.poll(async () => (await state()).time).toBeCloseTo(1.2);
        for (const body of (await state()).bodies)
          expect(body.lock || body.pending).toBeUndefined();
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
  await info.attach("attack-range-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
