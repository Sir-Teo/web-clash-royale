import { test, expect } from "@playwright/test";
import { CARD_MAP, CARDS } from "../../src/game/cards";
import type { CardId } from "../../src/game/cards";

test("Goblin Barrel can be selected and cast from the real desktop and phone hand", async ({
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
          "goblin-barrel",
          "knight",
          "archers",
          "goblins",
          "skeletons",
          "cannon",
          "zap",
          "arrows",
        ],
      }),
    ),
  );
  await page.goto("/");
  const state = () => page.evaluate(() => (window as any).__arena?.state);
  await expect
    .poll(async () => (await state())?.loadedCards, { timeout: 60000 })
    .toBe(CARDS.length);
  await page.locator('#deck-preview [data-card-info="goblin-barrel"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "3",
    "Goblin Barrel",
    "Level 11",
  ]);
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
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
  for (
    let attempt = 0;
    attempt < 8 && !(await state()).hand.includes("goblin-barrel");
    attempt++
  ) {
    await expect
      .poll(
        async () => {
          const current = await state();
          return current.hand.some(
            (id: CardId) =>
              id !== "goblin-barrel" && CARD_MAP[id].cost <= current.elixir,
          );
        },
        { timeout: 40000 },
      )
      .toBe(true);
    const before = await state();
    const slot = before.hand.findIndex(
      (id: CardId) =>
        id !== "goblin-barrel" && CARD_MAP[id].cost <= before.elixir,
    );
    await page.locator(`#hand [data-slot="${slot}"]`).click();
    await tap(
      CARD_MAP[before.hand[slot] as CardId].kind === "spell"
        ? 9
        : 3 + (attempt % 4) * 3,
      CARD_MAP[before.hand[slot] as CardId].kind === "spell"
        ? 10
        : 22 + Math.floor(attempt / 4) * 2,
    );
    await expect
      .poll(async () => (await state()).actions, { timeout: 15000 })
      .toBeGreaterThan(before.actions);
  }
  const before = await state();
  const slot = before.hand.indexOf("goblin-barrel");
  expect(slot).toBeGreaterThanOrEqual(0);
  await expect(page.locator(`#hand [data-slot="${slot}"]`)).not.toHaveClass(
    /unaffordable/,
    { timeout: 30000 },
  );
  await page.locator(`#hand [data-slot="${slot}"]`).click();
  await tap(4, 9);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(before.actions);
  await expect
    .poll(
      async () =>
        (await state()).projectileArtwork.some((shot: any) =>
          shot.sprites.some(
            (sprite: any) => sprite.name === "spell_goblin_barrel_projectile",
          ),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("goblin-barrel-real-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
