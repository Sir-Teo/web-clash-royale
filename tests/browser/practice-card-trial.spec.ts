import { test, expect, type Page, type Locator } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Trial Captain",
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
  activeDeck: 0,
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  history: [],
};
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const ids = (cards: Locator) =>
  cards.evaluateAll((cards) =>
    cards.map((card) => (card as HTMLElement).dataset.nativeCard),
  );
async function activate(page: Page, button: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await button.tap();
  else {
    await button.focus();
    await button.press("Enter");
  }
}
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
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
});

test("a new card uses a temporary replacement and retains navigation, practice choices and captured decks", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await activate(page, page.locator('[data-nav="cards"]'));
  await page.locator("#card-search").fill("miner");
  await activate(page, page.locator('[data-collection="miner"]'));
  const trial = page.locator("#try-card-practice");
  expect((await trial.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await activate(page, trial);
  expect(await ids(page.locator("[data-trial-slot]"))).toEqual(STARTER_DECK);
  await page.screenshot({
    path: info.outputPath("card-trial-replacement.png"),
    animations: "disabled",
  });
  await activate(page, page.locator('[data-trial-slot="0"]'));
  await expect(page.locator("#practice-deck")).toHaveValue("previous");
  await expect(
    page.locator('#practice-deck optgroup[label="Card trial"] option'),
  ).toHaveCount(1);
  expect(
    await ids(
      page.locator('[data-practice-side="yours"] [data-practice-card]'),
    ),
  ).toEqual(["miner", ...STARTER_DECK.slice(1)]);
  await page.locator("#practice-pace").selectOption("double");
  await page.locator("#practice-speed").selectOption("0.5");
  await page.locator("#practice-back").click();
  await expect(page.locator('[data-trial-slot="0"]')).toBeFocused();
  expect(await ids(page.locator("[data-trial-slot]"))).toEqual(STARTER_DECK);
  await page.locator("#card-trial-back").click();
  await expect(trial).toBeFocused();
  await page.locator("#card-back").click();
  await expect(page.locator("#card-search")).toHaveValue("miner");
  await expect(page.locator('[data-collection="miner"]')).toBeFocused();
  expect(await saved(page)).toBe(before);

  await activate(page, page.locator('[data-collection="miner"]'));
  await activate(page, trial);
  await activate(page, page.locator('[data-trial-slot="1"]'));
  const expected = [...STARTER_DECK];
  expected[1] = "miner";
  expect(
    await ids(
      page.locator('[data-practice-side="yours"] [data-practice-card]'),
    ),
  ).toEqual(expected);
  expect(
    await ids(
      page.locator('[data-practice-side="opponent"] [data-practice-card]'),
    ),
  ).toEqual(STARTER_DECK);
  await expect(page.locator("#practice-pace")).toHaveValue("double");
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  expect(await saved(page)).toBe(before);
  await page.locator("#start-practice").click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.locator("#inspect-battle-deck").click();
  expect(await ids(page.locator("[data-battle-card]"))).toEqual(expected);
  await activate(page, page.locator('[data-battle-card="1"]'));
  await expect(
    page.getByRole("dialog", { name: "Miner", exact: true }),
  ).toBeVisible();
  await expect(trial).toHaveCount(0);
  await page.locator("#card-back").click();
  await page.locator("#battle-deck-back").click();
  await page.locator("#surrender-button").click();
  await expect(page.locator("#rematch")).toBeVisible({ timeout: 30000 });
  const after = JSON.parse((await saved(page))!);
  expect(after.decks).toEqual(initial.decks);
  expect(after.deck).toEqual(initial.deck);
  expect(after.activeDeck).toBe(0);
  expect(after.gold).toBe(initial.gold);
  expect(after.trophies).toBe(initial.trophies);
  expect(after.chests).toEqual(initial.chests);
  expect(after.battles).toBe(initial.battles + 1);
  expect(after.history).toHaveLength(1);
  expect(after.history[0].practice).toBe(true);
  expect(after.history[0].mode).toBe("double");
  expect(after.history[0].replay.deck).toEqual(expected);
  expect(after.history[0].replay.enemyDeck).toEqual(STARTER_DECK);
  await page.locator("#change-practice-matchup").click();
  await expect(page.locator("#practice-deck")).toHaveValue("previous");
  await expect(
    page.locator('#practice-deck optgroup[label="Card trial"] option'),
  ).toHaveCount(1);
  expect(
    await ids(
      page.locator('[data-practice-side="yours"] [data-practice-card]'),
    ),
  ).toEqual(expected);
  expect(errors).toEqual([]);
});

test("a card already in the active deck opens practice directly and returns to its collection inspector", async ({
  page,
}) => {
  const before = await saved(page);
  await activate(page, page.locator('[data-nav="cards"]'));
  await page.locator("#card-search").fill("knight");
  await activate(page, page.locator('[data-collection="knight"]'));
  await activate(page, page.locator("#try-card-practice"));
  await expect(page.locator("[data-trial-slot]")).toHaveCount(0);
  await expect(page.locator("#practice-deck")).toHaveValue("previous");
  expect(
    await ids(
      page.locator('[data-practice-side="yours"] [data-practice-card]'),
    ),
  ).toEqual(STARTER_DECK);
  await expect(page.locator("#practice-back")).toHaveText(
    "Back to card details",
  );
  await page.locator("#practice-back").click();
  await expect(page.locator("#try-card-practice")).toBeFocused();
  await page.locator("#card-back").click();
  await expect(page.locator("#card-search")).toHaveValue("knight");
  await expect(page.locator('[data-collection="knight"]')).toBeFocused();
  expect(await saved(page)).toBe(before);
});
