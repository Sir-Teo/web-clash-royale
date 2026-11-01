import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { STARTER_DECK, PRESETS } from "../../src/game/cards";
import type { Profile, RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/ui/daily-practice") &
  typeof import("../../src/game/replay-file");
let record: RecordEntry;
let initial: Profile;
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("daily-record-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { dailyPractice } from "./src/ui/daily-practice.ts"; export { exportReplayFile } from "./src/game/replay-file.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
  const { practice } = rules.dailyPractice(new Date("2020-02-29T12:00:00Z"));
  record = {
    id: 1,
    date: "2026-11-01T00:00:00Z",
    mode: "classic",
    practice: true,
    playerName: "Daily Student",
    opponent: practice.name,
    opponentType: "ai",
    winner: "red",
    crowns: [0, 0],
    replay: new rules.Battle({
      mode: "classic",
      seed: practice.openingSeed,
      deck: practice.playerDeck,
      enemyDeck: practice.deck,
    }).exportReplay(),
  };
  initial = {
    version: 1,
    name: "Receiving Captain",
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
    history: [record],
  };
});
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
for (const source of ["local", "shared"] as const) {
  test(`reopens a ${source} recorded daily date and returns to its retained deck adoption before starting`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
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
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    const shared = source === "shared";
    if (shared) {
      await page
        .locator("#replay-file")
        .setInputFiles({
          name: "daily.json",
          mimeType: "application/json",
          buffer: Buffer.from(rules.exportReplayFile(record, "Daily Student")),
        });
    } else await page.locator("[data-match-details]").first().click();
    const prefix = shared ? "shared" : "match";
    const backLabel = shared
      ? "Back to shared replay"
      : "Back to battle details";
    await page.locator(`#${prefix}-deck-slot`).selectOption("2");
    await page.locator(`[data-use-${prefix}-deck="opponent"]`).click();
    await expect(page.locator(`#undo-${prefix}-deck`)).toBeVisible();
    await page.locator("#practice-speed").selectOption("2");
    const raw = await saved(page);
    const open = page.locator("#open-recorded-daily");
    await open.scrollIntoViewIfNeeded();
    await open.focus();
    const scroll = await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.scrollTop);
    await open.press("Enter");
    await expect(page.locator("#daily-practice-day")).toHaveValue("2020-02-29");
    await expect(page.locator("#practice-speed")).toHaveValue("2");
    await expect(page.locator("#daily-practice-back")).toHaveText(backLabel);
    await page.locator("#practice-speed").selectOption("0.5");
    await page.locator('[data-daily-card="opponent-0"]').click();
    await page.locator("#card-back").click();
    await page.locator("#daily-practice-back").click();
    await expect(open).toBeFocused();
    expect(
      await page.getByRole("dialog").evaluate((dialog) => dialog.scrollTop),
    ).toBeCloseTo(scroll, 0);
    await expect(page.locator(`#${prefix}-deck-slot`)).toHaveValue("2");
    await expect(page.locator("#practice-speed")).toHaveValue("0.5");
    await expect(page.locator(`#undo-${prefix}-deck`)).toBeVisible();
    expect(await saved(page)).toBe(raw);
    await page.locator(`#undo-${prefix}-deck`).click();
    const restored = JSON.parse((await saved(page))!) as Profile;
    expect(restored.deck).toEqual(initial.deck);
    expect(restored.decks).toEqual(initial.decks);
    expect(restored.history).toEqual(initial.history);
    const beforeStart = await saved(page);
    await page.locator("#open-recorded-daily").click();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("recorded-daily-preview.png"),
      animations: "disabled",
    });
    await page.locator("#start-daily-practice").click();
    const state = await page.evaluate(() => (window as any).__arena.state);
    expect(state.seed).toBe(record.replay.seed);
    expect(state.enemyDeck).toEqual(record.replay.enemyDeck);
    expect(state.speed).toBe(0.5);
    expect(state.hand).toEqual(
      new rules.Battle({ replay: record.replay }).players.blue.hand,
    );
    expect(await saved(page)).toBe(beforeStart);
  });
}
