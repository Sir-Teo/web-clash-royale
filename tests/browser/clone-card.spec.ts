import { test, expect } from "@playwright/test";
import { CARD_MAP, CARDS } from "../../src/game/cards";
import type { CardId } from "../../src/game/cards";

test("Clone duplicates a friendly troop from the real desktop and phone hand", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        sound: false,
        seenTutorial: true,
        deck: [
          "clone",
          "skeletons",
          "goblins",
          "spear-goblins",
          "knight",
          "archers",
          "cannon",
          "zap",
        ],
      }),
    ),
  );
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect
    .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await page.locator('#deck-preview [data-card-info="clone"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "3",
    "Clone",
    "Level 11",
  ]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const tap = async (x: number, y: number) => {
    const point = await page.evaluate(
      ({ x, y }) => (window as any).__arena.project(x, y),
      { x, y },
    );
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await state();
    if (
      current.hand.includes("clone") &&
      current.hand.some(
        (id: CardId) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 2,
      )
    )
      break;
    await expect
      .poll(
        async () => {
          const next = await state();
          return next.hand.some(
            (id: CardId) => id !== "clone" && CARD_MAP[id].cost <= next.elixir,
          );
        },
        { timeout: 40000 },
      )
      .toBe(true);
    const before = await state();
    const slot = before.hand.findIndex(
      (id: CardId) => id !== "clone" && CARD_MAP[id].cost <= before.elixir,
    );
    await page.locator(`#hand [data-slot="${slot}"]`).click();
    await tap(
      CARD_MAP[before.hand[slot] as CardId].kind === "spell" ? 9 : 14,
      CARD_MAP[before.hand[slot] as CardId].kind === "spell" ? 10 : 23,
    );
    await expect
      .poll(async () => (await state()).actions, { timeout: 15000 })
      .toBeGreaterThan(before.actions);
  }
  const before = await state();
  const troopSlot = before.hand.findIndex(
    (id: CardId) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 2,
  );
  expect(before.hand.indexOf("clone")).toBeGreaterThanOrEqual(0);
  expect(troopSlot).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => (await state()).elixir, { timeout: 40000 })
    .toBeGreaterThanOrEqual(5);
  await page.locator(`#hand [data-slot="${troopSlot}"]`).click();
  await tap(4, 22);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(before.actions);
  const afterTroop = await state();
  const cloneSlot = afterTroop.hand.indexOf("clone");
  expect(cloneSlot).toBeGreaterThanOrEqual(0);
  await expect(
    page.locator(`#hand [data-slot="${cloneSlot}"]`),
  ).not.toHaveClass(/unaffordable/, { timeout: 30000 });
  await page.locator(`#hand [data-slot="${cloneSlot}"]`).click();
  await tap(4, 21.5);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(afterTroop.actions);
  await expect
    .poll(async () => (await state()).cloneFilter.length, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("clone-real-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
