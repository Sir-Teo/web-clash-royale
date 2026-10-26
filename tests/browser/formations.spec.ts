import { test, expect } from "@playwright/test";
import data from "../../src/game/formation-data.json" with { type: "json" };
import native from "../fixtures/native-formation-golden.json" with { type: "json" };
import { expectedEffects } from "./native-assets";

test("native card formations align placement previews and both rendered teams", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html?scene=deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const state = async () =>
    JSON.parse(
      (await page.locator("#destruction").getAttribute("data-formation"))!,
    ) as {
      rulesVersion: number;
      visible: boolean;
      preview: { x: number; y: number }[];
      bodies: {
        team: string;
        x: number;
        y: number;
        visualX: number;
        visualY: number;
      }[];
    };
  const models = async () =>
    JSON.parse(
      (await page
        .locator("#destruction")
        .getAttribute("data-deployment-timing"))!,
    ) as { native: boolean }[];
  for (const id of [
    "archers",
    "three-musketeers",
    "barbarians",
    "bats",
    "minion-horde",
    "fire-spirits",
  ] as const) {
    await page.locator("#reset").click();
    await expect.poll(async () => (await state()).bodies.length).toBe(0);
    const definition = data.cards[id];
    const expected = native.cases.find(
      (c) =>
        c.count === definition.count &&
        c.radius === definition.radius &&
        c.angleShift === definition.angleShift &&
        !c.flipY &&
        c.lane === 0,
    )!.points;
    await page.locator("#death-card").selectOption(id);
    await page.locator("#preview-formation").click();
    await expect.poll(async () => (await state()).visible).toBe(true);
    const preview = (await state()).preview;
    expect(preview).toHaveLength(expected.length);
    preview.forEach((p, i) => {
      expect(p.x).toBeCloseTo(9 + expected[i][0] / 1000, 8);
      expect(p.y).toBeCloseTo(22 + expected[i][1] / 1000, 8);
    });
    await page.locator("#spawn").click();
    await expect
      .poll(async () => (await state()).bodies.length)
      .toBe(expected.length * 2);
    await expect
      .poll(async () => (await models()).every((e) => e.native))
      .toBe(true);
    const placed = await state();
    expect(placed.rulesVersion).toBe(21);
    expect(placed.visible).toBe(false);
    for (const team of ["blue", "red"]) {
      const bodies = placed.bodies.filter((e) => e.team === team);
      const rotation = team === "blue" ? 1 : -1;
      bodies.forEach((body, i) => {
        expect(body.x).toBeCloseTo(9 + (rotation * expected[i][0]) / 1000, 8);
        expect(body.y).toBeCloseTo(
          (team === "blue" ? 22 : 10) + (rotation * expected[i][1]) / 1000,
          8,
        );
        expect(body.visualX).toBeCloseTo(body.x, 8);
        expect(body.visualY).toBeCloseTo(body.y, 8);
        if (team === "blue") {
          expect(body.x).toBeCloseTo(preview[i].x, 8);
          expect(body.y).toBeCloseTo(preview[i].y, 8);
        }
      });
    }
    await page.locator("#second").click();
    await page.locator("#step").click();
    await expect
      .poll(async () => (await models()).every((e) => e.native))
      .toBe(true);
    if (id === "three-musketeers" || id === "bats")
      await page.screenshot({
        path: info.outputPath(`${id}-native-formation.png`),
        fullPage: true,
      });
  }
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});
