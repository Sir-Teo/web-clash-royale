import { test, expect } from "@playwright/test";
import { expectedCards } from "./native-assets";
import { CARD_MAP } from "../../src/game/cards";
import type { CardId } from "../../src/game/cards";

test("Poison can be selected and cast from the real desktop and phone hand", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem(
    "browser-royale.profile.v1",
    JSON.stringify({
      version: 1,
      sound: false,
      seenTutorial: true,
      deck: ["poison", "knight", "archers", "goblins", "skeletons", "cannon", "zap", "arrows"],
    }),
  ));
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect.poll(async () => (await state())?.loadedCards, { timeout: 60000 }).toBe(expectedCards);
  await page.locator('#deck-preview [data-card-info="poison"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText(["4", "Poison", "Level 11"]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#battle-button").click();
  await expect.poll(async () => (await state())?.intro.blocking).toBe(false);
  const tap = async (x: number, y: number) => {
    const point = await page.evaluate(({ x, y }) => (window as any).__arena.project(x, y), { x, y });
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  for (let attempt = 0; attempt < 8 && !(await state()).hand.includes("poison"); attempt++) {
    await expect.poll(async () => {
      const current = await state();
      return current.hand.some((id: CardId) => id !== "poison" && CARD_MAP[id].cost <= current.elixir);
    }, { timeout: 40000 }).toBe(true);
    const before = await state();
    const slot = before.hand.findIndex((id: CardId) => id !== "poison" && CARD_MAP[id].cost <= before.elixir);
    await page.locator(`#hand [data-slot="${slot}"]`).click();
    await tap(
      CARD_MAP[before.hand[slot] as CardId].kind === "spell" ? 9 : 3 + (attempt % 4) * 3,
      CARD_MAP[before.hand[slot] as CardId].kind === "spell" ? 10 : 22 + Math.floor(attempt / 4) * 2,
    );
    await expect.poll(async () => (await state()).actions, { timeout: 15000 }).toBeGreaterThan(before.actions);
  }
  const before = await state();
  const slot = before.hand.indexOf("poison");
  expect(slot).toBeGreaterThanOrEqual(0);
  await expect(page.locator(`#hand [data-slot="${slot}"]`)).not.toHaveClass(/unaffordable/, { timeout: 30000 });
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await tap(9, 10);
  await expect.poll(async () => (await state()).actions).toBeGreaterThan(before.actions);
  await expect.poll(async () => (await state()).poisonAreas.length).toBe(1);
  await page.screenshot({ path: info.outputPath("poison-real-battle.png"), fullPage: true });
  expect(errors).toEqual([]);
});
