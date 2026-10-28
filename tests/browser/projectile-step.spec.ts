import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectedEffects } from "./native-assets";

test("new shots render at their muzzle for one tick and keep historical timing", async ({
  page,
}, info) => {
  test.setTimeout(480000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-muzzle"))!,
    );
  const tick = async () => {
    const before = (await state()).tick;
    await page.locator("#tick").click();
    await expect.poll(async () => (await state()).tick).toBe(before + 1);
  };
  const traces = [];
  for (const version of [42, 43]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=projectile-muzzle&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of ["musketeer", "cannon", "princess"]) {
      await page.locator("#attack-card").selectOption(card);
      await expect
        .poll(async () => {
          const s = await state();
          return (
            s.tick === 0 &&
            s.bodies.every((b: any) => b.card === card && b.native)
          );
        })
        .toBe(true);
      for (
        let n = 0;
        n < 80 && !(await state()).bodies.every((b: any) => b.release);
        n++
      )
        await tick();
      const launched = await state();
      expect(launched.version).toBe(version);
      for (const body of launched.bodies) {
        expect(body.release.tick).toBe(launched.tick);
        expect(body.stepPolicy).toBe(version === 43);
        expect(body.shots).toHaveLength(card === "princess" ? 5 : 1);
        expect(body.victimHp).toBe(1e6);
        for (const p of body.shots) {
          expect(p.native).toBe(true);
          expect(p.elapsed).toBe(version === 43 ? 0 : 1 / 30);
          if (version === 43) {
            expect(p.flight).toEqual({ x: p.x, y: p.y });
            expect(p.remaining).toBe(p.duration);
          }
        }
      }
      await page.locator("#rebuild").click();
      await expect
        .poll(async () => (await state()).bodies)
        .toEqual(launched.bodies);
      if (version === 43 && card === "princess")
        await page.screenshot({
          path: info.outputPath("newborn-princess-shots.png"),
          timeout: 15000,
        });
      await tick();
      const moved = await state();
      for (const body of moved.bodies) {
        const previous = launched.bodies.find((b: any) => b.id === body.id);
        for (const p of body.shots) {
          const old = previous.shots.find((q: any) => q.id === p.id);
          expect(p.elapsed).toBeCloseTo(old.elapsed + 1 / 30, 12);
          expect(p.flight).not.toEqual(old.flight);
        }
      }
      for (
        let n = 0;
        n < 30 && !(await state()).bodies.every((b: any) => b.victimHp < 1e6);
        n++
      ) {
        const before = (await state()).tick;
        await page.locator("#step").click();
        await expect.poll(async () => (await state()).tick).toBe(before + 3);
      }
      const impact = await state();
      expect(impact.bodies.every((b: any) => b.victimHp < 1e6)).toBe(true);
      traces.push({ version, card, launched, moved, impact });
    }
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("projectile-step-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("projectile-step-traces", {
    path,
    contentType: "application/json",
  });
});
