import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/ui/daily-practice");
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("daily-results-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { dailyPractice } from "./src/ui/daily-practice.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
function attempt(
  day: string,
  playerName: string,
  winner: RecordEntry["winner"],
  date: string,
  ticks: number,
): RecordEntry {
  const { practice } = rules.dailyPractice(new Date(`${day}T12:00:00Z`));
  const battle = new rules.Battle({
    mode: "classic",
    seed: practice.openingSeed,
    deck: practice.playerDeck,
    enemyDeck: practice.deck,
    ai: false,
  });
  for (let tick = 0; tick < ticks; tick++) battle.step();
  return {
    id: 42,
    date,
    playerName,
    mode: "classic",
    practice: true,
    opponent: practice.name,
    opponentType: "ai",
    winner,
    crowns: [0, 0],
    replay: battle.exportReplay(),
  };
}
test("daily saved results review the newest exact opening across date changes without replacing preview state or progress", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const older = attempt(
    "2020-02-29",
    "Older Daily",
    "red",
    "2026-11-01T00:00:00Z",
    60,
  );
  const latest = attempt(
    "2020-02-29",
    "Latest Daily",
    "blue",
    "2026-11-01T00:02:00Z",
    120,
  );
  const variation = attempt(
    "2020-02-29",
    "Fresh Variation",
    "blue",
    "2026-11-01T00:04:00Z",
    90,
  );
  variation.replay.seed++;
  const other = attempt(
    "2020-03-01",
    "Other Daily",
    "draw",
    "2026-11-01T00:06:00Z",
    90,
  );
  const initial: Profile = {
    version: 1,
    name: "Daily Student",
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
    history: [variation, older, other, latest],
  };
  await page.addInitScript(
    ({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)),
    { key, initial },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  const raw = await saved(page);
  await page.locator(".mode-select").click();
  await page.locator("#choose-daily-practice").click();
  await page.locator("#daily-practice-day").fill("2020-02-29");
  const summary = page.locator("#daily-practice-record");
  const review = page.locator("#review-daily-practice");
  await expect(summary).toContainText("1 win · 1 loss · 0 draws");
  await page.locator("#practice-speed").selectOption("0.5");
  await review.scrollIntoViewIfNeeded();
  await review.focus();
  const scroll = await page
    .getByRole("dialog")
    .evaluate((dialog) => dialog.scrollTop);
  await review.press("Enter");
  await expect(page.locator(".match-bottom .player-name")).toHaveText("Latest Daily");
  await expect(page.locator("#replay-clock")).toContainText("/ 0:04");
  if (!(await page.evaluate(() => (window as any).__arena.state.paused)))
    await page.locator("#replay-play").click();
  await page.locator("#replay-speed").click();
  await page.locator("#replay-exit").click();
  await expect(review).toBeFocused();
  await expect(page.locator("#daily-practice-day")).toHaveValue("2020-02-29");
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  expect(
    await page.getByRole("dialog").evaluate((dialog) => dialog.scrollTop),
  ).toBeCloseTo(scroll, 0);
  expect(await saved(page)).toBe(raw);
  await page.locator("#daily-practice-day").fill("");
  await expect(review).toBeDisabled();
  await page.locator("#daily-practice-day").fill("2020-03-01");
  await expect(review).toBeEnabled();
  await expect(summary).toContainText("0 wins · 0 losses · 1 draw");
  await review.click();
  await expect(page.locator(".match-bottom .player-name")).toHaveText("Other Daily");
  await expect(page.locator("#replay-clock")).toContainText("/ 0:03");
  await page.locator("#replay-exit").click();
  await expect(review).toBeFocused();
  await expect(page.locator("#daily-practice-day")).toHaveValue("2020-03-01");
  await page.locator("#daily-practice-day").fill("2020-03-02");
  await expect(summary).toContainText("No saved attempts for this UTC date.");
  await expect(review).toBeHidden();
  await page.locator("#daily-practice-day").fill("2020-02-29");
  await expect(summary).toContainText("1 win · 1 loss · 0 draws");
  await review.scrollIntoViewIfNeeded();
  expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("daily-practice-results.png"),
    animations: "disabled",
  });
  await page.locator("#start-daily-practice").click();
  const expected = rules.dailyPractice(new Date("2020-02-29T12:00:00Z"));
  const actual = await page.evaluate(() => (window as any).__arena.state);
  expect(actual.seed).toBe(expected.practice.openingSeed);
  expect(actual.enemyDeck).toEqual(expected.practice.deck);
  expect(actual.speed).toBe(0.5);
  expect(await saved(page)).toBe(raw);
});
