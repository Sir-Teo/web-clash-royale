import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";

test("nearby center scores and real Barrel priorities choose and damage the expected enemies on both teams", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-primary-score"))!,
    );
  const traces = [];
  for (const version of [28, 29]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=primary-score&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await expect
      .poll(
        async () => {
          const current = await state();
          return (
            current.bodies.length === 4 &&
            current.bodies.every((body: any) => body.native)
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const initial = await state();
    expect(initial.version).toBe(version);
    for (const body of initial.bodies) {
      expect(body.policy).toBe(version === 29);
      if (body.mode === "barrel")
        expect(body.candidates.map((candidate: any) => candidate.bias)).toEqual(
          version === 29 ? [0, 400, 1600] : [undefined, undefined, undefined],
        );
    }
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).tick).toBe(initial.tick + 3);
    const selected = await state();
    for (const body of selected.bodies) {
      const index =
        body.mode === "center"
          ? version === 29
            ? 0
            : 1
          : version === 29
            ? 2
            : 0;
      expect(body.target).toBe(body.candidates[index].id);
    }
    await page.locator("main").screenshot({
      path: info.outputPath(`primary-score-rules-${version}.png`),
    });
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () => (await state()).bodies.every((body: any) => body.native),
        { timeout: 30000 },
      )
      .toBe(true);
    expect((await state()).bodies).toEqual(selected.bodies);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).tick).toBe(initial.tick + 33);
    await page.locator("#second").click();
    await expect.poll(async () => (await state()).tick).toBe(initial.tick + 63);
    const landed = await state();
    for (const body of landed.bodies)
      for (const candidate of body.candidates)
        if (candidate.id === body.target)
          expect(candidate.hp).toBeLessThan(1e6);
        else expect(candidate.hp).toBe(1e6);
    traces.push({ version, initial, selected, landed });
  }
  await info.attach("primary-score-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
