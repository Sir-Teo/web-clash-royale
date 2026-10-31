import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Original King",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  history: [],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await loaded(page);
});

test("Done on an unchanged older deck builder preserves newer saved rewards and preferences", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const older = await context.newPage();
  await older.goto("/");
  await loaded(older);
  await older
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await older
    .getByRole("textbox", { name: "Search cards", exact: true })
    .fill("wizard");
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "PLAYER NAME", exact: true })
    .fill("Newer Captain");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.locator('[data-chest="0"]').click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const newer = await saved(page);
  expect(newer).toMatchObject({
    name: "Newer Captain",
    gold: initial.gold + 350,
    chests: [],
  });
  await older.locator("#deck-done").click();
  expect(await saved(page)).toEqual(newer);
  await older.reload();
  await loaded(older);
  await expect(older.locator(".player-card .player-name")).toHaveText(
    "Newer Captain",
  );
});

test("Done retries a failed deck edit after storage recovers and persists the edited order", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreDeckWrite = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.locator('[data-edit-slot="0"]').click();
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await expect(page.locator("#deck-order-save")).toContainText(
    "for this session",
  );
  expect(await saved(page)).toEqual(initial);
  const moved = [...initial.deck];
  [moved[0], moved[1]] = [moved[1], moved[0]];
  await page.evaluate(() => (window as any).__restoreDeckWrite());
  await page.locator("#deck-done").click();
  expect((await saved(page)).deck).toEqual(moved);
  await page.reload();
  await loaded(page);
  expect(
    await page
      .locator("#deck-preview [data-card-info]")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.cardInfo),
      ),
  ).toEqual(moved);
});
