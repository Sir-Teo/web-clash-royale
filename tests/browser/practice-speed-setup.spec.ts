import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { encodeDeckCode } from "../../src/game/deck-code";
import { exportReplayFile } from "../../src/game/replay-file";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "training",
  practice: true,
  winner: "red",
  crowns: [0, 0],
  playerName: "Setup Learner",
  opponent: "Saved Defender",
  opponentType: "ai",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 123,
    mode: "training",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration: 600,
    actions: [],
  },
};
const profile: Profile = {
  version: 1,
  name: "Setup Captain",
  trophies: 321,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...PRESETS[2].deck]],
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [record],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const rate = (page: Page) =>
  page.getByRole("combobox", { name: "Practice speed", exact: true });

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, profile }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(profile));
    },
    { key, profile },
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

test("practice setup keeps selected speed through card inspection, recorded review and changing an unsaved matchup", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const before = await saved(page);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#practice-deck").selectOption("0");
  await page
    .locator("#practice-opponent")
    .selectOption(String(SOLO_OPPONENTS.length + 1));
  await expect(rate(page)).toHaveValue("1");
  await rate(page).selectOption("0.5");
  expect((await state(page)).speed).toBe(1);
  await page.locator('[data-practice-card="yours-0"]').click();
  await page
    .getByRole("button", { name: "Back to practice decks", exact: true })
    .click();
  await expect(rate(page)).toHaveValue("0.5");
  await expect(page.locator("#practice-record")).toContainText("1 loss");
  await page.locator("#review-practice").click();
  expect((await state(page)).speed).toBe(1);
  await page
    .getByRole("button", { name: "Back to practice", exact: true })
    .click();
  await expect(rate(page)).toHaveValue("0.5");
  await rate(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("practice-setup-speed.png"),
    animations: "disabled",
  });
  await page.locator("#start-practice").click();
  expect((await state(page)).speed).toBe(0.5);
  await expect(page.locator(".match-bottom .competitor div > span")).toHaveText(
    "Practice · 0.5× speed",
  );
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await expect(rate(page)).toHaveValue("0.5");
  await rate(page).selectOption("2");
  expect((await state(page)).speed).toBe(2);
  await page.locator("#change-paused-practice").click();
  await expect(rate(page)).toHaveValue("2");
  await expect(page.locator("#practice-pace")).toHaveValue("training");
  await expect(page.locator("#practice-record")).toContainText("1 loss");
  expect((await state(page)).speed).toBe(1);
  expect(await saved(page)).toBe(before);
});

for (const source of ["code", "local", "shared"] as const) {
  test(`${source} preview and temporary-deck Back share the chosen practice speed before direct practice`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const before = await saved(page);
    if (source === "code") {
      await page.locator("#edit-deck").click();
      await page.locator("#deck-codes").click();
      await page
        .locator("#shared-deck-code")
        .fill(encodeDeckCode(PRESETS[2].deck));
      await page
        .getByRole("button", { name: "Preview deck", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      if (source === "local")
        await page.locator("[data-match-details]").click();
      else
        await page
          .locator("#replay-file")
          .setInputFiles({
            name: "speed-setup.json",
            mimeType: "application/json",
            buffer: Buffer.from(exportReplayFile(record, profile.name)),
          });
    }
    await rate(page).selectOption("0.5");
    expect((await state(page)).speed).toBe(1);
    const trial = page.locator(
      source === "code"
        ? "#try-code-deck"
        : source === "local"
          ? '[data-try-match-deck="yours"]'
          : '[data-try-shared-deck="opponent"]',
    );
    await trial.click();
    await expect(page.locator("#practice-deck")).toHaveValue("previous");
    await expect(rate(page)).toHaveValue("0.5");
    await rate(page).selectOption("2");
    await page.locator("#practice-back").click();
    await expect(trial).toBeFocused();
    await expect(rate(page)).toHaveValue("2");
    expect((await state(page)).speed).toBe(1);
    await page
      .locator(
        source === "code"
          ? "#practice-code-deck"
          : source === "local"
            ? "#practice-recorded-deck"
            : "#practice-shared-replay",
      )
      .click();
    expect((await state(page)).speed).toBe(2);
    expect((await state(page)).enemyDeck).toEqual(
      source === "code" ? PRESETS[2].deck : PRESETS[1].deck,
    );
    expect(await saved(page)).toBe(before);
  });
}
