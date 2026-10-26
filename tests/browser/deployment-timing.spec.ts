import { test, expect } from "@playwright/test";
import { CARD_MAP } from "../../src/game/cards";
import { expectedEffects } from "./native-assets";

test("native troop models finish combat deployment after one second on both sides", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/combat.html?scene=deployment");
  await expect(page.locator("#status")).toContainText(
    `${expectedEffects} effects`,
    { timeout: 60000 },
  );
  const units = async () =>
    JSON.parse(
      (await page
        .locator("#destruction")
        .getAttribute("data-deployment-timing"))!,
    ) as {
      card: string;
      team: string;
      age: number;
      deploy: number;
      native: boolean;
    }[];
  for (const card of [
    "bats",
    "elite-barbarians",
    "guards",
    "ice-spirit",
    "fire-spirits",
  ] as const) {
    await page.locator("#reset").click();
    await expect.poll(async () => (await units()).length).toBe(0);
    await page.locator("#death-card").selectOption(card);
    await page.locator("#spawn").click();
    await expect
      .poll(async () => (await units()).length)
      .toBe(CARD_MAP[card].count * 2);
    await expect
      .poll(async () => (await units()).every((e) => e.native))
      .toBe(true);
    expect(
      (await units()).every(
        (e) => e.card === card && e.deploy === 1 && e.age === 0,
      ),
    ).toBe(true);
    for (const team of ["blue", "red"])
      expect((await units()).filter((e) => e.team === team)).toHaveLength(
        CARD_MAP[card].count,
      );
    await page.locator("#second").click();
    await page.locator("#step").click();
    await page.locator("#step").click();
    await expect
      .poll(async () =>
        (await units()).every((e) => e.age >= 1.19 && e.deploy <= 0),
      )
      .toBe(true);
    expect((await units()).every((e) => e.native)).toBe(true);
    if (card === "guards")
      await page.screenshot({
        path: info.outputPath("guards-ready-after-one-second.png"),
        fullPage: true,
      });
  }
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});
