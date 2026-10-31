import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Matchup Explorer",
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
      opponent: "Recorded Rival",
      opponentType: "ai",
      replay: {
        version: 56,
        rulesFamily: "origin",
        seed: 1,
        mode: "classic",
        deck: [...STARTER_DECK],
        enemyDeck: [...PRESETS[1].deck],
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
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}
for (const source of ["picker", "recorded"] as const)
  test(`${source} practice results reopen matchup choices with the captured loadout and pace`, async ({
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
    if (source === "picker") {
      await page.locator(".mode-select").click();
      await page
        .getByRole("button", {
          name: "Choose a practice opponent",
          exact: true,
        })
        .click();
      await page
        .getByRole("combobox", { name: "Your practice deck", exact: true })
        .selectOption("0");
      await page
        .getByRole("combobox", { name: "Practice opponent", exact: true })
        .selectOption("19");
      await page
        .getByRole("combobox", { name: "Practice pace", exact: true })
        .selectOption("double");
      await page
        .getByRole("button", { name: "Start practice", exact: true })
        .click();
      await finish(page);
      // A rematch must retain the picker selection captured by the first attempt.
      await page
        .getByRole("button", { name: "Practice again", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await page.locator('[data-match-details="0"]').click();
      await page
        .getByRole("combobox", { name: "Practice pace", exact: true })
        .selectOption("double");
      await page
        .getByRole("button", {
          name: "Practice against this deck",
          exact: true,
        })
        .click();
    }
    await finish(page);
    const afterResult = await saved(page);
    const change = page.getByRole("button", {
      name: "Change practice matchup",
      exact: true,
    });
    await expect(change).toBeVisible();
    const bounds = (await change.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: info.outputPath("practice-result-choices.png"),
      animations: "disabled",
    });
    if (info.project.name === "desktop") {
      await change.focus();
      await change.press("Enter");
    } else await change.tap();
    await expect(page.locator("#modal-title")).toHaveText(
      "Choose a practice opponent",
    );
    expect((await state(page)).screen).toBe("lobby");
    const own = source === "picker" ? 0 : initial.activeDeck;
    await expect(
      page.getByRole("combobox", { name: "Your practice deck", exact: true }),
    ).toHaveValue(String(own));
    await expect(
      page.getByRole("combobox", { name: "Practice pace", exact: true }),
    ).toHaveValue("double");
    if (source === "picker")
      await expect(
        page.getByRole("combobox", { name: "Practice opponent", exact: true }),
      ).toHaveValue("19");
    const expectedEnemy =
      source === "picker" ? initial.decks[2] : initial.decks[1];
    expect(
      await page
        .locator('[data-practice-side="opponent"] [data-native-card]')
        .evaluateAll((cards) =>
          cards.map((card) => (card as HTMLElement).dataset.nativeCard),
        ),
    ).toEqual(expectedEnemy);
    expect(await saved(page)).toEqual(afterResult);
    await page
      .getByRole("combobox", { name: "Your practice deck", exact: true })
      .selectOption("1");
    await page
      .getByRole("combobox", { name: "Practice opponent", exact: true })
      .selectOption("0");
    await page
      .getByRole("combobox", { name: "Practice pace", exact: true })
      .selectOption("training");
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    expect(
      (await state(page)).hand.every((id: string) =>
        initial.decks[1].includes(id as any),
      ),
    ).toBe(true);
    await finish(page);
    const after = await saved(page);
    expect(after.history[0]).toMatchObject({
      practice: true,
      mode: "training",
      opponent: "Royal Trainer",
    });
    expect(after.history[0].replay.deck).toEqual(initial.decks[1]);
    expect(after.decks).toEqual(initial.decks);
    expect(after.deck).toEqual(initial.deck);
    expect(after.activeDeck).toBe(initial.activeDeck);
    expect(after.trophies).toBe(initial.trophies);
    expect(after.gold).toBe(initial.gold);
    expect(after.chests).toEqual(initial.chests);
    expect(errors).toEqual([]);
  });
