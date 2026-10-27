import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("native attack clocks release real Mortar projectiles at the predicted steps on both teams", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-attack-clock"))!,
    );
  const traces = [];
  for (const version of [27, 28]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=attack-clock&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect
      .poll(async () => {
        const current = await state();
        return (
          current.bodies.length === 8 &&
          current.bodies.every((body: any) => body.native)
        );
      })
      .toBe(true);
    const initial = await state();
    expect(initial.version).toBe(version);
    expect(initial.tick).toBe(0);
    for (const body of initial.bodies) expect(body.policy).toBe(version === 28);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).tick).toBe(30);
    const active = await state();
    for (const body of active.bodies) {
      const rate =
        version === 28
          ? { normal: 1, rage: 1.34, slow: 0.64, both: 0.86 }[
              body.mode as "normal"
            ]
          : { normal: 1, rage: 1.35, slow: 0.65, both: 1.35 * 0.65 }[
              body.mode as "normal"
            ];
      expect(body.cooldown).toBeCloseTo(100 - rate, 9);
      if (body.mode === "slow" || body.mode === "both")
        expect(body.remaining).toBeCloseTo(0.9 - rate, 9);
    }
    await page
      .locator("main")
      .screenshot({
        path: info.outputPath(`attack-clock-rules-${version}.png`),
      });
    await page.locator("#rebuild").click();
    await expect
      .poll(async () =>
        (await state()).bodies.every((body: any) => body.native),
      )
      .toBe(true);
    expect((await state()).bodies).toEqual(active.bodies);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).tick).toBe(60);
    const fired = await state();
    for (const body of fired.bodies) {
      const expected =
        version === 28
          ? { normal: 27, rage: 21, slow: 43, both: 32 }[body.mode as "normal"]
          : { normal: 27, rage: 20, slow: 42, both: 31 }[body.mode as "normal"];
      expect(body.releaseTick).toBe(expected);
      expect(body.remaining).toBeUndefined();
    }
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).tick).toBe(90);
    const landed = await state();
    for (const body of landed.bodies)
      expect(body.targetHp).toBe(1e6 - body.damage);
    traces.push({ version, initial, active, fired, landed });
  }
  await info.attach("attack-clock-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
