import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  STARTER_DECK,
  PRESETS,
  CARD_MAP,
  type CardId,
} from "../../src/game/cards";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const replay = {
  ...JSON.parse(readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"))
    .replay,
  version: 5,
};
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    ({ key, deck, decks, replay }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Help Shortcut",
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
          deck,
          decks,
          history: [
            {
              id: 42,
              date: "2026-10-24T12:00:00.000Z",
              mode: replay.mode,
              playerName: "Recorded Pilot",
              opponent: "Other King",
              winner: "red",
              crowns: [0, 3],
              replay,
            },
          ],
        }),
      );
    },
    {
      key,
      deck: STARTER_DECK,
      decks: [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck],
      replay,
    },
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

test("question mark opens lobby/replay controls and protects typing, repeats, modifiers and playback state", async ({
  page,
}) => {
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  const battle = page.locator("#battle-button");
  await battle.focus();
  await battle.press("Shift+Slash");
  await expect(page.locator("#modal-title")).toHaveText(
    "Your first crown starts here.",
  );
  await expect(page.locator("#help-done")).toHaveText("Back to arena");
  await page.locator("#help-done").click();
  await expect(battle).toBeFocused();
  await battle.dispatchEvent("keydown", {
    key: "?",
    code: "Slash",
    shiftKey: true,
    repeat: true,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await battle.evaluate((element) => {
      const event = new KeyboardEvent("keydown", {
        key: "?",
        shiftKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#arena-settings").click();
  await page.locator("#player-name").fill("Who");
  await page.locator("#player-name").press("Shift+Slash");
  await expect(page.locator("#player-name")).toHaveValue("Who?");
  await expect(page.locator("#modal-title")).toHaveText(
    "Make yourself at home",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-replay]").click();
  await page.locator("#replay-play").click();
  await page.locator("#replay-speed").click();
  await page.locator("#replay-side").click();
  const frozen = await state(page);
  const canvas = page.locator("#arena-canvas canvas");
  await canvas.focus();
  await page.keyboard.press("Shift+Slash");
  await expect(page.locator("#modal-title")).toHaveText("Replay controls");
  await expect(page.locator("#help-done")).toHaveText("Back to replay");
  await page.locator("#help-done").click();
  await expect(canvas).toBeFocused();
  expect(await state(page)).toMatchObject({
    time: frozen.time,
    paused: true,
    speed: 2,
  });
  await expect(page.locator("#replay-side")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#replay-play").click();
  await canvas.focus();
  await page.keyboard.press("Shift+Slash");
  const during = await state(page);
  expect(during.paused).toBe(true);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(during.time);
  expect((await state(page)).paused).toBe(false);
  expect((await state(page)).speed).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
});

test("battle question-mark Help retains a selected keyboard placement and resumes at the practice speed", async ({
  page,
}, info) => {
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.locator(".mode-select").click();
  await page.locator("#choose-practice-opponent").click();
  await page.locator("#practice-speed").selectOption("0.5");
  await page.locator("#start-practice").click();
  await expect
    .poll(async () => (await state(page)).intro.blocking, { timeout: 15000 })
    .toBe(false);
  const before = await state(page);
  const slot = before.hand.findIndex(
    (id: CardId) =>
      CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= before.elixir,
  );
  expect(slot).toBeGreaterThanOrEqual(0);
  const id = before.hand[slot];
  await page.mouse.move(0, 0);
  await page.keyboard.press(String(slot + 1));
  await page.keyboard.press("ArrowRight");
  const aimed = await state(page);
  await page.keyboard.press("Shift+Slash");
  const frozen = await state(page);
  expect(frozen.paused).toBe(true);
  expect(frozen.selected).toBe(slot);
  await expect(page.locator("#help-done")).toHaveText("Back to battle");
  await page.locator("#help-done").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("keyboard-battle-help.png"),
    animations: "disabled",
  });
  await page.locator("#help-done").click();
  await expect(page.locator("#arena-canvas canvas")).toBeFocused();
  expect((await state(page)).paused).toBe(false);
  expect((await state(page)).speed).toBe(0.5);
  await page.keyboard.press("Enter");
  expect((await state(page)).lastPlayed).toBe(id);
  expect((await state(page)).selected).toBe(-1);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  await page.locator("#pause-button").click();
  await page.locator("#surrender-button").click();
  await expect(page.locator("#rematch")).toBeVisible({ timeout: 30000 });
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  const action = after.history[0].replay.actions.find(
    (action: { team: string; card: string }) =>
      action.team === "blue" && action.card === id,
  );
  expect(action).toBeDefined();
  expect(action.x).toBeCloseTo(aimed.placement.point.x, 6);
  expect(action.y).toBeCloseTo(aimed.placement.point.y, 6);
});
