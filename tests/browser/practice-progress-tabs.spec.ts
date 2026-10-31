import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import type { Profile } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
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
  history: [],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const loaded = (page: Page) =>
  expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
async function practice(
  page: Page,
  player: number,
  opponent: number,
  pace: string,
) {
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#practice-deck").selectOption(`curated:${player}`);
  await page.locator("#practice-opponent").selectOption(String(opponent));
  await page.locator("#practice-pace").selectOption(pace);
  await page.locator("#start-practice").click();
}
async function leave(page: Page) {
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test("finishing an older active battle keeps another tab's newer progress and both captured results", async ({
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
  await practice(page, 2, 8, "double");
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  const newer = await context.newPage();
  newer.on("pageerror", (error) => errors.push(error.message));
  if (info.project.name !== "desktop")
    await newer.setViewportSize({ width: 320, height: 740 });
  await newer.goto("/");
  await loaded(newer);
  await newer.bringToFront();
  await newer
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await newer.locator("#player-name").fill("Newer Captain");
  await newer.locator("#sound-setting").check();
  await newer.locator("#music-setting").check();
  await newer
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await newer.locator('[data-deck="1"]').click();
  await newer.locator('[data-chest="0"]').click();
  await newer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await practice(newer, 3, 9, "classic");
  await expect
    .poll(async () => (await state(newer)).intro.blocking, { timeout: 30000 })
    .toBe(false);
  await newer.getByRole("button", { name: "King emotes", exact: true }).click();
  await newer.getByRole("button", { name: "Mute emotes", exact: true }).click();
  await newer
    .getByRole("button", { name: "Pause battle", exact: true })
    .click();
  await leave(newer);
  const first = await saved(newer);
  expect(first).toMatchObject({
    name: "Newer Captain",
    gold: initial.gold + 350,
    chests: [],
    battles: initial.battles + 1,
    activeDeck: 1,
    deck: PRESETS[1].deck,
    sound: true,
    music: true,
    emotesMuted: true,
  });
  expect(first.history).toHaveLength(1);
  expect(first.history[0]).toMatchObject({
    playerName: "Newer Captain",
    practice: true,
    mode: "classic",
  });
  await page.bringToFront();
  expect(await state(page)).toMatchObject({
    screen: "battle",
    paused: true,
    enemyDeck: SOLO_OPPONENTS[8].deck,
  });
  await leave(page);
  const both = await saved(page);
  expect(both.history).toHaveLength(2);
  expect(both.battles).toBe(initial.battles + 2);
  expect(both.history[0]).toMatchObject({
    playerName: initial.name,
    practice: true,
    mode: "double",
    opponent: SOLO_OPPONENTS[8].name,
  });
  expect(both.history[0].replay.deck).toEqual(SOLO_OPPONENTS[2].deck);
  expect(both.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[8].deck);
  expect(both.history[1]).toEqual(first.history[0]);
  expect({ ...both, history: first.history, battles: first.battles }).toEqual(
    first,
  );
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    initial.name,
  );
  expect((await state(page)).emotes.muted).toBe(true);
  await expect(page.locator(".sound-toggle")).toHaveAttribute(
    "aria-label",
    "Mute sound effects",
  );
  await page.screenshot({
    path: info.outputPath("both-practice-results.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Practice again", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).music.file, { timeout: 30000 })
    .not.toBeNull();
  expect(await saved(page)).toEqual(both);
  await page.reload();
  await loaded(page);
  expect(await saved(page)).toEqual(both);
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Newer Captain",
  );
  expect(errors).toEqual([]);
});
