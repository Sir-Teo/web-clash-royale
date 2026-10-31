import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Both Sides",
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
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const own = (page: Page) =>
  page.getByRole("combobox", { name: "Your practice deck", exact: true });
const enemy = (page: Page) =>
  page.getByRole("combobox", { name: "Practice opponent", exact: true });
const pace = (page: Page) =>
  page.getByRole("combobox", { name: "Practice pace", exact: true });
const swap = (page: Page) =>
  page.getByRole("button", { name: "Swap decks", exact: true });
const cards = (page: Page, side: "yours" | "opponent") =>
  page
    .locator(`[data-practice-side="${side}"] [data-practice-card]`)
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.nativeCard),
    );

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, initial }) => {
      localStorage.setItem(key, JSON.stringify(initial));
      Math.random = () => 0;
    },
    { key, initial },
  );
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
});

test("swaps saved and curated sources with retained pace and focus, clearing restrictive searches", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const before = await saved(page);
  await own(page).selectOption("0");
  await enemy(page).selectOption("19");
  await pace(page).selectOption("double");
  await swap(page).focus();
  if (info.project.name === "desktop") await swap(page).press("Enter");
  else await swap(page).tap();
  await expect(swap(page)).toBeFocused();
  await expect(own(page)).toHaveValue("2");
  await expect(enemy(page)).toHaveValue("17");
  expect(await cards(page, "yours")).toEqual(initial.decks[2]);
  expect(await cards(page, "opponent")).toEqual(initial.decks[0]);
  await swap(page).click();
  await expect(own(page)).toHaveValue("0");
  await expect(enemy(page)).toHaveValue("19");
  await own(page).selectOption("curated:7");
  await page
    .getByRole("searchbox", { name: "Find a matchup", exact: true })
    .fill("battle deck 3");
  await expect(enemy(page)).toHaveValue("19");
  await swap(page).click();
  await expect(swap(page)).toBeFocused();
  await expect(own(page)).toHaveValue("2");
  await expect(enemy(page)).toHaveValue("7");
  await expect(page.locator("#practice-search")).toHaveValue("");
  await expect(page.locator("#practice-search-count")).toHaveText(
    "20 of 20 opponents",
  );
  expect(await cards(page, "yours")).toEqual(initial.decks[2]);
  expect(await cards(page, "opponent")).toEqual(SOLO_OPPONENTS[7].deck);
  await expect(pace(page)).toHaveValue("double");
  await swap(page).click();
  await expect(own(page)).toHaveValue("curated:7");
  await expect(enemy(page)).toHaveValue("19");
  await expect(pace(page)).toHaveValue("double");
  const bounds = (await swap(page).boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await swap(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("practice-swap.png"),
    animations: "disabled",
  });
  await page.locator("#practice-search").fill("no such matchup");
  await expect(swap(page)).toBeDisabled();
  await expect(page.locator("#start-practice")).toBeDisabled();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(swap(page)).toBeEnabled();
  await expect(own(page)).toHaveValue("curated:7");
  await expect(enemy(page)).toHaveValue("19");
  expect(await saved(page)).toEqual(before);
});

test("plays the swapped roles and retains their identities when changing the next matchup", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await own(page).selectOption("curated:7");
  await enemy(page).selectOption("19");
  await pace(page).selectOption("double");
  await swap(page).click();
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[7].deck);
  expect(
    (await state(page)).hand.every((id: string) =>
      initial.decks[2].includes(id as any),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const after = await saved(page);
  expect(after.history).toHaveLength(1);
  expect(after.history[0].replay.deck).toEqual(initial.decks[2]);
  expect(after.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[7].deck);
  expect({ ...after, history: [], battles: initial.battles }).toEqual(initial);
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click();
  await expect(own(page)).toHaveValue("2");
  await expect(enemy(page)).toHaveValue("7");
  await expect(pace(page)).toHaveValue("double");
  await expect(page.locator("#practice-record")).toContainText(
    "0 wins · 1 loss · 0 draws",
  );
  await swap(page).click();
  await expect(page.locator("#practice-record")).toContainText(
    "No saved practice",
  );
  await swap(page).click();
  await expect(page.locator("#practice-record")).toContainText(
    "0 wins · 1 loss · 0 draws",
  );
  expect(await saved(page)).toEqual(after);
  expect(errors).toEqual([]);
});
