import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

test("Goblin Hut renders and produces one Spear Goblin per cycle on desktop and phone", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("goblin-hut");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`);
  const hut = async () => JSON.parse(
    (await page.locator("#destruction").getAttribute("data-goblin-hut"))!,
  );
  expect((await hut()).spears).toBe(0);
  for (let i = 0; i < 4; i++) await page.locator("#second").click();
  expect((await hut()).spears).toBe(0);
  await page.screenshot({ path: info.outputPath("goblin-hut-idle.png"), fullPage: true });
  await page.locator("#second").click();
  await expect.poll(async () => (await hut()).spears).toBe(1);
  for (let i = 0; i < 5; i++) await page.locator("#second").click();
  await expect.poll(async () => (await hut()).spears).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("goblin-hut-spawn.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});

const deck = ["goblin-hut", ...STARTER_DECK.filter((id) => id !== "arrows")];
test("Goblin Hut can be selected and placed by touch or mouse", async ({ page }, info) => {
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
  await page.locator('#deck-preview [data-card-info="goblin-hut"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["5", "Goblin Hut", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  await expect.poll(async () => (await state())?.elixir, { timeout: 30000 })
    .toBeGreaterThanOrEqual(5);
  const before = await state();
  const slot = before.hand.indexOf("goblin-hut");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() => (window as any).__arena.project(9, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.some(
    (entity: any) => entity.team === "blue" && entity.card === "goblin-hut" && entity.hp > 0,
  )).toBe(true);
  await page.screenshot({ path: info.outputPath("goblin-hut-battle.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});
