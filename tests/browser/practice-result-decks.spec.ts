import { test, expect, type Page } from "@playwright/test";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const initial: Profile = {
  version: 1,
  name: "Trial Student",
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
async function finishPractice(page: Page, blocked = false) {
  await page.addInitScript(
    ({ key, initial, blocked }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(initial));
      if (blocked) {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key)
            throw new DOMException("Blocked save", "QuotaExceededError");
          return write.call(this, name, value);
        };
      }
    },
    { key, initial, blocked },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  await page.locator(".mode-select").click();
  await page.locator("#choose-practice-opponent").click();
  await page.locator("#practice-deck").selectOption("curated:6");
  await page.locator("#practice-opponent").selectOption("7");
  await page.locator("#practice-pace").selectOption("double");
  await page.locator("#start-practice").click();
  await page.locator("#pause-button").click();
  await page.locator("#surrender-button").click();
  await expect(page.locator("#practice-result-decks")).toBeVisible({
    timeout: 30000,
  });
}
async function checkDecks(page: Page) {
  for (const [side, deck] of [
    ["yours", SOLO_OPPONENTS[6].deck],
    ["opponent", SOLO_OPPONENTS[7].deck],
  ] as const) {
    expect(
      await page
        .locator(`[data-match-side="${side}"] [data-match-card]`)
        .evaluateAll((buttons) =>
          buttons.map((button) => (button as HTMLElement).dataset.matchCard),
        ),
    ).toEqual(deck);
  }
  await expect(page.locator(".match-metadata")).toContainText("Practice");
}
test("practice results retain their captured decks through newer progress, adoption and Undo", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await finishPractice(page);
  const finished = JSON.parse((await saved(page))!) as Profile;
  expect(finished.history).toHaveLength(1);
  const latest: Profile = {
    ...finished,
    name: "New Captain",
    gold: 9000,
    trophies: 777,
    best: 800,
    battles: 55,
    wins: 22,
    crowns: 88,
    chests: ["silver", "gold"],
    activeDeck: 1,
    deck: [...PRESETS[2].deck].reverse(),
    decks: [
      [...STARTER_DECK],
      [...PRESETS[2].deck].reverse(),
      [...PRESETS[1].deck],
    ],
    history: [
      {
        ...finished.history[0],
        id: 9001,
        playerName: "Latest Pilot",
        opponent: "New Rival",
        replay: {
          ...finished.history[0].replay,
          seed: finished.history[0].replay.seed + 1,
        },
      },
    ],
  };
  await page.evaluate(
    ({ key, latest }) => localStorage.setItem(key, JSON.stringify(latest)),
    { key, latest },
  );
  const raw = await saved(page);
  const view = page.locator("#practice-result-decks");
  await view.scrollIntoViewIfNeeded();
  expect((await view.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: info.outputPath("practice-result-decks.png"),
    animations: "disabled",
  });
  if (info.project.name === "desktop") {
    await view.focus();
    await view.press("Enter");
  } else await view.tap();
  await checkDecks(page);
  await expect(
    page.locator('[data-match-side="yours"] .match-deck-heading p'),
  ).toHaveText("Trial Student");
  expect(await saved(page)).toBe(raw);
  await page.locator("#match-deck-slot").selectOption("2");
  await page.locator('[data-use-match-deck="yours"]').click();
  await expect(page.locator(".match-deck-status")).toContainText(
    "Saved decks changed in another tab",
  );
  expect(await saved(page)).toBe(raw);
  await checkDecks(page);
  await page.locator('[data-use-match-deck="yours"]').click();
  const adopted = {
    ...latest,
    activeDeck: 2,
    deck: [...SOLO_OPPONENTS[6].deck],
    decks: [...latest.decks.slice(0, 2), [...SOLO_OPPONENTS[6].deck]],
  };
  expect(JSON.parse((await saved(page))!)).toEqual(adopted);
  await page.locator("#undo-match-deck").click();
  expect(JSON.parse((await saved(page))!)).toEqual(latest);
  await page.locator('[data-use-match-deck="yours"]').click();
  await page.reload();
  await expect(page.locator('[data-deck="2"]')).toHaveClass(/active/);
  expect(JSON.parse((await saved(page))!)).toEqual(adopted);
});

test("practice result decks remain usable and undoable when progress cannot be saved", async ({
  page,
}, info) => {
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  await finishPractice(page, true);
  const raw = await saved(page);
  expect(JSON.parse(raw!).history).toEqual([]);
  await page.locator("#practice-result-decks").click();
  await checkDecks(page);
  await page.locator("#match-deck-slot").selectOption("1");
  await page.locator('[data-use-match-deck="yours"]').click();
  await expect(page.locator(".match-deck-status")).toContainText(
    "selected for this session",
  );
  await expect(page.locator('[data-deck="1"]')).toHaveClass(/active/);
  expect(await saved(page)).toBe(raw);
  await page.locator("#undo-match-deck").click();
  await expect(page.locator('[data-deck="0"]')).toHaveClass(/active/);
  expect(await saved(page)).toBe(raw);
  await page.locator("#match-log").click();
  await expect(page.locator("[data-match-details]")).toHaveCount(1);
  expect(await saved(page)).toBe(raw);
});
