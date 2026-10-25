import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

test("Elixir Collector pump animation and elixir pulse match on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("elixir-collector");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`);
  const collector = async () => JSON.parse(
    (await page.locator("#destruction").getAttribute("data-collector"))!,
  );
  for (let i = 0; i < 8; i++) await page.locator("#second").click();
  await expect.poll(async () => (await collector()).frame).toBeGreaterThan(0);
  await expect.poll(async () => (await collector()).collections).toBe(0);
  await page.screenshot({ path: info.outputPath("collector-pumping.png"), fullPage: true });
  const before = await collector();
  for (let i = 0; i < 5; i++) await page.locator("#step").click();
  await expect.poll(async () => (await collector()).collections).toBe(1);
  const after = await collector();
  expect(after.elixir - before.elixir).toBeGreaterThan(1);
  expect(after.frame).toBeGreaterThan(29);
  await page.screenshot({ path: info.outputPath("collector-collected.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});

const deck = ["elixir-collector", ...STARTER_DECK.filter((id) => id !== "arrows")];
test("Elixir Collector is playable from the hand on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
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
  await page.locator('#deck-preview [data-card-info="elixir-collector"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["6", "Elixir Collector", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  await expect.poll(async () => (await state())?.elixir, { timeout: 30000 })
    .toBeGreaterThanOrEqual(6);
  const before = await state();
  const slot = before.hand.indexOf("elixir-collector");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() => (window as any).__arena.project(9, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.some(
    (entity: any) => entity.team === "blue" && entity.card === "elixir-collector" && entity.hp > 0,
  )).toBe(true);
  await page.screenshot({ path: info.outputPath("collector-battle.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});
