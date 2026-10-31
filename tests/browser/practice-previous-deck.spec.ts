import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
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
const initial: Profile = {
  version: 1,
  name: "Return Rival",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...PRESETS[2].deck],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 2,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    {
      id: 1,
      date: "2026-10-31T12:00:00.000Z",
      winner: "red",
      crowns: [0, 0],
      mode: "classic",
      opponent: "Custom Rival",
      opponentType: "friend",
      playerName: "Return Rival",
      matchId: "custom",
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 1,
        mode: "classic",
        deck: [...custom],
        enemyDeck: [...STARTER_DECK],
        perspective: "red",
        actions: [],
        duration: 0,
      },
    },
  ],
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
async function finishAndChange(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await page
    .getByRole("button", { name: "Change practice matchup", exact: true })
    .click({ timeout: 20000 });
  await expect(own(page)).toBeVisible();
}
for (const source of ["code", "recorded"] as const) {
  test(`${source} practice keeps an unlisted opponent available after results, including swapping sides`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    if (source === "code") {
      await page
        .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
        .click();
      await page
        .getByRole("button", { name: "Deck codes", exact: true })
        .click();
      await page
        .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
        .fill("BRA-DECK-1:" + custom.join(","));
      await page
        .getByRole("button", { name: "Preview deck", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await page.locator('[data-match-details="0"]').click();
    }
    await pace(page).selectOption("double");
    await page
      .getByRole("button", { name: "Practice against this deck", exact: true })
      .click();
    expect((await state(page)).enemyDeck).toEqual(custom);
    await finishAndChange(page);
    const preview = (side: "yours" | "opponent") =>
      page
        .locator(`[data-practice-side="${side}"] [data-native-card]`)
        .evaluateAll((cards) =>
          cards.map((c) => (c as HTMLElement).dataset.nativeCard),
        );
    expect(await preview("opponent")).toEqual(custom);
    await expect(enemy(page)).toHaveValue("20");
    await expect(own(page)).toHaveValue("2");
    await expect(pace(page)).toHaveValue("double");
    await expect(
      enemy(page).locator('optgroup[label="Previous practice"] option'),
    ).toHaveCount(1);
    await expect(page.locator("#practice-record")).toContainText(
      "0 wins · 1 loss · 0 draws",
    );
    await expect(
      own(page).locator('optgroup[label="Previous practice"] option'),
    ).toHaveCount(1);
    await page.locator("#practice-search").fill("previous practice");
    await expect(enemy(page)).toHaveValue("20");
    await expect(page.locator("#practice-search-count")).toHaveText(
      "1 of 21 opponents",
    );
    const card = page.locator('[data-practice-card="opponent-0"]');
    await card.click();
    await page
      .getByRole("button", { name: "Back to practice decks", exact: true })
      .click();
    await expect(card).toBeFocused();
    await expect(enemy(page)).toHaveValue("20");
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await enemy(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("previous-practice-deck.png"),
      animations: "disabled",
    });
    const beforeSwap = await saved(page);
    await page.getByRole("button", { name: "Swap decks", exact: true }).click();
    await expect(own(page)).toHaveValue("previous");
    await expect(enemy(page)).toHaveValue("19");
    expect(await preview("yours")).toEqual(custom);
    expect(await preview("opponent")).toEqual(initial.deck);
    expect(await saved(page)).toEqual(beforeSwap);
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    expect(
      (await state(page)).hand.every((id: string) => custom.includes(id)),
    ).toBe(true);
    expect((await state(page)).enemyDeck).toEqual(initial.deck);
    await finishAndChange(page);
    await expect(own(page)).toHaveValue("previous");
    await expect(enemy(page)).toHaveValue("19");
    expect(await preview("yours")).toEqual(custom);
    await page.getByRole("button", { name: "Swap decks", exact: true }).click();
    await expect(own(page)).toHaveValue("2");
    await expect(enemy(page)).toHaveValue("20");
    expect(await preview("opponent")).toEqual(custom);
    await expect(page.locator("#practice-record")).toContainText(
      "0 wins · 1 loss · 0 draws",
    );
    const after = await saved(page);
    expect(after.battles).toBe(initial.battles + 2);
    expect(after.history).toHaveLength(initial.history.length + 2);
    expect(after.history[0].replay.deck).toEqual(custom);
    expect(after.history[0].replay.enemyDeck).toEqual(initial.deck);
    expect(after.history[1].replay.deck).toEqual(initial.deck);
    expect(after.history[1].replay.enemyDeck).toEqual(custom);
    expect({
      ...after,
      history: initial.history,
      battles: initial.battles,
    }).toEqual(initial);
    expect(errors).toEqual([]);
  });
}
