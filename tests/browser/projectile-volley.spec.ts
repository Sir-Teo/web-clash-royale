import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
import { writeFile } from "node:fs/promises";
test("Princess renders the native circular volley with old replay compatibility", async ({
  page,
}, info) => {
  test.setTimeout(240000);
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
  const traces = [];
  for (const version of [40, 41]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=projectile-muzzle&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await page.locator("#attack-card").selectOption("princess");
    await expect
      .poll(
        async () => {
          const s = await state();
          return (
            s.time === 0 &&
            s.bodies.length === 2 &&
            s.bodies.every((b: any) => b.card === "princess" && b.native)
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
      expect(body.volley).toBe(version === 41);
      expect(body.release.shots).toHaveLength(5);
      expect(body.shots.filter((p: any) => p.native).length).toBeGreaterThan(0);
      const [center, ...decorative] = body.release.shots;
      expect(center.decorative).toBe(false);
      for (const [index, shot] of decorative.entries()) {
        expect(shot.decorative).toBe(true);
        if (version === 41) {
          const dx = Math.round((shot.tx - center.tx) * 1000);
          const dy = Math.round((shot.ty - center.ty) * 1000);
          const angle = ((index + 1) * 72 * Math.PI) / 180;
          const cx = Math.round(Math.cos(angle) * 1024),
            cy = Math.round(Math.sin(angle) * 1024);
          // Signed truncation allows several radii to share a component;
          // require one bounded integer radius to reproduce both exactly.
          expect(
            Array.from({ length: 1875 }, (_, i) => 625 + i).some(
              (r) =>
                Math.trunc((r * cx) / 1024) === dx &&
                Math.trunc((r * cy) / 1024) === dy,
            ),
          ).toBe(true);
        } else {
          const offset = [-2, -1, 1, 2][index];
          expect(shot.tx).toBe(
            Math.max(0.5, Math.min(17.5, center.tx + offset * 0.38)),
          );
          expect(shot.ty).toBe(
            Math.max(0.6, Math.min(31.4, center.ty + Math.abs(offset) * 0.14)),
          );
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
    if (version === 41)
      await page
        .locator("#arena")
        .screenshot({ path: info.outputPath("princess-circular-volley.png") });
    for (let n = 0; n < 35; n++) {
      await advance();
      if ((await state()).bodies.every((b: any) => b.victimHp < 1e6)) break;
    }
    const impact = await state();
    expect(impact.bodies.every((b: any) => b.victimHp < 1e6)).toBe(true);
    traces.push({ version, launched, impact });
  }
  expect(errors).toEqual([]);
  const path = info.outputPath("projectile-volley-traces.json");
  await writeFile(path, JSON.stringify(traces, null, 2));
  await info.attach("projectile-volley-traces", {
    path,
    contentType: "application/json",
  });
});
