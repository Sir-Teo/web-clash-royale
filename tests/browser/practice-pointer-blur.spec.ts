import { test, expect } from "@playwright/test";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
test("window focus loss cancels a hand drag before release and a later explicit primary click still deploys once", async ({
  page,
}) => {
  test.setTimeout(120000);
  const key = "browser-royale.profile.v1";
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem(
      "browser-royale.profile.v1",
      JSON.stringify({
        version: 1,
        seenTutorial: true,
        sound: false,
        music: false,
        deck: [
          "knight",
          "skeletons",
          "goblins",
          "spear-goblins",
          "archers",
          "giant",
          "arrows",
          "minion-horde",
        ],
      }),
    );
  });
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  await page.locator(".mode-select").click();
  await page.locator("#choose-practice-opponent").click();
  await page.locator("#practice-speed").selectOption("0.5");
  await page.locator("#start-practice").click();
  const state = () => page.evaluate(() => (window as any).__arena.state);
  await expect
    .poll(async () => (await state()).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const hand = (await state()).hand;
  const slot = hand.indexOf("knight");
  expect(slot).toBeGreaterThanOrEqual(0);
  const card = page.locator('#hand [data-native-card="knight"]');
  const rect = (await card.boundingBox())!;
  const point = await page.evaluate(() =>
    (window as any).__arena.project(9, 24),
  );
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 6 });
  expect((await state()).selected).toBe(slot);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await page.mouse.up();
  expect((await state()).hand).toEqual(hand);
  expect((await state()).selected).toBe(slot);
  expect((await state()).paused).toBe(false);
  await expect(page.locator("#drag-card")).toBeHidden();
  await page.mouse.click(point.x, point.y);
  expect((await state()).selected).toBe(-1);
  expect((await state()).hand).not.toEqual(hand);
  await page.locator("#pause-button").click();
  await page.locator("#surrender-button").click();
  await expect(page.locator("#rematch")).toBeVisible({ timeout: 30000 });
  const record = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).history[0],
    key,
  );
  const commands = record.replay.actions.filter(
    (action: { team: string }) => action.team === "blue",
  );
  expect(commands).toHaveLength(1);
  expect(commands[0].card).toBe("knight");
});
