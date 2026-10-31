import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record = (options: Partial<RecordEntry>): RecordEntry => ({
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "draw",
  crowns: [0, 0],
  opponentType: "ai",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 123,
    mode: "classic",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration: 600,
    actions: [],
  },
  ...options,
});
const friend = record({
  playerName: "王小明",
  opponent: "Cycle Rival",
  opponentType: "friend",
  mode: "double",
  winner: "red",
});
friend.replay = { ...friend.replay, mode: "double", perspective: "red" };
const profile: Profile = {
  version: 1,
  name: "Local Captain",
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
  history: [
    record({
      playerName: "Élodie King",
      opponent: "Siege Rival",
      practice: true,
      winner: "blue",
    }),
    friend,
    record({}),
  ],
};

test("finds captured player names with card and battle filters while preserving details and replay identity", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  const search = page.getByRole("searchbox", {
    name: "Search battles",
    exact: true,
  });
  await expect(search).toHaveAccessibleDescription(/recorded player names/i);
  await search.fill("ELODIE king musketeer");
  await expect(search).toBeFocused();
  await expect(page.locator(".history-entry")).toHaveAttribute(
    "data-history-index",
    "0",
  );
  await page.locator("#history-type").selectOption("practice");
  await page.locator("#history-result").selectOption("blue");
  await page.locator("#history-mode").selectOption("classic");
  await expect(page.locator("#history-count")).toHaveText(
    "Showing 1 of 3 saved battles.",
  );
  const details = page.locator('[data-match-details="0"]');
  if (info.project.name === "desktop") await details.press("Enter");
  else await details.tap();
  await expect(
    page.locator('[data-match-side="yours"] .match-deck-heading p'),
  ).toHaveText("Élodie King");
  await page.locator("#match-log").click();
  await expect(search).toHaveValue("ELODIE king musketeer");
  await expect(details).toBeFocused();
  await page.locator("#clear-history-filters").click();
  await search.fill("王小 cannon cycle");
  await page.locator("#history-type").selectOption("friend");
  await page.locator("#history-result").selectOption("red");
  await page.locator("#history-mode").selectOption("double");
  await expect(page.locator(".history-entry")).toHaveAttribute(
    "data-history-index",
    "1",
  );
  await page.screenshot({
    path: info.outputPath("recorded-player-search.png"),
    animations: "disabled",
  });
  await page.locator('[data-replay="1"]').click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText("王小明");
  await expect(page.locator(".competitor.enemy b")).toHaveText("Cycle Rival");
  await page.locator("#replay-exit").click();
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Local Captain",
  );
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await expect(search).toHaveValue("王小 cannon cycle");
  await expect(page.locator('[data-replay="1"]')).toBeFocused();
  await page.locator("#clear-history-filters").click();
  await search.fill("Local Captain");
  await expect(page.locator(".history-entry")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "No battles match these filters.",
      exact: true,
    }),
  ).toBeVisible();
  await search.fill("Royal Trainer");
  await expect(page.locator(".history-entry")).toHaveAttribute(
    "data-history-index",
    "2",
  );
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  expect(errors).toEqual([]);
});
