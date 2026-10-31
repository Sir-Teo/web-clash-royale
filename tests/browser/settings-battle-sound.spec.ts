import { test, expect, type Page } from "@playwright/test";
import {
  PRESETS,
  STARTER_DECK,
  type CardId,
  CARD_MAP,
} from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "draw",
  crowns: [0, 0],
  opponent: "Old Rival",
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
};
const initial: Profile = {
  version: 1,
  name: "Audio Captain Long",
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
  sound: true,
  music: true,
  emotesMuted: false,
  seenTutorial: true,
  history: [record],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);

test("battle speaker and M keep newer progress, live placement, music and replay controls intact", async ({
  page,
}, info) => {
  test.setTimeout(150000);
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
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#start-practice").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const speaker = page.locator("#battle-sound-button");
  await expect(speaker).toHaveAttribute("aria-label", "Mute sound effects");
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const controls = (await page.locator(".battle-tools").boundingBox())!;
    const name = (await page
      .locator(".match-bottom .competitor > div")
      .boundingBox())!;
    expect(name.x + name.width).toBeLessThanOrEqual(controls.x + 1);
    expect(controls.x + controls.width).toBeLessThanOrEqual(viewport.width);
    for (const button of await page.locator(".battle-tools > button").all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
  }
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 320, height: 740 });
  const current = await state(page);
  const slot = current.hand.findIndex(
    (id: CardId) => CARD_MAP[id].kind === "troop",
  );
  await page.keyboard.press(String(slot + 1));
  const latest = await page.evaluate(
    ({ key, record, preset }) => {
      const profile = JSON.parse(localStorage.getItem(key)!);
      profile.name = "New Audio Captain";
      profile.gold += 150;
      profile.chests = [];
      profile.activeDeck = 1;
      profile.deck = [...preset];
      profile.battles++;
      profile.history.unshift({ ...record, id: 2, opponent: "New Rival" });
      localStorage.setItem(key, JSON.stringify(profile));
      return profile;
    },
    { key, record, preset: PRESETS[1].deck },
  );
  await page.keyboard.press("m");
  expect(await saved(page)).toEqual({ ...latest, sound: false });
  expect((await state(page)).selected).toBe(slot);
  expect((await state(page)).paused).toBe(false);
  expect(
    (await state(page)).hand.every((id: CardId) => STARTER_DECK.includes(id)),
  ).toBe(true);
  await expect(page.locator(".match-bottom .player-name")).toHaveText(
    initial.name,
  );
  await expect(speaker).toHaveAttribute("aria-label", "Enable sound effects");
  await expect.poll(async () => (await state(page)).music.paused).toBe(false);
  const canvas = page.locator("#arena-canvas canvas");
  await canvas.dispatchEvent("keydown", {
    key: "m",
    code: "KeyM",
    repeat: true,
  });
  expect(await saved(page)).toEqual({ ...latest, sound: false });
  const beforeTime = (await state(page)).time;
  if (info.project.name === "desktop") await speaker.press("Space");
  else await speaker.tap();
  await expect(speaker).toHaveAttribute("aria-label", "Mute sound effects");
  await expect(page.locator(".sound-toggle")).toHaveAttribute(
    "aria-label",
    "Mute sound effects",
  );
  expect(await saved(page)).toEqual({ ...latest, sound: true });
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(beforeTime);
  await page.screenshot({
    path: info.outputPath("battle-sound-controls.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Battle settings", exact: true })
    .click();
  await page.locator("#player-name").press("m");
  await page.keyboard.press("Escape");
  expect((await saved(page)).sound).toBe(true);
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.locator("#surrender-button").click();
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await page.locator("#replay-play").click();
  await page.locator("#replay-speed").click();
  await page.locator("#replay-side").click();
  const replay = await state(page);
  const beforeReplayMute = await saved(page);
  await canvas.focus();
  await page.keyboard.press("m");
  expect(await saved(page)).toEqual({ ...beforeReplayMute, sound: false });
  expect((await state(page)).paused).toBe(true);
  expect((await state(page)).time).toBe(replay.time);
  expect((await state(page)).speed).toBe(2);
  expect((await state(page)).music.rate).toBe(2);
  await expect(page.locator("#replay-side")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(speaker).toHaveAttribute("aria-label", "Enable sound effects");
  await page.locator("#replay-exit").click();
  await expect(page.locator(".sound-toggle")).toHaveAttribute(
    "aria-label",
    "Enable sound effects",
  );
  expect(errors).toEqual([]);
});
