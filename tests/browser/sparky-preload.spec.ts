import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
test("Sparky preloads in real time before native shots under both teams and modifiers", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-preload"))!,
    );
  const results = [];
  const advance = async (second = false) => {
    const before = (await state()).tick;
    await page.locator(second ? "#second" : "#step").click();
    await expect
      .poll(async () => (await state()).tick, { timeout: 15000 })
      .toBe(before + (second ? 30 : 3));
  };
  for (const version of [36, 37]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=sparky-preload&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect
      .poll(
        async () =>
          (await state()).bodies.filter((body: any) => body.native).length,
        { timeout: 30000 },
      )
      .toBe(8);
    for (let i = 0; i < 3; i++) await advance(true);
    const passive = await state();
    expect(passive.version).toBe(version);
    for (const body of passive.bodies) {
      const rate =
        body.mode === "rage"
          ? 67 / 50
          : body.mode === "slow"
            ? 32 / 50
            : body.mode === "both"
              ? 43 / 50
              : 1;
      expect(body.policy).toBe(version === 37);
      expect(body.charge).toBeCloseTo(3 * (version === 37 ? 1 : rate), 10);
      expect(body.cooldown).toBeCloseTo(
        4.5 - 3 * (version === 37 ? 1 : rate),
        10,
      );
      expect(body.releaseTick).toBeUndefined();
      if (version === 37) expect(body.cues).toEqual(["load-1", "load-2"]);
    }
    await page
      .locator("#arena")
      .screenshot({ path: info.outputPath(`sparky-passive-${version}.png`) });
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () =>
          (await state()).bodies.filter((body: any) => body.native).length,
        { timeout: 30000 },
      )
      .toBe(8);
    expect((await state()).bodies).toEqual(passive.bodies);
    await page.locator("#preload-in").click();
    await expect
      .poll(
        async () =>
          (await state()).bodies.filter((body: any) => body.targetHp === 1e6)
            .length,
      )
      .toBe(8);
    let sawNativeShot = false;
    for (let i = 0; i < 65; i++) {
      await advance();
      const current = await state();
      sawNativeShot ||= current.visuals.length > 0;
      if (
        current.bodies.every(
          (body: any) => body.releaseTick !== undefined && body.targetHp < 1e6,
        )
      )
        break;
    }
    const released = await state();
    expect(
      released.bodies.every(
        (body: any) => body.releaseTick !== undefined && body.targetHp < 1e6,
      ),
    ).toBe(true);
    expect(sawNativeShot).toBe(true);
    if (version === 37) {
      const old = results[0].released;
      for (const body of released.bodies) {
        const previous = old.bodies.find(
          (b: any) => b.mode === body.mode && b.team === body.team,
        );
        if (body.mode === "rage")
          expect(body.releaseTick - previous.releaseTick).toBeGreaterThan(15);
        else if (body.mode === "slow")
          expect(previous.releaseTick - body.releaseTick).toBeGreaterThan(30);
        else if (body.mode === "both")
          expect(previous.releaseTick - body.releaseTick).toBeGreaterThan(8);
        else expect(body.releaseTick).toBe(previous.releaseTick);
      }
    }
    await page
      .locator("#arena")
      .screenshot({ path: info.outputPath(`sparky-released-${version}.png`) });
    results.push({ version, passive, released });
  }
  await info.attach("sparky-preload-traces", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
