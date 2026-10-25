import { test, expect } from "@playwright/test";
import { CARDS, STARTER_DECK } from "../../src/game/cards";

const deck = ["mirror", "skeletons", ...STARTER_DECK.slice(0, 6)];
// The archived shuffle produces both cards in the opening hand for this seed.
const seed = 48;

test("Mirror shows its changing cost and repeats a troop on desktop and phone", async ({
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
  await page.locator('#deck-preview [data-card-info="mirror"]').click();
  await expect(page.locator(".detail-art.native-card-ready text")).toHaveText([
    "1",
    "Mirror",
    "Level 11",
  ]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate((seed) => {
    Math.random = () => (seed - 1) / 2147483646;
  }, seed);
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state())?.intro.blocking, { timeout: 60000 })
    .toBe(false);
  const before = await state();
  const mirrorSlot = before.hand.indexOf("mirror");
  const skeletonSlot = before.hand.indexOf("skeletons");
  expect(mirrorSlot).toBeGreaterThanOrEqual(0);
  expect(skeletonSlot).toBeGreaterThanOrEqual(0);
  const mirror = page.locator(`#hand [data-slot="${mirrorSlot}"]`);
  await expect(mirror).toBeDisabled();
  await expect(mirror.locator(".cost")).toHaveText("?");
  const tap = async (x: number, y: number) => {
    const point = await page.evaluate(
      ({ x, y }) => (window as any).__arena.project(x, y),
      { x, y },
    );
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  await page.locator(`#hand [data-slot="${skeletonSlot}"]`).click();
  await tap(4, 22);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(before.actions);
  await expect(mirror).toBeEnabled();
  await expect(mirror.locator(".cost")).toHaveText("2");
  await expect(mirror.locator(".native-card-art text")).toContainText("2");
  await expect(mirror).toHaveAttribute("data-mirror-card", "skeletons");
  await expect(mirror.locator(".mirror-reflection")).toHaveAttribute(
    "href",
    /portrait-skeletons\.webp$/,
  );
  const afterSkeletons = await state();
  await mirror.click();
  await expect(page.locator("#hand-caption")).toContainText(
    "Mirror → Skeletons · 2 elixir",
  );
  await page.screenshot({
    path: info.outputPath("mirror-selected.png"),
    fullPage: true,
  });
  await tap(5, 22);
  await expect
    .poll(async () => (await state()).actions)
    .toBeGreaterThan(afterSkeletons.actions);
  await expect
    .poll(async () => (await state()).troops)
    .toBeGreaterThanOrEqual(6);
  await page.screenshot({
    path: info.outputPath("mirror-battle.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
