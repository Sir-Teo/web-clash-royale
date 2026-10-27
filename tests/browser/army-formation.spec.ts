import { test, expect } from "@playwright/test";
import native from "../fixtures/native-formation-golden.json" with { type: "json" };
import { expectedEffects } from "./native-assets";

test("Skeleton Army source formation, preview, rebuild and guest host-policy changes", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-formation"))!,
    );
  const traces = [];
  for (const version of [33, 34]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=army-formation&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    await page.locator("#preview-formation").click();
    await expect
      .poll(
        async () =>
          (await state()).preview.filter((body: any) => body.native).length,
        { timeout: 30000 },
      )
      .toBe(15);
    const initial = await state();
    expect(initial.rulesVersion).toBe(version);
    expect(initial.nativeArmy).toBe(version === 34);
    expect(initial.preview).toHaveLength(15);
    if (version === 34) {
      const expected = native.cases.find(
        (row) => row.count === 15 && !row.flipY && row.lane === 0,
      )!;
      for (const [index, point] of initial.preview.entries()) {
        expect(point.x).toBeCloseTo(9 + expected.points[index][0] / 1000, 10);
        expect(point.y).toBeCloseTo(22 + expected.points[index][1] / 1000, 10);
      }
    }
    await page
      .locator("#arena")
      .screenshot({
        path: info.outputPath(`army-preview-rules-${version}.png`),
      });
    await page.locator("#spawn").click();
    await expect
      .poll(async () => (await state()).bodies.length, { timeout: 30000 })
      .toBe(30);
    await expect
      .poll(
        async () =>
          (await state()).bodies.every((body: any) =>
            Number.isFinite(body.visualX),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const placed = await state();
    expect(placed.visible).toBe(false);
    for (const team of ["blue", "red"]) {
      const bodies = placed.bodies.filter((body: any) => body.team === team);
      for (const [index, body] of bodies.entries()) {
        if (team === "blue") {
          expect(body.x).toBeCloseTo(initial.preview[index].x, 10);
          expect(body.y).toBeCloseTo(initial.preview[index].y, 10);
        }
        if (version === 34) {
          const expected = native.cases.find(
            (row) =>
              row.count === 15 &&
              row.flipY === (team === "red") &&
              row.lane === 0,
          )!;
          expect(body.x).toBeCloseTo(9 + expected.points[index][0] / 1000, 10);
          expect(body.y).toBeCloseTo(
            (team === "blue" ? 22 : 10) + expected.points[index][1] / 1000,
            10,
          );
        }
        expect(body.visualX).toBeCloseTo(body.x, 6);
        expect(body.visualY).toBeCloseTo(body.y, 6);
      }
    }
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () =>
          (await state()).bodies.every((body: any) =>
            Number.isFinite(body.visualX),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    expect((await state()).bodies).toEqual(placed.bodies);
    await page.locator("#guest-ruins").click();
    await expect.poll(async () => (await state()).armyGuestPhase).toBe(1);
    await expect
      .poll(
        async () =>
          (await state()).preview.filter((body: any) => body.native).length,
        { timeout: 30000 },
      )
      .toBe(15);
    const guest = await state();
    expect(guest.nativeArmy).toBe(version === 34);
    expect(guest.armyMirrored).toBe(version === 34);
    expect(guest.bodies).toHaveLength(15);
    if (version === 34)
      for (const [index, body] of guest.bodies.entries()) {
        expect(body.x).toBeCloseTo(guest.preview[index].x, 10);
        expect(body.y).toBeCloseTo(guest.preview[index].y, 10);
      }
    await page.locator("#guest-ruins").click();
    await expect.poll(async () => (await state()).armyGuestPhase).toBe(2);
    const empty = await state();
    expect(empty.bodies).toEqual([]);
    expect(empty.nativeArmy).toBe(version !== 34);
    expect(empty.armyMirrored).toBe(version !== 34);
    expect(empty.preview).toHaveLength(15);
    expect(empty.preview.map(({ x, y }: any) => ({ x, y }))).not.toEqual(
      initial.preview.map(({ x, y }: any) => ({ x, y })),
    );
    traces.push({ version, initial, placed, guest, empty });
  }
  await info.attach("army-formation-traces", {
    body: JSON.stringify(traces, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
