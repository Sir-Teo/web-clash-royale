import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { expectedCards } from "./native-assets";
import { inspectDeckCode } from "./inspect-deck-code";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const initial = {
  version: 1,
  name: "Deck Receiver",
  trophies: 321,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  deck: PRESETS[2].deck,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 2,
  chests: ["gold"],
  history: [],
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

async function activate(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await control.tap();
  else {
    await control.focus();
    await control.press("Enter");
  }
}

async function open(page: Page, red = false) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("#replay-file").setInputFiles({
    name: "shared-decks.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "browser-royale-replay",
        version: 1,
        playerName: "Deck Sender",
        match: {
          date: "2026-10-24T12:00:00.000Z",
          mode: replay.mode,
          winner: red ? "blue" : "red",
          crowns: red ? [3, 0] : [0, 3],
          opponent: "Shared Rival",
          opponentType: "friend",
          replay: {
            ...structuredClone(replay),
            version: 5,
            ...(red ? { perspective: "red" } : {}),
          },
        },
      }),
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Shared replay", exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { key, initial },
  );
  await page.goto("/");
  await expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
});

for (const red of [false, true])
  for (const side of ["yours", "opponent"] as const)
    test(`adopts the ${side} deck from a ${red ? "red" : "blue"} shared replay and retains Undo through repeated use and inspection`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const before = await saved(page);
      await open(page, red);
      const destination = page.getByRole("combobox", {
        name: "Destination battle deck",
        exact: true,
      });
      await expect(destination).toHaveValue("2");
      await destination.selectOption("0");
      await expect(page.locator("#shared-copy-note")).toHaveText(
        "Replaces battle deck 1 and selects it.",
      );
      await page.locator("#practice-pace").selectOption("double");
      await page.locator("#practice-shared-side").selectOption("yours");
      for (const codeSide of ["yours", "opponent"] as const) {
        const cards =
          codeSide === "yours"
            ? red
              ? replay.enemyDeck
              : replay.deck
            : red
              ? replay.deck
              : replay.enemyDeck;
        await inspectDeckCode(
          page,
          page.locator(`[data-share-deck-code="${codeSide}"]`),
          cards,
          "Back to shared replay",
        );
        await expect(destination).toHaveValue("0");
        await expect(page.locator("#practice-pace")).toHaveValue("double");
        await expect(page.locator("#practice-shared-side")).toHaveValue(
          "yours",
        );
      }
      const inspect = page.locator("[data-shared-card]").last();
      await inspect.scrollIntoViewIfNeeded();
      const scroll = await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollTop);
      await inspect.click();
      await page
        .getByRole("button", { name: "Back to shared replay", exact: true })
        .click();
      await expect(inspect).toBeFocused();
      expect(
        await page.getByRole("dialog").evaluate((dialog) => dialog.scrollTop),
      ).toBeCloseTo(scroll, 0);
      await expect(destination).toHaveValue("0");
      expect(await saved(page)).toEqual(before);
      if (info.project.name !== "desktop")
        await page.setViewportSize({ width: 320, height: 740 });
      const use = page.locator(`[data-use-shared-deck="${side}"]`);
      await use.scrollIntoViewIfNeeded();
      expect((await use.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      ).toBe(true);
      await activate(page, use);
      const expected =
        side === "yours"
          ? red
            ? replay.enemyDeck
            : replay.deck
          : red
            ? replay.deck
            : replay.enemyDeck;
      const after = await saved(page);
      expect(after.activeDeck).toBe(0);
      expect(after.deck).toEqual(expected);
      expect(after.decks[0]).toEqual(expected);
      expect(after.decks.slice(1)).toEqual(before.decks.slice(1));
      for (const field of [
        "name",
        "gold",
        "trophies",
        "best",
        "wins",
        "battles",
        "crowns",
        "chests",
        "history",
      ])
        expect(after[field]).toEqual(before[field]);
      await expect(page.locator("#shared-deck-notice")).toHaveText(
        "Battle deck 1 selected and saved.",
      );
      const undo = page.getByRole("button", {
        name: "Undo deck change",
        exact: true,
      });
      await expect(undo).toBeFocused();
      await expect(page.locator("#practice-shared-side")).toHaveValue("yours");
      await expect(page.locator("#practice-pace")).toHaveValue("double");
      await activate(page, use);
      await expect(undo).toBeFocused();
      await inspect.click();
      await page
        .getByRole("button", { name: "Back to shared replay", exact: true })
        .click();
      await expect(inspect).toBeFocused();
      await expect(undo).toBeVisible();
      await undo.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("shared-deck-undo.png"),
        animations: "disabled",
      });
      await activate(page, undo);
      await expect(destination).toBeFocused();
      await expect(page.locator("#shared-deck-notice")).toHaveText(
        "Previous decks restored.",
      );
      await expect(undo).toHaveCount(0);
      expect(await saved(page)).toEqual(before);
      await page.reload();
      await expect
        .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
        .toBe(expectedCards);
      expect(await saved(page)).toEqual(before);
      expect(errors).toEqual([]);
    });

test("shared deck adoption reports session-only progress and can undo when storage rejects writes", async ({
  page,
}) => {
  const before = await saved(page);
  await open(page);
  await page.locator("#shared-deck-slot").selectOption("0");
  await page.evaluate(() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value() {
        throw new DOMException("Blocked", "QuotaExceededError");
      },
    });
  });
  await page.locator('[data-use-shared-deck="opponent"]').click();
  await expect(page.locator("#shared-deck-notice")).toContainText(
    "selected for this session",
  );
  expect(await saved(page)).toEqual(before);
  expect(
    await page
      .locator("#deck-preview [data-card-info]")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.cardInfo),
      ),
  ).toEqual(replay.enemyDeck);
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  await expect(page.locator("#shared-deck-notice")).toContainText(
    "restored for this session",
  );
  expect(
    await page
      .locator("#deck-preview [data-card-info]")
      .evaluateAll((cards) =>
        cards.map((card) => (card as HTMLElement).dataset.cardInfo),
      ),
  ).toEqual(before.deck);
  expect(await saved(page)).toEqual(before);
});
