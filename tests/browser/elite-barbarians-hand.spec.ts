import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedAnimations } from "./native-assets";

const deck = ["elite-barbarians", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("Elite Barbarians select and deploy two native fighters by mouse or touch", async ({ page }, info) => {
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
  await expect.poll(async () => (await state())?.loadedCards, { timeout: 60000 }).toBe(CARDS.length);
  await expect.poll(async () => (await state()).loadedAnimations, { timeout: 60000 }).toBe(expectedAnimations);
  await page.locator('#deck-preview [data-card-info="elite-barbarians"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["6", "Elite Barbarians", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 }).toBe(false);
  await expect.poll(async () => (await state()).elixir, { timeout: 60000 }).toBeGreaterThanOrEqual(6);
  const before = await state();
  const slot = before.hand.indexOf("elite-barbarians");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await expect(page.locator("#hand-caption")).toContainText("Elite Barbarians · 6 elixir");
  const point = await page.evaluate(() => (window as any).__arena.project(4, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.filter((e: any) =>
    e.team === "blue" && e.card === "elite-barbarians" && e.hp > 0).length).toBe(2);
  const deployedAt = (await state()).animationTime;
  await expect.poll(async () => (await state()).animationTime, { timeout: 10000 })
    .toBeGreaterThan(deployedAt + 1.5);
  await page.screenshot({ path: info.outputPath("elite-barbarians-deployed.png"), fullPage: true });
  expect(errors).toEqual([]);
});
