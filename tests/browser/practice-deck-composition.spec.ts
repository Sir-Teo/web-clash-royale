import { test, expect } from "@playwright/test";
import { PRESETS, STARTER_DECK, type CardId } from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { encodeDeckCode } from "../../src/game/deck-code";
import { exportReplayFile } from "../../src/game/replay-file";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const custom: CardId[] = [
  "knight",
  "archers",
  "giant",
  "cannon",
  "fireball",
  "arrows",
  "zap",
  "rage",
];
const record: RecordEntry = {
  id: 1,
  date: "2026-10-31T12:00:00.000Z",
  mode: "classic",
  winner: "draw",
  crowns: [0, 0],
  opponent: "Recorded Attacker",
  playerName: "Recorded Defender",
  opponentType: "friend",
  replay: {
    version: 56,
    rulesFamily: "origin",
    seed: 123,
    mode: "classic",
    perspective: "red",
    deck: [...STARTER_DECK],
    enemyDeck: [...PRESETS[1].deck],
    duration: 600,
    actions: [],
  },
};
const profile: Profile = {
  version: 1,
  name: "Deck Learner",
  trophies: 321,
  best: 400,
  gold: 4321,
  wins: 4,
  battles: 12,
  crowns: 15,
  chests: ["gold"],
  deck: [...STARTER_DECK],
  decks: [[...STARTER_DECK], [...PRESETS[1].deck], [...custom]],
  activeDeck: 0,
  sound: false,
  music: false,
  emotesMuted: false,
  seenTutorial: true,
  history: [record],
};
const starter = "6 troops · 2 spells · 0 buildings";
const cycle = "5 troops · 2 spells · 1 building";

test("deck counts follow builder Undo, code previews, practice swaps, captured inspection and red recording projections", async ({
  page,
}, info) => {
  test.setTimeout(150000);
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
  await page.locator("#edit-deck").click();
  await expect(page.locator(".deck-composition")).toHaveText(starter);
  await page.locator('[data-edit-slot="0"]').click();
  await page.locator('[data-collection="zap"]').click();
  await expect(page.locator(".deck-composition")).toHaveText(
    "5 troops · 3 spells · 0 buildings",
  );
  await page.locator("#deck-undo").click();
  await expect(page.locator(".deck-composition")).toHaveText(starter);
  const baseline = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(JSON.parse(baseline!)).toEqual(profile);
  await page.locator("#deck-codes").click();
  await page.locator("#shared-deck-code").fill(encodeDeckCode(custom));
  await page.getByRole("button", { name: "Preview deck", exact: true }).click();
  await expect(page.locator(".deck-composition")).toHaveText(
    "3 troops · 4 spells · 1 building",
  );
  await page.keyboard.press("Escape");
  await page.locator(".mode-select").click();
  await page
    .getByRole("button", { name: "Choose a practice opponent", exact: true })
    .click();
  await page.locator("#practice-deck").selectOption("0");
  await page
    .locator("#practice-opponent")
    .selectOption(String(SOLO_OPPONENTS.length + 1));
  const yours = page.locator('[data-practice-side="yours"] .deck-composition');
  const opponent = page.locator(
    '[data-practice-side="opponent"] .deck-composition',
  );
  await expect(yours).toHaveText(starter);
  await expect(opponent).toHaveText(cycle);
  await page.locator("#swap-practice-decks").click();
  await expect(yours).toHaveText(cycle);
  await expect(opponent).toHaveText(starter);
  await yours.scrollIntoViewIfNeeded();
  expect(
    await yours.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("practice-deck-composition.png"),
    animations: "disabled",
  });
  await page.locator("#start-practice").click();
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.locator("#inspect-battle-deck").click();
  await expect(page.locator(".deck-composition")).toHaveText(cycle);
  await page.locator("#battle-inspect-side").selectOption("opponent");
  await expect(page.locator(".deck-composition")).toHaveText(starter);
  await page.locator("#battle-deck-back").click();
  await page.locator("#change-paused-practice").click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-match-details]").click();
  await expect(
    page.locator('[data-match-side="yours"] .deck-composition'),
  ).toHaveText(cycle);
  await expect(
    page.locator('[data-match-side="opponent"] .deck-composition'),
  ).toHaveText(starter);
  await page.locator("#match-log").click();
  await page
    .locator("#replay-file")
    .setInputFiles({
      name: "composition.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportReplayFile(record, profile.name)),
    });
  await expect(page.locator(".shared-replay .deck-composition")).toHaveText([
    cycle,
    starter,
  ]);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    baseline,
  );
  expect(errors).toEqual([]);
});
