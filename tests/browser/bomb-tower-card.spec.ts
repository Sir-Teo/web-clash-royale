import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedAnimations, expectedBuildings } from "./native-assets";

const deck = ["bomb-tower", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("Bomb Tower layers its native Bomber above the building on desktop and phone", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((chosen) => {
    localStorage.setItem("browser-royale.profile.v1", JSON.stringify({
      version: 1, sound: false, seenTutorial: true, deck: chosen,
    }));
  }, deck);
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect.poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await expect.poll(async () => (await state())?.loadedBuildings, { timeout: 60000 })
    .toBe(expectedBuildings);
  await expect.poll(async () => (await state())?.loadedAnimations, { timeout: 60000 })
    .toBe(expectedAnimations);
  await page.locator('#deck-preview [data-card-info="bomb-tower"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["5", "Bomb Tower", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  await expect.poll(async () => (await state())?.elixir, { timeout: 30000 })
    .toBeGreaterThanOrEqual(5);
  const before = await state();
  const slot = before.hand.indexOf("bomb-tower");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() => (window as any).__arena.project(9, 19));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).nativeBombTowerBombers, { timeout: 30000 })
    .toBe(1);
  await expect.poll(async () => (await state()).intro.active, { timeout: 30000 })
    .toBe(false);
  await expect.poll(async () => (await state()).time, { timeout: 30000 })
    .toBeGreaterThan(2);
  await page.screenshot({ path: info.outputPath("bomb-tower-battle.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});
