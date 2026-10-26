import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedBuildings, expectedEffects } from "./native-assets";

test("Furnace animates and releases a half-second-spaced Fire Spirit pair", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("furnace");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, { timeout: 60000 });
  await expect(page.locator("#status")).toContainText(`${expectedBuildings} buildings loaded`);
  const furnace = async () => JSON.parse(
    (await page.locator("#destruction").getAttribute("data-furnace"))!,
  );
  expect((await furnace()).spirits).toBe(0);
  await page.screenshot({ path: info.outputPath("furnace-idle.png"), fullPage: true });
  await page.locator("#step").click();
  await expect.poll(async () => (await furnace()).spirits).toBe(1);
  expect((await furnace()).index).toBe(1);
  await page.screenshot({ path: info.outputPath("furnace-first-spirit.png"), fullPage: true });
  for (let i = 0; i < 5; i++) await page.locator("#step").click();
  await expect.poll(async () => (await furnace()).spirits).toBe(2);
  await page.screenshot({ path: info.outputPath("furnace-pair.png"), fullPage: true });
  await page.locator("#second").click();
  await page.locator("#second").click();
  await page.screenshot({ path: info.outputPath("furnace-spirits-moving.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});

const deck = ["furnace", ...STARTER_DECK.filter((id) => id !== "arrows")];
test("Furnace can be selected and placed by touch or mouse", async ({ page }, info) => {
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
  await page.locator('#deck-preview [data-card-info="furnace"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["4", "Furnace", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const slot = before.hand.indexOf("furnace");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  const point = await page.evaluate(() => (window as any).__arena.project(9, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.some(
    (entity: any) => entity.team === "blue" && entity.card === "furnace" && entity.hp > 0,
  )).toBe(true);
  await page.screenshot({ path: info.outputPath("furnace-battle.png"), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.body.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(errors).toEqual([]);
});
