import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PRESETS } from "../../src/game/cards";
import { expectedCards } from "./native-assets";

const replay = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const profile = {
  version: 1,
  name: "Deck Tester",
  gold: 1234,
  trophies: 123,
  best: 123,
  wins: 1,
  battles: 2,
  crowns: 3,
  deck: replay.deck,
  decks: [replay.deck, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 0,
  chests: [],
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [
    {
      id: 1,
      date: "2026-10-22T12:00:00.000Z",
      winner: "red",
      crowns: [0, 3],
      mode: replay.mode,
      opponent: "Royal Trainer",
      opponentType: "ai",
      replay,
    },
    {
      id: 2,
      date: "2026-10-22T13:00:00.000Z",
      winner: "blue",
      crowns: [3, 0],
      mode: replay.mode,
      opponent: "<b>Blue & King</b>",
      opponentType: "friend",
      matchId: "FRIEND",
      replay: { ...replay, perspective: "red" },
    },
  ],
};
const saved = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("browser-royale.profile.v1")!),
  );
const ids = (root: Locator) =>
  root
    .locator("[data-native-card]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.nativeCard),
    );
async function open(page: Page, index = 0) {
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(page.locator("[data-replay]")).toHaveCount(2);
  await page.locator(`[data-match-details="${index}"]`).click();
  await expect(
    page.getByRole("heading", { name: "Battle details", exact: true }),
  ).toBeVisible();
}
async function activate(page: Page, button: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await button.tap();
  else await button.click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript((profile) => {
    if (!localStorage.getItem("browser-royale.profile.v1"))
      localStorage.setItem(
        "browser-royale.profile.v1",
        JSON.stringify(profile),
      );
  }, profile);
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
});

test("inspects recorded cards, copies and undoes a deck, persists it and replays the original match", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await saved(page);
  await open(page);
  expect(await ids(page.locator('[data-match-side="yours"]'))).toEqual(
    replay.deck,
  );
  expect(await ids(page.locator('[data-match-side="opponent"]'))).toEqual(
    replay.enemyDeck,
  );
  await page.screenshot({
    path: info.outputPath("battle-details.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("1");
  await expect(page.locator("#match-copy-note")).toHaveText(
    "Replaces battle deck 2 and selects it.",
  );
  await activate(
    page,
    page.getByRole("button", { name: "Use opponent deck", exact: true }),
  );
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Battle deck 2 selected and saved.",
  );
  const copied = await saved(page);
  expect(copied.activeDeck).toBe(1);
  expect(copied.deck).toEqual(replay.enemyDeck);
  expect(copied.decks[1]).toEqual(replay.enemyDeck);
  expect(copied.decks[0]).toEqual(before.decks[0]);
  expect(copied.decks[2]).toEqual(before.decks[2]);
  expect(copied.history).toEqual(before.history);
  expect(copied.gold).toBe(before.gold);
  expect(copied.trophies).toBe(before.trophies);
  await page
    .locator('[data-match-side="opponent"] [data-match-card="giant"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "Giant", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to battle details", exact: true })
    .click();
  await expect(
    page.getByLabel("Destination battle deck", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Previous decks restored.",
  );
  expect(await saved(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Use opponent deck", exact: true })
    .click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect
    .poll(() => ids(page.locator("#deck-preview")))
    .toEqual(replay.enemyDeck);
  await expect(page.locator("#deck-tabs > span")).toHaveText("Custom deck");
  await open(page);
  expect(await ids(page.locator('[data-match-side="yours"]'))).toEqual(
    replay.deck,
  );
  await page
    .getByRole("button", { name: "Use your recorded deck", exact: true })
    .click();
  expect((await saved(page)).deck).toEqual(replay.deck);
  await page
    .getByRole("button", { name: "Watch this replay", exact: true })
    .click();
  const timeline = page.getByRole("slider", { name: "Replay timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect
    .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
    .toBe("red");
  expect((await saved(page)).history).toEqual(before.history);
  await expect(page.locator("[data-use-match-deck]")).toHaveCount(0);
  await expect(page.locator("#match-deck-slot")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("red-side friend details show and copy the opponent's canonical blue deck", async ({
  page,
}) => {
  await open(page, 1);
  expect(await ids(page.locator('[data-match-side="yours"]'))).toEqual(
    replay.enemyDeck,
  );
  expect(await ids(page.locator('[data-match-side="opponent"]'))).toEqual(
    replay.deck,
  );
  await expect(page.locator(".match-result strong")).toHaveText("Victory");
  await expect(page.locator(".match-result > b")).toHaveAttribute(
    "aria-label",
    "Your crowns 3, opponent crowns 0",
  );
  await expect(
    page.locator('.match-deck-panel[data-match-side="opponent"] p'),
  ).toHaveText("<b>Blue & King</b>");
  await expect(page.locator(".match-result span b")).toHaveCount(0);
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("2");
  await activate(
    page,
    page.getByRole("button", { name: "Use opponent deck", exact: true }),
  );
  const current = await saved(page);
  expect(current.activeDeck).toBe(2);
  expect(current.deck).toEqual(replay.deck);
  expect(current.decks[2]).toEqual(replay.deck);
});

test("log and deck details fit small phones and landscape with keyboard focus contained", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  for (const button of await page.locator(".history-actions button").all()) {
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page.locator('[data-match-details="0"]').click();
  const first = page.getByRole("button", { name: "Close dialog", exact: true }),
    last = page.getByRole("button", { name: "Watch this replay", exact: true });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const destination = page.getByLabel("Destination battle deck", {
    exact: true,
  });
  await destination.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  for (const card of await page.locator("[data-match-card]").all()) {
    const box = (await card.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("battle-details-narrow.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  for (const button of [
    destination,
    page.getByRole("button", { name: "Use opponent deck", exact: true }),
    last,
  ]) {
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(844);
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const dialog = element.closest(".modal")!.getBoundingClientRect();
          return (
            Math.round(
              (Math.min(bounds.bottom, dialog.bottom) -
                Math.max(bounds.top, dialog.top)) *
                100,
            ) / 100
          );
        }),
      )
      .toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const paintedHeight = await page
    .getByRole("dialog")
    .evaluate((element) => element.scrollHeight);
  await page.screenshot({
    path: info.outputPath("battle-details-landscape.png"),
    fullPage: false,
  });
  expect(
    await page.getByRole("dialog").evaluate((element) => element.scrollHeight),
  ).toBe(paintedHeight);
  expect(
    await last.evaluate((element) => {
      const bounds = element.getBoundingClientRect(),
        dialog = element.closest(".modal")!.getBoundingClientRect();
      return (
        Math.min(bounds.bottom, dialog.bottom) -
        Math.max(bounds.top, dialog.top)
      );
    }),
  ).toBeGreaterThanOrEqual(44);
});

test("deck copying and Undo stay usable when browser storage refuses writes", async ({
  page,
}) => {
  const before = await saved(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await open(page);
  await page
    .getByLabel("Destination battle deck", { exact: true })
    .selectOption("1");
  await page
    .getByRole("button", { name: "Use opponent deck", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "selected for this session. Browser storage is unavailable.",
  );
  expect(await ids(page.locator("#deck-preview"))).toEqual(replay.enemyDeck);
  expect(await saved(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Undo deck change", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Previous decks restored for this session.",
  );
  expect(await ids(page.locator("#deck-preview"))).toEqual(before.deck);
});
