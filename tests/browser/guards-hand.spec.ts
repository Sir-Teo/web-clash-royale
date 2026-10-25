import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedAnimations } from "./native-assets";

const deck = ["guards", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("Guards use their native card and deploy as a touch-friendly trio", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((savedDeck) => {
    localStorage.setItem("browser-royale.profile.v1", JSON.stringify({
      version: 1, sound: false, music: false, seenTutorial: true, deck: savedDeck,
    }));
  }, deck);
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect.poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await expect.poll(async () => (await state()).loadedAnimations, { timeout: 60000 })
    .toBe(expectedAnimations);
  await page.locator('#deck-preview [data-card-info="guards"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["3", "Guards", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const slot = before.hand.indexOf("guards");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await expect(page.locator("#hand-caption")).toContainText("Guards · 3 elixir");
  const point = await page.evaluate(() => (window as any).__arena.project(4, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.filter((e: any) =>
    e.team === "blue" && e.card === "guards" && e.hp > 0).length).toBe(3);
  const deployedAt = (await state()).animationTime;
  await expect.poll(async () => (await state()).animationTime, { timeout: 10000 })
    .toBeGreaterThan(deployedAt + 2.6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: info.outputPath("guards-deployed.png"), fullPage: true });
  expect(errors).toEqual([]);
});
