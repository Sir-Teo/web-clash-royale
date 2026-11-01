import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { CARD_MAP, STARTER_DECK, PRESETS } from "../../src/game/cards";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
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
  history: [],
};
let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/ui/daily-practice");
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("daily-practice-rules.mjs");
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
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const ids = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.nativeCard),
    );
async function openDaily(page: Page) {
  await page.locator(".mode-select").click();
  await page.locator("#choose-daily-practice").click();
  const day = (await page
    .locator("[data-daily-day]")
    .getAttribute("data-daily-day"))!;
  return rules.dailyPractice(new Date(`${day}T12:00:00Z`));
}
test.beforeEach(async ({ page }, info) => {
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
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
});

test("daily preview keeps UTC decks, speed and native Back focus without changing saved slots", async ({
  page,
}, info) => {
  const before = await saved(page);
  const expected = await openDaily(page);
  expect(
    await ids(page, '[data-daily-side="yours"] [data-daily-card]'),
  ).toEqual(expected.practice.playerDeck);
  expect(
    await ids(page, '[data-daily-side="opponent"] [data-daily-card]'),
  ).toEqual(expected.practice.deck);
  await expect(page.locator("#daily-practice-note time")).toHaveAttribute(
    "datetime",
    expected.day,
  );
  await expect(page.locator("#practice-pace")).toHaveCount(0);
  await page.locator("#practice-speed").selectOption("0.5");
  const card = page.locator('[data-daily-card="yours-0"]');
  await card.focus();
  await card.press("Enter");
  await expect(page.locator("#modal-title")).toHaveText(
    CARD_MAP[expected.practice.playerDeck![0]].name,
  );
  await expect(page.locator("#try-card-practice")).toHaveCount(0);
  await page.locator("#card-back").click();
  await expect(card).toBeFocused();
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  await page.locator("#daily-practice-back").click();
  await expect(page.locator("#choose-daily-practice")).toBeFocused();
  const entry = page.locator("#choose-daily-practice");
  if (info.project.name === "desktop") await entry.press("Enter");
  else await entry.tap();
  const day = (await page
    .locator("[data-daily-day]")
    .getAttribute("data-daily-day"))!;
  const reopened = rules.dailyPractice(new Date(`${day}T12:00:00Z`));
  expect(
    await ids(page, '[data-daily-side="yours"] [data-daily-card]'),
  ).toEqual(reopened.practice.playerDeck);
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  expect(
    (await page.locator("#start-daily-practice").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  expect(await saved(page)).toBe(before);
  await page.screenshot({
    path: info.outputPath("daily-practice-preview.png"),
    animations: "disabled",
  });
});

test("daily practice repeats its captured opening through result replay and retains decks when changing matchup", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.locator(".mode-select").click();
  await page.locator('[data-mode="double"]').click();
  const expected = await openDaily(page);
  await page.locator("#practice-speed").selectOption("2");
  await page.locator("#start-daily-practice").click();
  const opening = new rules.Battle({
    seed: expected.practice.openingSeed,
    mode: "classic",
    deck: expected.practice.playerDeck,
    enemyDeck: expected.practice.deck,
  });
  expect((await state(page)).seed).toBe(expected.practice.openingSeed);
  expect((await state(page)).hand).toEqual(opening.players.blue.hand);
  expect((await state(page)).enemyDeck).toEqual(expected.practice.deck);
  expect((await state(page)).speed).toBe(2);
  await page.locator("#pause-button").click();
  await page.locator("#inspect-battle-deck").click();
  expect(await ids(page, "[data-battle-card]")).toEqual(
    expected.practice.playerDeck,
  );
  await page.locator("#battle-deck-back").click();
  await page.locator("#surrender-button").click();
  await expect(page.locator("#rematch")).toBeVisible({ timeout: 30000 });
  const after = await saved(page);
  const profile = JSON.parse(after!);
  expect(profile.battles).toBe(initial.battles + 1);
  expect(profile.gold).toBe(initial.gold);
  expect(profile.trophies).toBe(initial.trophies);
  expect(profile.chests).toEqual(initial.chests);
  expect(profile.decks).toEqual(initial.decks);
  expect(profile.deck).toEqual(initial.deck);
  expect(profile.history).toHaveLength(1);
  expect(profile.history[0]).toMatchObject({
    practice: true,
    mode: "classic",
    opponent: expected.practice.name,
  });
  expect(profile.history[0].replay.seed).toBe(expected.practice.openingSeed);
  expect(profile.history[0].replay.deck).toEqual(expected.practice.playerDeck);
  expect(profile.history[0].openingSeed).toBeUndefined();
  await page.locator("#watch-replay").click();
  await expect(page.locator("#replay-exit")).toHaveAttribute(
    "aria-label",
    "Back to result",
  );
  await page.locator("#replay-exit").click();
  await page.locator("#rematch").click();
  expect((await state(page)).seed).toBe(expected.practice.openingSeed);
  expect((await state(page)).hand).toEqual(opening.players.blue.hand);
  expect((await state(page)).enemyDeck).toEqual(expected.practice.deck);
  expect((await state(page)).speed).toBe(2);
  await page.locator("#pause-button").click();
  await page.locator("#change-paused-practice").click();
  await expect(page.locator("#practice-deck")).toHaveValue(
    expected.practice.selection!.playerChoice,
  );
  await expect(page.locator("#practice-opponent")).toHaveValue(
    String(expected.practice.selection!.opponentIndex),
  );
  await expect(page.locator("#practice-pace")).toHaveValue("classic");
  expect(
    await ids(page, '[data-practice-side="yours"] [data-practice-card]'),
  ).toEqual(expected.practice.playerDeck);
  expect(
    await ids(page, '[data-practice-side="opponent"] [data-practice-card]'),
  ).toEqual(expected.practice.deck);
  expect(await saved(page)).toBe(after);
});

test("daily date selection retains speed and focus, validates empty dates and starts the chosen opening", async ({
  page,
}, info) => {
  const before = await saved(page);
  await openDaily(page);
  await page.locator("#practice-speed").selectOption("0.5");
  const date = page.locator("#daily-practice-day");
  await date.focus();
  await date.fill("2020-02-29");
  await expect(date).toBeFocused();
  await expect(page.locator("[data-daily-day]")).toHaveAttribute(
    "data-daily-day",
    "2020-02-29",
  );
  const selected = rules.dailyPractice(new Date("2020-02-29T12:00:00Z"));
  expect(
    await ids(page, '[data-daily-side="yours"] [data-daily-card]'),
  ).toEqual(selected.practice.playerDeck);
  expect(
    await ids(page, '[data-daily-side="opponent"] [data-daily-card]'),
  ).toEqual(selected.practice.deck);
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  const card = page.locator('[data-daily-card="opponent-0"]');
  await card.click();
  await page.locator("#card-back").click();
  await expect(card).toBeFocused();
  await expect(date).toHaveValue("2020-02-29");
  await date.fill("");
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#daily-date-error")).toHaveText(
    "Choose a valid UTC date.",
  );
  await expect(date).toHaveAccessibleDescription(/Choose a valid UTC date/);
  await expect(page.locator("#start-daily-practice")).toBeDisabled();
  await date.fill("2026-11-01");
  await expect(page.locator("#daily-date-error")).toBeHidden();
  await expect(date).not.toHaveAccessibleDescription(/Choose a valid UTC date/);
  await expect(page.locator("#start-daily-practice")).toBeEnabled();
  if (info.project.name === "desktop") {
    await date.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(date).toHaveValue("2028-11-01");
    await expect(page.locator("[data-daily-day]")).toHaveAttribute(
      "data-daily-day",
      "2028-11-01",
    );
  }
  const beforeToday = await page.evaluate(() =>
    new Date().toISOString().slice(0, 10),
  );
  await page.locator("#daily-today").click();
  const today = await date.inputValue();
  const afterToday = await page.evaluate(() =>
    new Date().toISOString().slice(0, 10),
  );
  expect([beforeToday, afterToday]).toContain(today);
  await expect(page.locator("[data-daily-day]")).toHaveAttribute(
    "data-daily-day",
    today,
  );
  await expect(page.locator("#practice-speed")).toHaveValue("0.5");
  expect(
    (await page.locator("#daily-today").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await date.fill("2020-02-29");
  await page.screenshot({
    path: info.outputPath("daily-practice-date.png"),
    animations: "disabled",
  });
  expect(await saved(page)).toBe(before);
  await page.locator("#start-daily-practice").click();
  expect((await state(page)).seed).toBe(selected.practice.openingSeed);
  expect((await state(page)).enemyDeck).toEqual(selected.practice.deck);
  expect((await state(page)).speed).toBe(0.5);
  expect(await saved(page)).toBe(before);
});
