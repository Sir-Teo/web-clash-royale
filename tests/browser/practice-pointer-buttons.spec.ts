import { test, expect, type Page } from "@playwright/test";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    addEventListener("contextmenu", (event) => event.preventDefault());
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
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
});
async function finishAndCheck(page: Page) {
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
  expect(commands[0].x).toBeCloseTo(9, 1);
  expect(commands[0].y).toBeCloseTo(24, 1);
}
test("auxiliary arena clicks do not deploy a selected card, while a primary click or touch still records one placement", async ({
  page,
}) => {
  test.setTimeout(120000);
  const hand = (await state(page)).hand;
  const slot = hand.indexOf("knight");
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.mouse.move(0, 0);
  await page.keyboard.press(String(slot + 1));
  const point = await page.evaluate(() =>
    (window as any).__arena.project(9, 24),
  );
  for (const button of ["right", "middle"] as const) {
    await page.mouse.click(point.x, point.y, { button });
    expect((await state(page)).selected).toBe(slot);
    expect((await state(page)).hand).toEqual(hand);
  }
  await page
    .locator("#arena-canvas canvas")
    .dispatchEvent("pointerdown", {
      pointerType: "pen",
      pointerId: 777,
      isPrimary: true,
      button: 2,
      buttons: 2,
      clientX: point.x,
      clientY: point.y,
    });
  expect((await state(page)).selected).toBe(slot);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  expect((await state(page)).selected).toBe(-1);
  expect((await state(page)).hand).not.toEqual(hand);
  await finishAndCheck(page);
});
test("auxiliary hand presses do not select or begin a drag, while a later primary drag still deploys once", async ({
  page,
}) => {
  test.setTimeout(120000);
  const hand = (await state(page)).hand;
  const card = page.locator('#hand [data-native-card="knight"]');
  const rect = (await card.boundingBox())!;
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  for (const button of ["right", "middle"] as const) {
    await page.mouse.click(x, y, { button });
    expect((await state(page)).selected).toBe(-1);
    expect((await state(page)).hand).toEqual(hand);
    await expect(page.locator("#drag-card")).toBeHidden();
  }
  await card.dispatchEvent("pointerdown", {
    pointerType: "pen",
    pointerId: 777,
    isPrimary: true,
    button: 2,
    buttons: 2,
    clientX: x,
    clientY: y,
  });
  expect((await state(page)).selected).toBe(-1);
  const point = await page.evaluate(() =>
    (window as any).__arena.project(9, 24),
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).selected).toBe(-1);
  expect((await state(page)).hand).not.toEqual(hand);
  await finishAndCheck(page);
});
