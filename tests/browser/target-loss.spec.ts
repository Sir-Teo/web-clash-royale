import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("source area and nonhoming attacks finish once after losing their victim", async ({
  page,
}, info) => {
  test.setTimeout(480000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-target-loss"))!,
    );
  const advance = async (button = "#step") => {
    const before = (await state()).time;
    await page.locator(button).click();
    await expect
      .poll(
        async () => {
          expect(errors).toEqual([]);
          return (await state()).time;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThan(before + (button === "#second" ? 0.999 : 0.099));
  };
  const traces = [];
  for (const version of [38, 39]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=target-loss&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of [
      "valkyrie",
      "bomber",
      "princess",
      "bowler",
      "executioner",
      "mortar",
      "bomb-tower",
      "musketeer",
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
      const continued = version === 39 && card !== "musketeer";
      await page.locator("#lose-target").click();
      await expect
        .poll(async () =>
          (await state()).bodies.every(
            (b: any) => !b.victimAlive && b.witnessHp === 1e6,
          ),
        )
        .toBe(true);
      await advance();
      const lost = await state();
      for (const b of lost.bodies) {
        expect(b.remaining !== undefined).toBe(continued);
        if (continued && card !== "valkyrie")
          expect(b.retained).toEqual(b.lostPoint);
      }
      if (continued) {
        await page.locator("#rebuild").click();
        await expect
          .poll(
            async () => (await state()).bodies.every((b: any) => b.native),
            { timeout: 30000 },
          )
          .toBe(true);
        expect((await state()).bodies).toEqual(lost.bodies);
        let sawNative = false;
        for (let n = 0; n < 45; n++) {
          await advance();
          const current = await state();
          for (const b of current.bodies)
            for (const p of b.shots) {
              expect(p.target).toBeNull();
              expect(p.homing).toBe(false);
              sawNative ||= p.native;
            }
          if (current.bodies.every((b: any) => b.witnessHp < 1e6)) break;
        }
        const impact = await state();
        expect(impact.bodies.every((b: any) => b.witnessHp < 1e6)).toBe(true);
        expect(
          impact.bodies.every(
            (b: any) => b.launches === (card === "valkyrie" ? 0 : 1),
          ),
        ).toBe(true);
        if (card === "valkyrie")
          expect(impact.bodies.every((b: any) => b.hits === 1)).toBe(true);
        else expect(sawNative).toBe(true);
        await advance("#second");
        const ended = await state();
        expect(
          ended.bodies.every(
            (b: any) =>
              b.launches === (card === "valkyrie" ? 0 : 1) &&
              b.remaining === undefined,
          ),
        ).toBe(true);
        if (card === "valkyrie" || card === "mortar")
          await page
            .locator("#arena")
            .screenshot({ path: info.outputPath(`target-loss-${card}.png`) });
        traces.push({ version, card, started, lost, impact, ended });
      } else {
        await advance("#second");
        const ended = await state();
        expect(
          ended.bodies.every(
            (b: any) =>
              b.witnessHp === 1e6 &&
              b.launches === 0 &&
              b.remaining === undefined,
          ),
        ).toBe(true);
        traces.push({ version, card, started, lost, ended });
      }
    }
  }
  expect(errors).toEqual([]);
  await info.attach("target-loss-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
});
