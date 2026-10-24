import { test, expect, type Page, type Locator } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
const key = "browser-royale.profile.v1";
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const order = (page: Page) =>
  page
    .locator("[data-edit-slot]")
    .evaluateAll((buttons) =>
      buttons.map((button) => (button as HTMLElement).dataset.nativeCard),
    );
async function open(page: Page) {
  await page.locator('[data-nav="cards"]').click();
}
async function activate(page: Page, control: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await control.tap();
  else await control.click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, deck, decks }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Deck King",
            gold: 2345,
            trophies: 123,
            best: 123,
            wins: 3,
            battles: 4,
            crowns: 5,
            chests: ["gold"],
            seenTutorial: true,
            sound: false,
            music: false,
            emotesMuted: false,
            deck,
            decks,
            activeDeck: 0,
            history: [],
          }),
        );
    },
    {
      key,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
    },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
});

test("keyboard deck order persists through codes, reload and a recorded battle", async ({
  page,
}) => {
  const before = await saved(page);
  const expected = [...before.deck.slice(1), before.deck[0]];
  await open(page);
  await expect(page.locator("#deck-move-earlier")).toBeDisabled();
  await expect(page.locator("#deck-move-later")).toBeDisabled();
  await page.locator('[data-edit-slot="0"]').focus();
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await saved(page)).toEqual(before);
  for (let i = 0; i < 7; i++) await page.keyboard.press("Alt+ArrowRight");
  expect(await order(page)).toEqual(expected);
  const selected = page.locator('[data-edit-slot="7"]');
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toHaveAttribute(
    "aria-describedby",
    /deck-order-position/,
  );
  await expect(selected).toHaveAttribute("data-native-card", before.deck[0]);
  await expect(page.locator("#deck-move-later")).toBeDisabled();
  const changed = await saved(page);
  expect(changed).toEqual({
    ...before,
    deck: expected,
    decks: [expected, ...before.decks.slice(1)],
  });
  await page.keyboard.press("Alt+ArrowRight");
  expect(await saved(page)).toEqual(changed);
  await page.locator("#deck-codes").click();
  await expect(page.locator("#current-deck-code")).toHaveValue(
    "BRA-DECK-1:" + expected.join(","),
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__arena);
  await open(page);
  expect(await order(page)).toEqual(expected);
  await page.locator("#deck-done").click();
  await page.locator("#battle-button").click();
  await page.locator("#pause-button").click();
  await page.locator("#surrender-button").click();
  await expect.poll(async () => (await saved(page)).history.length).toBe(1);
  expect((await saved(page)).history[0].replay.deck).toEqual(expected);
});

test("Earlier and Later fit touch screens, follow the selected card and isolate saved slots", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 568 });
  const before = await saved(page);
  await page.locator('[data-deck="1"]').click();
  await open(page);
  await activate(page, page.locator('[data-edit-slot="3"]'));
  await activate(page, page.locator("#deck-move-later"));
  let expected = [...before.decks[1]];
  [expected[3], expected[4]] = [expected[4], expected[3]];
  expect(await order(page)).toEqual(expected);
  await expect(page.locator("#deck-move-later")).toBeFocused();
  await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  await expect(page.locator("#deck-order-position")).toContainText(
    "Slot 5 of 8",
  );
  await expect(page.locator('[data-edit-slot="4"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const id of ["#deck-move-earlier", "#deck-move-later"]) {
    const control = page.locator(id);
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  if (info.project.name !== "mobile")
    await page.screenshot({
      path: info.outputPath("deck-order.png"),
      animations: "disabled",
    });
  await activate(page, page.locator("#deck-move-earlier"));
  expect(await order(page)).toEqual(before.decks[1]);
  await page.locator('[data-filter="spell"]').click();
  await page.locator("#card-search").fill("arrows");
  await activate(page, page.locator("#deck-move-earlier"));
  expected = [...before.decks[1]];
  [expected[2], expected[3]] = [expected[3], expected[2]];
  await expect(page.locator("#card-search")).toHaveValue("arrows");
  await expect(page.locator('[data-filter="spell"]')).toHaveClass(/active/);
  await activate(page, page.locator('[data-collection="arrows"]'));
  expected[2] = "arrows";
  expect(await order(page)).toEqual(expected);
  const changed = await saved(page);
  expect(changed.activeDeck).toBe(1);
  expect(changed.deck).toEqual(expected);
  expect(changed.decks).toEqual([before.decks[0], expected, before.decks[2]]);
  await page.locator('[data-edit-slot="6"]').click();
  await activate(page, page.locator("#deck-move-later"));
  await expect(page.locator('[data-edit-slot="7"]')).toBeFocused();
  await expect(page.locator("#deck-move-later")).toBeDisabled();
  expect(new Set(await order(page)).size).toBe(8);
});

test("deck order remains usable and exportable when browser storage refuses writes", async ({
  page,
}) => {
  const before = await saved(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await open(page);
  await page.locator('[data-edit-slot="1"]').click();
  await page.locator("#deck-move-earlier").click();
  const expected = [...before.deck];
  [expected[0], expected[1]] = [expected[1], expected[0]];
  expect(await order(page)).toEqual(expected);
  await expect(page.locator('[data-edit-slot="0"]')).toBeFocused();
  await expect(page.locator("#deck-order-save")).toContainText(
    "for this session",
  );
  expect(await saved(page)).toEqual(before);
  await page.locator("#deck-codes").click();
  await expect(page.locator("#current-deck-code")).toHaveValue(
    "BRA-DECK-1:" + expected.join(","),
  );
});
