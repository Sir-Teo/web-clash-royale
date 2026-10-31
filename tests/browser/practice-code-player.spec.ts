import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const custom = [
  "rocket",
  "rage",
  "hog-rider",
  "musketeer",
  "cannon",
  "skeletons",
  "goblins",
  "zap",
];
const code = "BRA-DECK-1:" + custom.join(",");
const initial: Profile = {
  version: 1,
  name: "Code Pilot",
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
const trial = (page: Page) =>
  page.getByRole("button", { name: "Try this deck in practice", exact: true });

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
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Deck codes", exact: true }).click();
  await page.getByLabel("PASTE A SHARED DECK CODE", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
});

test("pilots a shared-code deck without adoption and retains its source through results and replay review", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pace(page).selectOption("double");
  await trial(page).scrollIntoViewIfNeeded();
  expect((await trial(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: info.outputPath("shared-code-trial-action.png"),
    animations: "disabled",
  });
  if (info.project.name === "desktop") {
    await trial(page).focus();
    await trial(page).press("Enter");
  } else await trial(page).tap();
  await expect(own(page)).toHaveValue("previous");
  await expect(enemy(page)).toHaveValue("19");
  await expect(pace(page)).toHaveValue("double");
  await expect(
    own(page).locator('optgroup[label="Shared deck"] option'),
  ).toHaveCount(1);
  await expect(
    enemy(page).locator('optgroup[label="Shared deck"] option'),
  ).toHaveCount(1);
  expect(
    await page
      .locator('[data-practice-side="yours"] [data-practice-card]')
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.nativeCard),
      ),
  ).toEqual(custom);
  await enemy(page).selectOption("0");
  const card = page.locator('[data-practice-card="yours-0"]');
  await card.click();
  await page
    .getByRole("button", { name: "Back to practice decks", exact: true })
    .click();
  await expect(card).toBeFocused();
  await expect(own(page)).toHaveValue("previous");
  await expect(enemy(page)).toHaveValue("0");
  expect(await saved(page)).toEqual(initial);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  expect(
    (await state(page)).hand.every((id: string) => custom.includes(id)),
  ).toBe(true);
  expect((await state(page)).enemyDeck).toEqual(SOLO_OPPONENTS[0].deck);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click({ timeout: 20000 });
  await expect(own(page)).toHaveValue("previous");
  await expect(enemy(page)).toHaveValue("0");
  await expect(pace(page)).toHaveValue("double");
  await expect(
    own(page).locator('optgroup[label="Shared deck"] option'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Back to battle modes", exact: true }),
  ).toBeVisible();
  const after = await saved(page);
  expect(after.history).toHaveLength(1);
  expect(after.history[0].replay.deck).toEqual(custom);
  expect(after.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[0].deck);
  expect(after.history[0].mode).toBe("double");
  expect({ ...after, history: [], battles: initial.battles }).toEqual(initial);
  await page
    .getByRole("button", { name: "Review latest practice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to practice", exact: true })
    .click();
  await expect(own(page)).toHaveValue("previous");
  await expect(
    own(page).locator('optgroup[label="Shared deck"] option'),
  ).toHaveCount(1);
  expect(await saved(page)).toEqual(after);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Deck codes", exact: true }).click();
  await page.getByLabel("PASTE A SHARED DECK CODE", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  await trial(page).click();
  await enemy(page).selectOption("0");
  await page
    .getByRole("button", { name: "Review latest practice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to practice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to shared deck", exact: true })
    .click();
  await expect(trial(page)).toBeFocused();
  await expect(
    page.getByLabel("PASTE A SHARED DECK CODE", { exact: true }),
  ).toHaveValue(code);
  expect(await saved(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test("cancelled shared-code setup restores the original preview, destination, pace, focus and Undo", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("1");
  await page
    .getByRole("button", { name: "Use this deck", exact: true })
    .click();
  const adopted = await saved(page);
  expect(adopted.activeDeck).toBe(1);
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("2");
  await pace(page).selectOption("double");
  await trial(page).evaluate((e) => {
    (window as any).__codeTrialButton = e;
  });
  await trial(page).click();
  await expect(enemy(page)).toHaveValue("18");
  await own(page).selectOption("curated:7");
  await pace(page).selectOption("training");
  await page
    .getByRole("button", { name: "Back to shared deck", exact: true })
    .click();
  await expect(trial(page)).toBeFocused();
  expect(
    await trial(page).evaluate((e) => e === (window as any).__codeTrialButton),
  ).toBe(true);
  await expect(
    page.getByLabel("PASTE A SHARED DECK CODE", { exact: true }),
  ).toHaveValue(code);
  await expect(
    page.getByLabel("Destination battle deck", { exact: true }),
  ).toHaveValue("2");
  await expect(pace(page)).toHaveValue("training");
  await expect(
    page.getByRole("button", { name: "Undo deck change", exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toEqual(adopted);
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  expect(await saved(page)).toEqual(initial);
});
