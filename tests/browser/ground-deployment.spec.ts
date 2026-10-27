import { test, expect } from "@playwright/test";
import { expectedEffects } from "./native-assets";
test("ground deployment bounds match both teams, previews, Crown loss and host changes", async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-formation"))!,
    );
  const baseline = new Map<string, any>();
  const traces = [];
  for (const version of [35, 36]) {
    await page.goto(
      `/tests/fixtures/combat.html?scene=ground-deployment&rules=${version}`,
    );
    await expect(page.locator("#status")).toContainText(
      `${expectedEffects} effects`,
      { timeout: 60000 },
    );
    for (const card of [
      "guards",
      "goblins",
      "skeleton-army",
      "minions",
      "bats",
    ]) {
      await page.locator("#reset").click();
      await page.locator("#death-card").selectOption(card);
      await page.locator("#preview-formation").click();
      const count = card === "skeleton-army" ? 15 : card === "bats" ? 5 : 3;
      await expect
        .poll(
          async () =>
            (await state()).preview.filter((p: any) => p.native).length,
          { timeout: 30000 },
        )
        .toBe(count);
      const preview = await state();
      expect(preview.rulesVersion).toBe(version);
      expect(preview.nativeGround).toBe(version === 36);
      await page.locator("#spawn").click();
      await expect
        .poll(async () => (await state()).bodies.length, { timeout: 30000 })
        .toBe(count * 2);
      await expect
        .poll(async () => (await state()).bodies.every((b: any) => b.native), {
          timeout: 30000,
        })
        .toBe(true);
      const placed = await state();
      for (const body of placed.bodies) {
        expect(body.visualX).toBeCloseTo(body.x, 6);
        expect(body.visualY).toBeCloseTo(body.y, 6);
      }
      for (const [index, body] of placed.bodies
        .filter((b: any) => b.team === "blue")
        .entries()) {
        expect(body.x).toBeCloseTo(preview.preview[index].x, 10);
        expect(body.y).toBeCloseTo(preview.preview[index].y, 10);
      }
      if (version === 35) baseline.set(card, placed);
      else {
        const old = baseline.get(card);
        const air = ["minions", "bats"].includes(card);
        for (const [index, body] of placed.bodies.entries()) {
          const previous = old.bodies[index];
          expect(body.x).toBeCloseTo(previous.x, 10);
          expect(body.y).toBeCloseTo(
            air
              ? previous.y
              : Math.max(
                  body.team === "blue" ? 17.499 : 0,
                  Math.min(body.team === "blue" ? 31 : 14.5, previous.y),
                ),
            10,
          );
        }
        if (!air)
          expect(placed.bodies.map((b: any) => b.y)).not.toEqual(
            old.bodies.map((b: any) => b.y),
          );
      }
      if (card === "guards" || card === "skeleton-army")
        await page
          .locator("#arena")
          .screenshot({
            path: info.outputPath(`ground-${version}-${card}.png`),
          });
      await page.locator("#rebuild").click();
      await expect
        .poll(async () => (await state()).bodies.every((b: any) => b.native), {
          timeout: 30000,
        })
        .toBe(true);
      expect((await state()).bodies).toEqual(placed.bodies);
      traces.push({ version, card, preview, placed });
    }
  }
  await page.locator("#reset").click();
  await page.locator("#death-card").selectOption("guards");
  await page.locator("#preview-formation").click();
  await expect
    .poll(async () => Math.min(...(await state()).preview.map((p: any) => p.y)))
    .toBeCloseTo(17.499, 10);
  await page.locator("#open-deployment").click();
  await expect
    .poll(async () => Math.min(...(await state()).preview.map((p: any) => p.y)))
    .toBeLessThan(17.499);
  const opened = await state();
  await page.goto(
    "/tests/fixtures/combat.html?scene=ground-deployment&rules=35",
  );
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  await page.locator("#death-card").selectOption("guards");
  await page.locator("#guest-ruins").click();
  await expect.poll(async () => (await state()).groupGuestPhase).toBe(1);
  await expect
    .poll(
      async () => (await state()).preview.filter((p: any) => p.native).length,
      { timeout: 30000 },
    )
    .toBe(3);
  const guest = await state();
  expect(guest.rulesVersion).toBe(35);
  expect(guest.nativeGround).toBe(true);
  expect(guest.armyMirrored).toBe(true);
  for (const [index, body] of guest.bodies.entries()) {
    expect(body.x).toBeCloseTo(guest.preview[index].x, 10);
    expect(body.y).toBeCloseTo(guest.preview[index].y, 10);
  }
  expect(Math.min(...guest.preview.map((p: any) => p.y))).toBeCloseTo(17.5, 10);
  await page.locator("#guest-ruins").click();
  await expect.poll(async () => (await state()).groupGuestPhase).toBe(2);
  const older = await state();
  expect(older.nativeGround).toBe(false);
  expect(older.bodies).toEqual([]);
  expect(Math.min(...older.preview.map((p: any) => p.y))).toBeLessThan(17.5);
  await page.locator("#guest-ruins").click();
  await expect.poll(async () => (await state()).groupGuestPhase).toBe(3);
  const empty = await state();
  expect(empty.nativeGround).toBe(true);
  expect(empty.bodies).toEqual([]);
  expect(empty.preview.map((p: any) => ({ x: p.x, y: p.y }))).toEqual(
    older.preview.map((p: any) => ({ x: p.x, y: p.y })),
  );
  await info.attach("ground-deployment-traces", {
    body: JSON.stringify({ traces, opened, guest, older, empty }, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
