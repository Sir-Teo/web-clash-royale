import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";

const deck = ["minion-horde", "three-musketeers", ...STARTER_DECK.slice(0, 6)];
// The archived shuffle puts both new cards in the opening hand at this seed.
const seed = 48;

test("Minion Horde and Three Musketeers deploy from the real desktop and phone hand", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((deck) => {
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({ version: 1, sound: false, seenTutorial: true, deck }),
    );
  }, deck);
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect
    .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  for (const [id, cost, name] of [
    ["minion-horde", "5", "Minion Horde"],
    ["three-musketeers", "9", "Three Musketeers"],
  ]) {
    await page.locator(`#deck-preview [data-card-info="${id}"]`).click();
    await expect(page.locator(".detail-art.native-card-ready text")).toHaveText(
      [cost, name, "Level 11"],
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="double"]').click();
  await page.evaluate((seed) => {
    Math.random = () => (seed - 1) / 2147483646;
  }, seed);
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const opening = await state();
  expect(opening.hand).toContain("three-musketeers");
  expect(opening.hand).toContain("minion-horde");
  const tap = async (x: number, y: number) => {
    const point = await page.evaluate(
      ({ x, y }) => (window as any).__arena.project(x, y),
      { x, y },
    );
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  await expect
    .poll(async () => (await state()).elixir, { timeout: 45000 })
    .toBeGreaterThanOrEqual(9);
  const musketeerSlot = (await state()).hand.indexOf("three-musketeers");
  const musketeers = page.locator(`#hand [data-slot="${musketeerSlot}"]`);
  await expect(musketeers.locator(".native-card-art text")).toContainText("9");
  await musketeers.click();
  await page.screenshot({
    path: info.outputPath("three-musketeers-selected.png"),
    fullPage: true,
  });
  await tap(9, 22);
  await expect
    .poll(
      async () =>
        (await state()).units.filter(
          (e: any) => e.team === "blue" && e.card === "musketeer" && e.hp > 0,
        ).length,
    )
    .toBe(3);
  await expect
    .poll(async () => (await state()).elixir, { timeout: 45000 })
    .toBeGreaterThanOrEqual(5);
  const hordeSlot = (await state()).hand.indexOf("minion-horde");
  const horde = page.locator(`#hand [data-slot="${hordeSlot}"]`);
  await expect(horde.locator(".native-card-art text")).toContainText("5");
  await horde.click();
  await tap(4, 22);
  await expect
    .poll(
      async () =>
        (await state()).units.filter(
          (e: any) => e.team === "blue" && e.card === "minions" && e.hp > 0,
        ).length,
    )
    .toBe(6);
  await page.screenshot({
    path: info.outputPath("swarm-cards-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
