import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("started source projectiles retain the extra half tile on both teams", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-pending-range"))!,
    );
  const advance = async (button = "#step") => {
    const before = (await state()).time;
    await page.locator(button).click();
    await expect
      .poll(async () => (await state()).time)
      .toBeGreaterThan(before + (button === "#second" ? 0.999 : 0.099));
  };
  const traces = [];
  for (const version of [37, 38]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=pending-range&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of [
      "musketeer",
      "cannon",
      "wizard",
      "electro-wizard",
      "sparky",
    ]) {
      await page.locator("#attack-card").selectOption(card);
      await expect
        .poll(
          async () => {
            const current = await state();
            return (
              current.time === 0 &&
              current.bodies.length === 2 &&
              current.bodies.every((b: any) => b.card === card && b.native)
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      await advance();
      const started = await state();
      expect(started.bodies.every((b: any) => b.remaining > 0)).toBe(true);
      expect(new Set(started.bodies.map((b: any) => b.team)).size).toBe(2);
      const allowed = version === 38 && card !== "electro-wizard";
      expect(started.bodies.every((b: any) => b.policy)).toBe(allowed);
      await page.locator("#range-out").click();
      await advance();
      const shifted = await state();
      for (const b of shifted.bodies) {
        expect(b.gap - b.reach).toBeCloseTo(0.5, 10);
        expect(b.remaining !== undefined && b.target === b.victim).toBe(
          allowed,
        );
        if (allowed) expect(b.aim).toBe(b.victim);
      }
      if (allowed) {
        await page.locator("#rebuild").click();
        await expect
          .poll(
            async () => (await state()).bodies.every((b: any) => b.native),
            { timeout: 30000 },
          )
          .toBe(true);
        expect((await state()).bodies).toEqual(shifted.bodies);
        let sawNative = false;
        for (let n = 0; n < 30; n++) {
          await advance();
          const current = await state();
          sawNative ||= current.visuals.some(
            (shot: any) => shot.sprites?.length > 0,
          );
          if (
            current.bodies.every(
              (b: any) => b.hp < 1e6 && b.releaseTick !== undefined,
            )
          )
            break;
        }
        const impact = await state();
        expect(
          impact.bodies.every(
            (b: any) => b.hp < 1e6 && b.releaseTick !== undefined,
          ),
        ).toBe(true);
        expect(sawNative).toBe(true);
        if (card === "musketeer")
          await page
            .locator("#arena")
            .screenshot({ path: info.outputPath("pending-range-current.png") });
        traces.push({ version, card, started, shifted, impact });
      } else {
        await advance("#second");
        expect(
          (await state()).bodies.every(
            (b: any) =>
              b.hp === 1e6 &&
              (card === "sparky" || b.releaseTick === undefined),
          ),
        ).toBe(true);
        traces.push({ version, card, started, shifted, ended: await state() });
      }
    }
  }
  // The new reach is a bounded allowance, not a permanent attack range increase.
  await page.goto(
    "/tests/fixtures/combat.html?scene=pending-range&rules=38&offset=0.501",
  );
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#attack-card").selectOption("musketeer");
  await expect
    .poll(
      async () =>
        (await state()).bodies.every(
          (b: any) => b.card === "musketeer" && b.native,
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  await advance();
  await page.locator("#range-out").click();
  await advance();
  expect(
    (await state()).bodies.every((b: any) => b.remaining === undefined),
  ).toBe(true);
  expect(errors).toEqual([]);
  await info.attach("pending-range-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
});
