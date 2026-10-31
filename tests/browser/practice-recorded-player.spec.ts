import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "blue",
  crowns: [3, 0],
  playerName: "Recorded Captain",
  opponent: "Recorded Rival",
  opponentType: "friend",
  matchId: "old-round",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 1,
    mode: "classic",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    perspective: "red",
    actions: [],
    duration: 0,
  },
};
const initial: Profile = {
  version: 1,
  name: "Replay Pilot",
  trophies: 321,
  best: 400,
  gold: 4567,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  history: [record],
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
const cards = (page: Page) =>
  page
    .locator('[data-practice-side="yours"] [data-practice-card]')
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.nativeCard),
    );

for (const source of ["local", "shared"] as const) {
  test(`${source} red-side recording offers either captured deck as a temporary player loadout`, async ({
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
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    if (source === "local")
      await page.locator('[data-match-details="0"]').click();
    else
      await page.locator("#replay-file").setInputFiles({
        name: "recorded-deck-trial.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "browser-royale-replay",
            version: 1,
            playerName: record.playerName,
            match: {
              date: record.date,
              mode: record.mode,
              winner: record.winner,
              crowns: record.crowns,
              opponent: record.opponent,
              opponentType: record.opponentType,
              replay: record.replay,
            },
          }),
        ),
      });
    const tryOwn = page.getByRole("button", {
      name:
        source === "local"
          ? "Try your recorded deck"
          : "Try recorded player deck",
      exact: true,
    });
    const tryOpponent = page.getByRole("button", {
      name:
        source === "local" ? "Try opponent deck" : "Try recorded opponent deck",
      exact: true,
    });
    const backLabel =
      source === "local" ? "Back to battle details" : "Back to shared replay";
    const category = source === "local" ? "Recorded deck" : "Shared replay";
    await page
      .getByRole("combobox", { name: "Destination battle deck", exact: true })
      .selectOption("1");
    await pace(page).selectOption("classic");
    if (source === "shared")
      await page.locator("#practice-shared-side").selectOption("yours");
    await tryOwn.scrollIntoViewIfNeeded();
    expect((await tryOwn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: info.outputPath("recorded-deck-trial.png"),
      animations: "disabled",
    });
    if (info.project.name === "desktop") {
      await tryOwn.focus();
      await tryOwn.press("Enter");
    } else await tryOwn.tap();
    await expect(own(page)).toHaveValue("previous");
    await expect(enemy(page)).toHaveValue("19");
    await expect(
      own(page).locator(`optgroup[label="${category}"] option`),
    ).toHaveCount(1);
    expect(await cards(page)).toEqual(record.replay.enemyDeck);
    await pace(page).selectOption("double");
    await page.getByRole("button", { name: backLabel, exact: true }).click();
    await expect(tryOwn).toBeFocused();
    await expect(
      page.getByRole("combobox", {
        name: "Destination battle deck",
        exact: true,
      }),
    ).toHaveValue("1");
    await expect(pace(page)).toHaveValue("double");
    if (source === "shared")
      await expect(page.locator("#practice-shared-side")).toHaveValue("yours");
    expect(await saved(page)).toEqual(initial);
    await tryOpponent.click();
    expect(await cards(page)).toEqual(record.replay.deck);
    await expect(pace(page)).toHaveValue("double");
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    expect(
      (await state(page)).hand.every((id: string) =>
        record.replay.deck.includes(id),
      ),
    ).toBe(true);
    expect((await state(page)).enemyDeck).toEqual(initial.deck);
    await page
      .getByRole("button", { name: "Pause battle", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Leave battle", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Change practice matchup", exact: true })
      .click({ timeout: 20000 });
    await expect(own(page)).toHaveValue("previous");
    await expect(enemy(page)).toHaveValue("19");
    await expect(
      own(page).locator(`optgroup[label="${category}"] option`),
    ).toHaveCount(1);
    expect(await cards(page)).toEqual(record.replay.deck);
    await expect(
      page.getByRole("button", { name: "Back to battle modes", exact: true }),
    ).toBeVisible();
    const after = await saved(page);
    expect(after.history).toHaveLength(2);
    expect(after.history[0].replay.deck).toEqual(record.replay.deck);
    expect(after.history[0].replay.enemyDeck).toEqual(initial.deck);
    expect(after.history[0].mode).toBe("double");
    expect({
      ...after,
      history: initial.history,
      battles: initial.battles,
    }).toEqual(initial);
    expect(errors).toEqual([]);
  });
}
