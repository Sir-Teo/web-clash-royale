import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK, type CardId } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { encodeDeckCode } from "../../src/game/deck-code";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "red",
  crowns: [0, 0],
  playerName: "Original Captain",
  opponent: "Original Rival",
  opponentType: "friend",
  matchId: "original-match",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 1,
    mode: "classic",
    perspective: "red",
    deck: [...SOLO_OPPONENTS[2].deck],
    enemyDeck: [...SOLO_OPPONENTS[3].deck],
    actions: [],
    duration: 0,
  },
};
const initial: Profile = {
  version: 1,
  name: "Earlier Captain",
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
  history: [record],
};
const custom: CardId[] = [
  "rocket",
  "rage",
  "hog-rider",
  "musketeer",
  "cannon",
  "skeletons",
  "goblins",
  "zap",
];
const conflictNotice =
  "Saved decks changed in another tab. Review the current selection before changing decks.";
const saved = (page: Page): Promise<Profile> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const raw = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const loaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
function adopted(profile: Profile, deck: readonly CardId[]) {
  const next = structuredClone(profile);
  next.activeDeck = 0;
  next.deck = [...deck];
  next.decks[0] = [...deck];
  return next;
}
async function name(page: Page, value: string) {
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#player-name").fill(value);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
}
async function updateProgress(page: Page) {
  await name(page, "Newer Captain");
  await page.locator('[data-chest="0"]').click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#start-practice").click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  return saved(page);
}

for (const source of ["code", "local", "shared"] as const) {
  test(`${source} deck adoption and Undo retain newer progress, original preview and external deck changes`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    if (source === "code") {
      await page
        .getByRole("button", { name: `Cards ${expectedCards}`, exact: true })
        .click();
      await page
        .getByRole("button", { name: "Deck codes", exact: true })
        .click();
      await page
        .getByLabel("PASTE A SHARED DECK CODE", { exact: true })
        .fill(encodeDeckCode(custom));
      await page
        .getByRole("button", { name: "Preview deck", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      if (source === "local")
        await page.locator('[data-match-details="0"]').click();
      else
        await page.locator("#replay-file").setInputFiles({
          name: "original-replay.json",
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
    }
    const slot = page.locator(
      source === "code"
        ? "#code-deck-slot"
        : source === "local"
          ? "#match-deck-slot"
          : "#shared-deck-slot",
    );
    const use = page.locator(
      source === "code"
        ? "#use-code-deck"
        : source === "local"
          ? '[data-use-match-deck="opponent"]'
          : '[data-use-shared-deck="opponent"]',
    );
    const undo = page.locator(
      source === "code"
        ? "#undo-code-deck"
        : source === "local"
          ? "#undo-match-deck"
          : "#undo-shared-deck",
    );
    const notice = page.locator(
      source === "code"
        ? ".deck-code-notice"
        : source === "local"
          ? "#match-deck-notice"
          : "#shared-deck-notice",
    );
    const cards =
      source === "code"
        ? page.locator("[data-code-card]")
        : source === "local"
          ? page.locator('[data-match-side="opponent"] [data-match-card]')
          : use.locator("..").locator("[data-shared-card]");
    const deck = source === "code" ? custom : record.replay.deck;
    const preview = async () => {
      await expect(slot).toHaveValue("0");
      expect(
        await cards.evaluateAll((cards) =>
          cards.map((card) => (card as HTMLElement).dataset.nativeCard),
        ),
      ).toEqual(deck);
    };
    await slot.selectOption("0");
    const newer = await context.newPage();
    newer.on("pageerror", (error) => errors.push(error.message));
    if (info.project.name !== "desktop")
      await newer.setViewportSize({ width: 320, height: 740 });
    await newer.goto("/");
    await loaded(newer);
    await newer.bringToFront();
    const latest = await updateProgress(newer);
    expect(latest.history).toHaveLength(2);
    await page.bringToFront();
    await use.click();
    expect(await saved(page)).toEqual(adopted(latest, deck));
    await preview();
    await newer.bringToFront();
    await newer.locator("#return-home").click();
    await expect(newer.locator('[data-deck="0"]')).toHaveClass(/active/);
    await name(newer, "Newest Captain");
    await page.bringToFront();
    await undo.click();
    const restored = { ...latest, name: "Newest Captain" };
    expect(await saved(page)).toEqual(restored);
    await preview();
    // A later external deck change invalidates the preview's owned Undo.
    await use.click();
    await newer.bringToFront();
    await expect(newer.locator('[data-deck="0"]')).toHaveClass(/active/);
    await newer.locator('[data-deck="1"]').click();
    const changedUndo = await saved(newer),
      undoRaw = await raw(newer);
    await page.bringToFront();
    await undo.click();
    await expect(notice).toHaveText(conflictNotice);
    await expect(undo).toHaveCount(0);
    await expect(slot).toBeFocused();
    expect(await raw(page)).toBe(undoRaw);
    await preview();
    // An adoption made against stale deck state refreshes before applying it.
    await newer.bringToFront();
    await newer.locator('[data-deck="2"]').click();
    const changedUse = await saved(newer),
      useRaw = await raw(newer);
    expect(changedUse.decks).toEqual(changedUndo.decks);
    await page.bringToFront();
    await use.click();
    await expect(notice).toHaveText(conflictNotice);
    await expect(undo).toHaveCount(0);
    await expect(slot).toBeFocused();
    expect(await raw(page)).toBe(useRaw);
    await preview();
    await use.click();
    expect(await saved(page)).toEqual(adopted(changedUse, deck));
    await undo.click();
    expect(await saved(page)).toEqual(changedUse);
    await preview();
    await page.screenshot({
      path: info.outputPath(`${source}-preview-keeps-newer-progress.png`),
      animations: "disabled",
    });
    await page.reload();
    await loaded(page);
    expect(await saved(page)).toEqual(changedUse);
    expect(errors).toEqual([]);
  });
}
