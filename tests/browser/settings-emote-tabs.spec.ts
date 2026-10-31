import { test, expect, type Page } from "@playwright/test";
import { PRESETS, STARTER_DECK } from "../../src/game/cards";
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
const loaded = (page: Page) =>
  expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

test("muting emotes in an older active battle keeps newer saved progress and the captured battle identity", async ({
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
  await page.locator("#battle-button").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 30000 })
    .toBe(false);
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
  await newer.locator(".mode-select").click();
  await newer
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await newer.locator("#start-practice").click();
  await newer
    .getByRole("button", { name: "Pause battle", exact: true })
    .click();
  await newer
    .getByRole("button", { name: "Leave battle", exact: true })
    .click();
  await expect(
    newer.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const beforeMute = await saved(newer);
  expect(beforeMute).toMatchObject({
    name: "Newer Captain",
    gold: initial.gold + 350,
    chests: [],
    activeDeck: 1,
    deck: PRESETS[1].deck,
    sound: true,
    music: true,
    emotesMuted: false,
    battles: initial.battles + 1,
  });
  expect(beforeMute.history).toHaveLength(1);
  await page.bringToFront();
  await page
    .getByRole("button", { name: "Resume battle", exact: true })
    .click();
  await page.getByRole("button", { name: "King emotes", exact: true }).click();
  await page.getByRole("button", { name: "Mute emotes", exact: true }).click();
  const expected = { ...beforeMute, emotesMuted: true };
  expect(await saved(page)).toEqual(expected);
  expect((await state(page)).emotes.muted).toBe(true);
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    initial.name,
  );
  await expect
    .poll(async () => (await state(page)).music.file, { timeout: 30000 })
    .not.toBeNull();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("muted-battle-keeps-newer-progress.png"),
    animations: "disabled",
  });
  await page.reload();
  await loaded(page);
  expect(await saved(page)).toEqual(expected);
  await expect(page.locator(".player-card .player-name")).toHaveText(
    "Newer Captain",
  );
  expect((await state(page)).emotes.muted).toBe(true);
  expect(errors).toEqual([]);
});
