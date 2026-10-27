import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { writeFile } from "node:fs/promises";

test("source muzzles place actual projectiles on both teams and survive rebuilding", async ({
  page,
}, info) => {
  test.setTimeout(480000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const fields: Record<string, { radius: number; z: number; y: number }> = {
    musketeer: { radius: 450, z: 450, y: 0 },
    cannon: { radius: 1000, z: 2500, y: 0 },
    princess: { radius: 450, z: 450, y: 0 },
    "king-tower": { radius: 750, z: 3500, y: 400 },
    "baby-dragon": { radius: 500, z: 1900, y: 0 },
  };
  const traces = [];
  for (const version of [39, 40]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=projectile-muzzle&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const [card, f] of Object.entries(fields)) {
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
      const initial = await state();
      expect(initial.version).toBe(version);
      for (let n = 0; n < 30; n++) {
        await advance();
        if ((await state()).bodies.every((b: any) => b.release)) break;
      }
      const launched = await state();
      for (const b of launched.bodies) {
        expect(b.policy).toBe(version === 40);
        expect(b.release).toBeDefined();
        expect(b.shots.some((p: any) => p.native)).toBe(true);
        const release = b.release;
        expect(release.shots).toHaveLength(card === "princess" ? 5 : 1);
        for (const p of release.shots) {
          if (version === 40) {
            const x = Math.round(release.actor.x * 1000),
              y = Math.round(release.actor.y * 1000);
            const dx = Math.round(p.tx * 1000) - x,
              dy = Math.round(p.ty * 1000) - y;
            const d = Math.floor(Math.sqrt(dx * dx + dy * dy));
            expect(p.x).toBe(
              (x + (d ? Math.trunc((dx * f.radius) / d) : dx)) / 1000,
            );
            expect(p.y).toBe(
              (y +
                (d ? Math.trunc((dy * f.radius) / d) : dy) +
                (b.team === "red" ? f.y : -f.y)) /
                1000,
            );
            expect(p.fromHeight).toBeCloseTo(release.actor.z + f.z / 1000, 12);
          } else {
            expect(p.x).toBe(release.actor.x);
            expect(p.y).toBe(release.actor.y);
          }
        }
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
      if (version === 40 && (card === "cannon" || card === "king-tower"))
        await page
          .locator("#arena")
          .screenshot({ path: info.outputPath(`muzzle-${card}.png`) });
      for (let n = 0; n < 30; n++) {
        await advance();
        if ((await state()).bodies.every((b: any) => b.victimHp < 1e6)) break;
      }
      const impact = await state();
      expect(impact.bodies.every((b: any) => b.victimHp < 1e6)).toBe(true);
      traces.push({ version, card, initial, launched, impact });
    }
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("projectile-muzzle-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("projectile-muzzle-traces", {
    path,
    contentType: "application/json",
  });
});

test("Executioner retains its absolute native axe height after source muzzle placement", async ({
  page,
}, info) => {
  test.setTimeout(180000);
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
  for (const version of [39, 40]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=projectile-muzzle&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await page.locator("#attack-card").selectOption("executioner");
    await expect
      .poll(
        async () =>
          (await state()).bodies.every(
            (b: any) => b.card === "executioner" && b.native,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    for (let n = 0; n < 20; n++) {
      await advance();
      if ((await state()).bodies.every((b: any) => b.release)) break;
    }
    const shot = await state();
    for (const b of shot.bodies) {
      expect(b.policy).toBe(version === 40);
      expect(b.release.shots).toHaveLength(1);
      expect(b.release.shots[0].fromHeight).toBe(3);
      expect(b.shots.some((p: any) => p.native && p.height === 3)).toBe(true);
    }
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () =>
          (await state()).bodies.every(
            (b: any) =>
              b.native && b.shots.some((p: any) => p.native && p.height === 3),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    expect((await state()).bodies).toEqual(shot.bodies);
    if (version === 40)
      await page
        .locator("#arena")
        .screenshot({ path: info.outputPath("executioner-native-height.png") });
    for (let n = 0; n < 20; n++) {
      await advance();
      if ((await state()).bodies.every((b: any) => b.victimHp < 1e6)) break;
    }
    const impact = await state();
    expect(impact.bodies.every((b: any) => b.victimHp < 1e6)).toBe(true);
    traces.push({ version, shot, impact });
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("executioner-height-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("executioner-height-traces", {
    path,
    contentType: "application/json",
  });
});
