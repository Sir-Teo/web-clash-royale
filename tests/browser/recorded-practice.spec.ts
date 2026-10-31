import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  CARD_MAP,
  PRESETS,
  STARTER_DECK,
  type CardId,
} from "../../src/game/cards";
import { SOLO_OPPONENTS } from "../../src/game/opponents";
import { expectedCards } from "./native-assets";
import { inspectDeckCode } from "./inspect-deck-code";
const key = "browser-royale.profile.v1";
const legacy = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const marshal = SOLO_OPPONENTS.find((o) => o.name === "Musketeer Marshal")!;

const initial = {
  version: 1,
  name: "Practice Queen",
  gold: 4321,
  trophies: 234,
  best: 250,
  wins: 3,
  battles: 9,
  crowns: 11,
  chests: ["silver"],
  sound: false,
  music: false,
  seenTutorial: true,
  deck: PRESETS[2].deck,
  decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
  activeDeck: 2,
  history: [
    {
      id: 81,
      date: "2026-10-24T12:00:00.000Z",
      winner: "red",
      crowns: [0, 0],
      mode: "classic",
      opponent: marshal.name,
      opponentType: "ai",
      replay: {
        version: 5,
        seed: 81,
        mode: "classic",
        deck: STARTER_DECK,
        enemyDeck: [...marshal.deck],
        actions: [],
        duration: 0,
      },
    },
    {
      id: 82,
      date: "2026-10-24T12:10:00.000Z",
      winner: "blue",
      crowns: [3, 0],
      mode: legacy.mode,
      opponent: "<b>Blue & King</b>",
      opponentType: "friend",
      matchId: "old-round",
      replay: { ...legacy, perspective: "red" },
    },
  ],
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
async function deploy(page: Page) {
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const current = await state(page);
  const slot = current.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= current.elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state(page)).actions)
    .toBeGreaterThan(current.actions);
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Pause battle", exact: true }).click();
  await page.getByRole("button", { name: "Leave battle", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Watch replay", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}
for (const red of [false, true])
  test(`practices a recorded ${red ? "red-side friend's" : "solo opponent's"} deck, repeats it and restores the selected mode`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, initial }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(initial));
      },
      { key, initial },
    );
    await page.goto("/");
    await expect
      .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
      .toBe(expectedCards);
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    await page.locator(".mode-select").click();
    await page.locator('[data-mode="double"]').click();
    const before = await saved(page),
      record = before.history[red ? 1 : 0];
    // Selecting a mode does not write the profile. These authentic local
    // recordings acquire their family tag on the first subsequent save.
    expect(
      before.history.every(
        (entry: any) => entry.replay.rulesFamily === undefined,
      ),
    ).toBe(true);
    const migratedHistory = before.history.map((entry: any) => ({
      ...entry,
      replay: { ...entry.replay, rulesFamily: "local" },
    }));
    const opponentDeck = red ? legacy.deck : [...marshal.deck];
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator(`[data-match-details="${red ? 1 : 0}"]`).click();
    await page.locator("#match-deck-slot").selectOption("0");
    for (const side of ["yours", "opponent"] as const) {
      await inspectDeckCode(
        page,
        page.locator(`[data-share-deck-code="${side}"]`),
        side === "yours"
          ? red
            ? record.replay.enemyDeck
            : record.replay.deck
          : opponentDeck,
        "Back to battle details",
      );
      await expect(page.locator("#match-deck-slot")).toHaveValue("0");
    }
    const action = page.getByRole("button", {
      name: "Practice against this deck",
      exact: true,
    });
    await expect(action).toHaveAttribute(
      "aria-describedby",
      "practice-recorded-note",
    );
    await expect(page.locator("#practice-recorded-note")).toContainText(
      "against your active deck. No trophies or rewards.",
    );
    await action.scrollIntoViewIfNeeded();
    const bounds = (await action.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    expect(await saved(page)).toEqual(before);
    if (!red)
      await page.locator('[data-match-side="opponent"]').screenshot({
        path: info.outputPath("practice-recorded-deck.png"),
        animations: "disabled",
      });
    if (await page.evaluate(() => navigator.maxTouchPoints > 0))
      await action.tap();
    else {
      await action.focus();
      await page.keyboard.press("Enter");
    }
    await expect(page.locator("#battle-intro")).toHaveAttribute(
      "data-clip",
      "pvp_battle_start_training",
    );
    for (let round = 0; round < 2; round++) {
      await expect(page.locator(".competitor.enemy b")).toHaveText(
        record.opponent,
      );
      await expect(page.locator(".competitor.enemy b b")).toHaveCount(0);
      await expect(page.locator(".competitor.enemy div > span")).toHaveText(
        "Recorded deck · Training camp · Practice AI",
      );
      expect((await state(page)).enemyDeck).toEqual(opponentDeck);
      expect(
        (await state(page)).hand.every((id: CardId) =>
          before.deck.includes(id),
        ),
      ).toBe(true);
      if (round === 0) expect(await saved(page)).toEqual(before);
      await deploy(page);
      await expect
        .poll(async () => (await state(page)).actions, { timeout: 20000 })
        .toBeGreaterThan(1);
      await finish(page);
      await expect(page.locator(".practice-result-note")).toHaveText(
        "Practice AI · no trophies or rewards",
      );
      const note = (await page.locator(".practice-result-note").boundingBox())!;
      const repeat = (await page
        .getByRole("button", { name: "Practice again", exact: true })
        .boundingBox())!;
      expect(repeat.y - (note.y + note.height)).toBeGreaterThanOrEqual(14);
      const after = await saved(page);
      for (const field of [
        "gold",
        "trophies",
        "best",
        "chests",
        "deck",
        "decks",
        "activeDeck",
        "wins",
        "crowns",
      ])
        expect(after[field]).toEqual(before[field]);
      expect(after.battles).toBe(before.battles + round + 1);
      expect(after.history[0]).toMatchObject({
        mode: "training",
        opponent: record.opponent,
        opponentType: "ai",
        playerName: before.name,
        replay: {
          version: 56,
          rulesFamily: "origin",
          mode: "training",
          deck: before.deck,
          enemyDeck: opponentDeck,
        },
      });
      expect(after.history[0].matchId).toBeUndefined();
      expect(after.history[0].replay.perspective).toBeUndefined();
      expect(
        after.history[0].replay.actions.some((a: any) => a.team === "red"),
      ).toBe(true);
      expect(after.history.slice(-2)).toEqual(migratedHistory);
      if (round === 0) {
        if (!red && info.project.name !== "mobile")
          await page.screenshot({
            path: info.outputPath("practice-result.png"),
            animations: "disabled",
          });
        await page
          .getByRole("button", { name: "Practice again", exact: true })
          .click();
        await expect(page.locator("#battle-intro")).toHaveAttribute(
          "data-clip",
          "pvp_battle_start_training",
        );
      }
    }
    await page
      .getByRole("button", { name: "Watch replay", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    expect((await state(page)).enemyDeck).toEqual(opponentDeck);
    await expect(page.locator(".competitor.enemy div > span")).toHaveText(
      "Practice AI replay",
    );
    await page.locator("#replay-seek").fill("100");
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Restart replay",
    );
    await page.locator("#replay-exit").click();
    await expect(page.locator("#mode-name")).toHaveText("Double elixir");
    await page.locator("#battle-button").click();
    await expect(page.locator(".competitor.enemy div > span")).toContainText(
      "AI opponent",
    );
    const normal = await state(page);
    expect(normal.enemyDeck).toEqual(
      SOLO_OPPONENTS.find((o) => o.name === normal.opponentName)!.deck,
    );
    await deploy(page);
    await finish(page);
    const normalProfile = await saved(page);
    expect(normalProfile.history[0].mode).toBe("double");
    expect(normalProfile.gold).toBe(before.gold + 25);
    expect(normalProfile.trophies).toBe(before.trophies - 15);
    expect(normalProfile.decks).toEqual(before.decks);
    expect(normalProfile.history.slice(-2)).toEqual(migratedHistory);
    expect(errors).toEqual([]);
  });
