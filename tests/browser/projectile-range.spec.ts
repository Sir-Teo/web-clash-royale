import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { writeFile } from "node:fs/promises";
test("Bowler and Executioner render source range extensions with legacy compatibility", async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-muzzle"))!,
    );
  const advance = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect
      .poll(
        async () => {
          expect(errors).toEqual([]);
          return (await state()).time;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThan(before + 0.099);
  };
  const traces = [];
  for (const version of [41, 42]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=projectile-muzzle&rules=${version}&rangeDistance=near`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of ["bowler", "executioner"]) {
      await page.locator("#attack-card").selectOption(card);
      await expect
        .poll(
          async () => {
            const s = await state();
            return (
              s.time === 0 &&
              s.bodies.length === 2 &&
              s.bodies.every((b: any) => b.card === card && b.native)
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      for (let n = 0; n < 30; n++) {
        await advance();
        if ((await state()).bodies.every((b: any) => b.release)) break;
      }
      const launched = await state();
      expect(launched.version).toBe(version);
      for (const body of launched.bodies) {
        expect(body.rangePolicy).toBe(version === 42);
        expect(body.release.shots).toHaveLength(1);
        expect(body.shots.some((p: any) => p.native)).toBe(true);
        const p = body.release.shots[0],
          a = body.release.actor,
          target = body.release.goal;
        if (version === 42) {
          const x = Math.round(a.x * 1000),
            y = Math.round(a.y * 1000);
          const dx = Math.round(target.x * 1000) - x,
            dy = Math.round(target.y * 1000) - y;
          const d = Math.floor(Math.sqrt(dx * dx + dy * dy)),
            range = card === "bowler" ? 6000 : 6500;
          expect(p.tx).toBe((x + Math.trunc((dx * range) / d)) / 1000);
          expect(p.ty).toBe((y + Math.trunc((dy * range) / d)) / 1000);
        } else {
          const dx = target.x - a.x,
            dy = target.y - a.y,
            d = Math.hypot(dx, dy);
          const offset = card === "bowler" ? 1000 : 600;
          const ax = Math.round(a.x * 1000),
            ay = Math.round(a.y * 1000);
          const sx = Math.round(target.x * 1000) - ax,
            sy = Math.round(target.y * 1000) - ay;
          const sd = Math.floor(Math.sqrt(sx * sx + sy * sy));
          const start = {
            x: (ax + Math.trunc((sx * offset) / sd)) / 1000,
            y: (ay + Math.trunc((sy * offset) / sd)) / 1000,
          };
          const base = card === "bowler" ? start : a;
          const range =
            card === "bowler" ? 6 : Math.max(4.5, Math.min(6.5, d + 2));
          expect(p.tx).toBeCloseTo(
            Math.max(0.5, Math.min(17.5, base.x + (dx / d) * range)),
            12,
          );
          expect(p.ty).toBeCloseTo(
            Math.max(0.6, Math.min(31.4, base.y + (dy / d) * range)),
            12,
          );
        }
        expect(p.fromHeight).toBeCloseTo(card === "bowler" ? 1.2 : 3, 12);
      }
      await page.locator("#rebuild").click();
      await expect
        .poll(
          async () =>
            (await state()).bodies.every(
              (b: any) => b.native && b.shots.some((p: any) => p.native),
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      expect((await state()).bodies).toEqual(launched.bodies);
      if (version === 42) {
        await advance();
        await advance();
        await page
          .locator("#arena")
          .screenshot({ path: info.outputPath(`source-range-${card}.png`) });
      }
      for (let n = 0; n < 40; n++) {
        const s = await state();
        if (
          s.bodies.every((b: any) =>
            b.release.shots.every(
              (p: any) => !b.shots.some((q: any) => q.id === p.id),
            ),
          )
        )
          break;
        await advance();
      }
      const impact = await state();
      for (const body of impact.bodies) {
        const first = body.release.shots[0];
        expect(body.shots.some((p: any) => p.id === first.id)).toBe(false);
        expect(body.victimHp).toBe(
          1e6 - first.damage * (card === "executioner" ? 2 : 1),
        );
      }
      traces.push({ version, card, launched, impact });
    }
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("projectile-range-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("projectile-range-traces", {
    path,
    contentType: "application/json",
  });
});
