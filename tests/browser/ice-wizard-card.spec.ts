import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";
import { expectedAnimations, expectedEffects } from "./native-assets";

const deck = ["ice-wizard", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("Ice Wizard can be selected and deployed from the real hand on desktop and phone", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((savedDeck) => {
    localStorage.setItem("browser-royale.profile.v1", JSON.stringify({
      version: 1, sound: false, seenTutorial: true, deck: savedDeck,
    }));
  }, deck);
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect.poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await expect.poll(async () => (await state()).loadedAnimations, { timeout: 60000 })
    .toBe(expectedAnimations);
  await page.locator('#deck-preview [data-card-info="ice-wizard"]').click();
  await expect(page.locator(".detail-art.native-card-ready text"))
    .toHaveText(["3", "Ice Wizard", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const slot = before.hand.indexOf("ice-wizard");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await expect(page.locator("#hand-caption")).toContainText("Ice Wizard · 3 elixir");
  await page.screenshot({ path: info.outputPath("ice-wizard-selected.png"), fullPage: true });
  const point = await page.evaluate(() => (window as any).__arena.project(4, 22));
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).units.filter(
    (e: any) => e.team === "blue" && e.card === "ice-wizard" && e.hp > 0,
  ).length).toBe(1);
  await page.screenshot({ path: info.outputPath("ice-wizard-deployed.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("Ice Wizard's native projectile reaches a controlled target", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/combat.html");
  await page.locator("#scenario").selectOption("ice-wizard");
  await expect(page.locator("#status")).toContainText(`${expectedEffects} effects`, {
    timeout: 60000,
  });
  const panel = page.locator("#destruction");
  const state = async () => JSON.parse((await panel.getAttribute("data-state"))!);
  const shot = async () => JSON.parse((await panel.getAttribute("data-ice-wizard"))!);
  await expect.poll(async () => (await shot()).caster).toBe(1);
  const step = async () => {
    const before = (await state()).time;
    await page.locator("#step").click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(before + 0.099);
  };
  for (let i = 0; i < 30 && (await shot()).visuals.length === 0; i++) await step();
  expect((await shot()).visuals.length).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("ice-wizard-shot.png"), fullPage: true });
  for (let i = 0; i < 30 && (await shot()).hits === 0; i++) await step();
  expect((await shot()).hits).toBeGreaterThan(0);
  expect((await shot()).targetHp).toBeLessThan(10000);
  expect(errors).toEqual([]);
});
