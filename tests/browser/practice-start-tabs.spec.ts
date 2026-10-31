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
  seenTutorial: false,
  history: [],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const loaded = (page: Page) =>
  expect
    .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
    .toBe(expectedCards);
const saved = (page: Page): Promise<Profile> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const raw = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
async function setup(page: Page) {
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Practice again", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test("starting a first battle from an older setup retains newer progress and its chosen loadouts", async ({
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
  await setup(page);
  await page.locator("#practice-deck").selectOption("curated:2");
  await page.locator("#practice-opponent").selectOption("8");
  await page.locator("#practice-pace").selectOption("double");
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
  await newer
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await newer.locator('[data-deck="1"]').click();
  await newer.locator('[data-chest="0"]').click();
  await newer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await setup(newer);
  await newer.locator("#start-practice").click();
  await finish(newer);
  const latest = await saved(newer),
    latestRaw = await raw(newer);
  expect(latest).toMatchObject({
    name: "Newer Captain",
    seenTutorial: true,
    gold: initial.gold + 350,
    chests: [],
    activeDeck: 1,
    battles: initial.battles + 1,
  });
  expect(latest.history).toHaveLength(1);
  await page.bringToFront();
  await page.locator("#start-practice").click();
  expect(await raw(page)).toBe(latestRaw);
  expect(await state(page)).toMatchObject({
    screen: "battle",
    actions: 0,
    enemyDeck: SOLO_OPPONENTS[8].deck,
  });
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    initial.name,
  );
  await finish(page);
  const both = await saved(page);
  expect(both.history).toHaveLength(2);
  expect(both.history[0]).toMatchObject({
    playerName: initial.name,
    practice: true,
    mode: "double",
    opponent: SOLO_OPPONENTS[8].name,
  });
  expect(both.history[0].replay.deck).toEqual(SOLO_OPPONENTS[2].deck);
  expect(both.history[0].replay.enemyDeck).toEqual(SOLO_OPPONENTS[8].deck);
  expect(both.history[1]).toEqual(latest.history[0]);
  expect({ ...both, history: latest.history, battles: latest.battles }).toEqual(
    latest,
  );
  expect(both.battles).toBe(latest.battles + 1);
  await page.reload();
  await loaded(page);
  expect(await saved(page)).toEqual(both);
  expect(errors).toEqual([]);
});
