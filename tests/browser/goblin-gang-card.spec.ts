import { test, expect } from "@playwright/test";
import { CARDS, CARD_MAP, STARTER_DECK } from "../../src/game/cards";

const deck = ["goblin-gang", ...STARTER_DECK.filter((id) => id !== "arrows")];

test("Goblin Gang sends a melee and ranged trio from the real desktop and phone hand", async ({
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
  await page.locator('#deck-preview [data-card-info="goblin-gang"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "3",
    "Goblin Gang",
    "Level 11",
  ]);
  for (const [label, value] of [
    ["Goblins", "3"],
    ["Spear Goblins", "3"],
    ["Goblin hitpoints", String(CARD_MAP.goblins.hp)],
    ["Goblin damage", String(CARD_MAP.goblins.damage)],
    ["Spear Goblin hitpoints", String(CARD_MAP["spear-goblins"].hp)],
    ["Spear Goblin damage", String(CARD_MAP["spear-goblins"].damage)],
    ["Goblin targets", "Ground"],
    ["Spear Goblin targets", "Air & ground"],
  ])
    await expect(page.locator(`[data-card-stat="${label}"] b`)).toHaveText(
      value,
    );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const slot = before.hand.indexOf("goblin-gang");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await expect(page.locator("#hand-caption")).toContainText(
    "Goblin Gang · 3 elixir",
  );
  await page.screenshot({
    path: info.outputPath("goblin-gang-selected.png"),
    fullPage: true,
  });
  const point = await page.evaluate(() =>
    (window as any).__arena.project(4, 22),
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate((actions) => {
        const current = (window as any).__arena.state;
        const units = current.units.filter(
          (e: any) => e.team === "blue" && e.hp > 0,
        );
        return {
          accepted: current.actions > actions,
          counts: ["goblins", "spear-goblins"].map(
            (id) => units.filter((e: any) => e.card === id).length,
          ),
        };
      }, before.actions),
    )
    .toEqual({ accepted: true, counts: [3, 3] });
  await page.screenshot({
    path: info.outputPath("goblin-gang-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
