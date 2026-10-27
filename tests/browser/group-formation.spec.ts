import { test, expect } from "@playwright/test";
import data from "../../src/game/group-formation-data.json" with { type: "json" };
import native from "../fixtures/native-formation-golden.json" with { type: "json" };
import mixed from "../fixtures/native-mixed-formation-golden.json" with { type: "json" };
import { expectedEffects } from "./native-assets";

test("physical group formations match native body order, previews, rebuilds and guests", async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-formation"))!,
    );
  await page.goto("/tests/fixtures/combat.html?scene=group-formation&rules=35");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const traces = [];
  for (const card of Object.keys(data.cards) as (keyof typeof data.cards)[]) {
    await page.locator("#reset").click();
    await page.locator("#death-card").selectOption(card);
    await page.locator("#preview-formation").click();
    const profile = data.cards[card];
    await expect
      .poll(
        async () =>
          (await state()).preview.filter((body: any) => body.native).length,
        { timeout: 30000 },
      )
      .toBe(profile.count);
    const initial = await state();
    expect(initial.rulesVersion).toBe(35);
    expect(initial.nativeGroups).toBe(true);
    await page.locator("#spawn").click();
    await expect
      .poll(async () => (await state()).bodies.length, { timeout: 30000 })
      .toBe(profile.count * 2);
    await expect
      .poll(
        async () => (await state()).bodies.every((body: any) => body.native),
        { timeout: 30000 },
      )
      .toBe(true);
    const placed = await state();
    for (const team of ["blue", "red"]) {
      const bodies = placed.bodies.filter((body: any) => body.team === team);
      const reference =
        card === "goblin-gang"
          ? mixed.cases
              .find(
                (row) =>
                  row.ownerIndex === (team === "red" ? 0 : 1) && row.lane === 0,
              )!
              .points.map((row) => [row.x, row.y])
          : native.cases.find(
              (row) =>
                row.count === profile.count &&
                row.radius === profile.radius &&
                row.angleShift === profile.angleShift &&
                row.flipY === (team === "red") &&
                row.lane === 0,
            )!.points;
      for (const [index, body] of bodies.entries()) {
        expect(body.x, `${card}:${team}:${index}`).toBeCloseTo(
          9 + reference[index][0] / 1000,
          10,
        );
        expect(body.y).toBeCloseTo(
          (team === "blue" ? 22 : 10) + reference[index][1] / 1000,
          10,
        );
        expect(body.visualX).toBeCloseTo(body.x, 6);
        expect(body.visualY).toBeCloseTo(body.y, 6);
        if (team === "blue") {
          expect(body.x).toBeCloseTo(initial.preview[index].x, 10);
          expect(body.y).toBeCloseTo(initial.preview[index].y, 10);
        }
      }
    }
    if (["archers", "guards", "bats", "goblin-gang"].includes(card))
      await page
        .locator("#arena")
        .screenshot({ path: info.outputPath(`physical-${card}.png`) });
    await page.locator("#rebuild").click();
    await expect
      .poll(
        async () => (await state()).bodies.every((body: any) => body.native),
        { timeout: 30000 },
      )
      .toBe(true);
    expect((await state()).bodies).toEqual(placed.bodies);
    let guest, empty;
    if (["archers", "guards", "bats", "goblin-gang"].includes(card)) {
      await page.locator("#guest-ruins").click();
      await expect.poll(async () => (await state()).groupGuestPhase).toBe(1);
      await expect
        .poll(
          async () =>
            (await state()).preview.filter((body: any) => body.native).length,
          { timeout: 30000 },
        )
        .toBe(profile.count);
      guest = await state();
      expect(guest.nativeGroups).toBe(true);
      expect(guest.armyMirrored).toBe(true);
      for (const [index, body] of guest.bodies.entries()) {
        expect(body.x).toBeCloseTo(guest.preview[index].x, 10);
        expect(body.y).toBeCloseTo(guest.preview[index].y, 10);
      }
      await page.locator("#guest-ruins").click();
      await expect.poll(async () => (await state()).groupGuestPhase).toBe(2);
      empty = await state();
      expect(empty.nativeGroups).toBe(false);
      expect(empty.nativeArmy).toBe(true);
      expect(empty.armyMirrored).toBe(true);
      expect(empty.bodies).toEqual([]);
      expect(empty.preview.map(({ x, y }: any) => ({ x, y }))).not.toEqual(
        guest.preview.map(({ x, y }: any) => ({ x, y })),
      );
    }
    traces.push({ card, initial, placed, guest, empty });
  }
  // The incoming host policy also drives an older wrapper's rendered preview.
  await page.goto("/tests/fixtures/combat.html?scene=group-formation&rules=34");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#death-card").selectOption("bats");
  await page.locator("#guest-ruins").click();
  await expect
    .poll(
      async () =>
        (await state()).preview.filter((body: any) => body.native).length,
      { timeout: 30000 },
    )
    .toBe(5);
  const older = await state();
  expect(older.rulesVersion).toBe(34);
  expect(older.nativeGroups).toBe(true);
  for (const [index, body] of older.bodies.entries()) {
    expect(body.x).toBeCloseTo(older.preview[index].x, 10);
    expect(body.y).toBeCloseTo(older.preview[index].y, 10);
  }
  await info.attach("physical-group-traces", {
    body: JSON.stringify({ traces, older }, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
