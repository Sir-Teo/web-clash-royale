import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";

const deck = ["barbarians", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("four native Barbarians deploy from the real desktop and phone hand", async ({
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
  await expect
    .poll(async () => (await state()).loadedAnimations, { timeout: 60000 })
    .toBe(20);
  await page.locator('#deck-preview [data-card-info="barbarians"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "5",
    "Barbarians",
    "Level 11",
  ]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const slot = before.hand.indexOf("barbarians");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await expect(page.locator("#hand-caption")).toContainText(
    "Barbarians · 5 elixir",
  );
  await page.screenshot({
    path: info.outputPath("barbarians-selected.png"),
    fullPage: true,
  });
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 22),
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(before.actions);
  await expect
    .poll(
      async () =>
        (await state()).units.filter(
          (e: any) => e.team === "blue" && e.card === "barbarians" && e.hp > 0,
        ).length,
    )
    .toBe(4);
  await expect
    .poll(async () => (await state()).intro.active, { timeout: 30000 })
    .toBe(false);
  await page.screenshot({
    path: info.outputPath("barbarians-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
