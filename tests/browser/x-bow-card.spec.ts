import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

const deck = ["x-bow", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("native X-Bow deploys, aims, and fires from desktop and phone", async ({ page }, info) => {
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
  await expect.poll(async () => (await state())?.loadedEffects, { timeout: 60000 })
    .toBe(expectedEffects);
  await page.locator('#deck-preview [data-card-info="x-bow"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["6", "X-Bow", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  await expect.poll(async () => (await state())?.elixir, { timeout: 30000 })
    .toBeGreaterThanOrEqual(6);
  const before = await state();
  const slot = before.hand.indexOf("x-bow");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() => (window as any).__arena.project(4, 18.5));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.some(
    (entity: any) => entity.team === "blue" && entity.card === "x-bow" && entity.hp > 0,
  )).toBe(true);
  await expect.poll(async () => (await state()).projectileArtwork.some(
    (shot: any) => shot.sprites.some(
      (sprite: any) => sprite.name === "projectile_arrow_basic",
    ),
  ), { timeout: 60000, intervals: [50, 50, 100] }).toBe(true);
  await page.screenshot({ path: info.outputPath("x-bow-battle.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});
