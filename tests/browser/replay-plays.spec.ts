import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import type { CardId } from "../../src/game/cards";
import type { Replay, Team } from "../../src/game/engine";

let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/game/cards");
const key = "browser-royale.profile.v1";
const deck: CardId[] = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini-pekka",
  "fireball",
  "arrows",
  "bomber",
];
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-play-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle, STEP } from "./src/game/engine.ts"; export { CARD_MAP } from "./src/game/cards.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});

async function openReplay(page: Page, replay: Replay) {
  await page.addInitScript(
    ({ key, replay }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Play Navigator",
          sound: false,
          music: false,
          seenTutorial: true,
          history: [
            {
              id: 42,
              date: "2026-10-28T12:00:00.000Z",
              mode: replay.mode,
              winner: "red",
              crowns: [0, 0],
              opponent: "Other King",
              opponentType: "friend",
              replay,
            },
          ],
        }),
      ),
    { key, replay },
  );
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__arena);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-replay]").click();
  return before;
}

for (const viewer of ["blue", "red"] as const)
  test(`${viewer} card-play navigation groups commands and preserves playback state`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const live = new rules.Battle({
      seed: 1,
      ai: false,
      deck,
      enemyDeck: deck,
    });
    function play(team: Team) {
      const slot = live.players[team].hand
        .map((id, i) => ({ id, i }))
        .filter(
          ({ id }) =>
            rules.CARD_MAP[id].kind === "troop" &&
            rules.CARD_MAP[id].cost <= live.players[team].elixir,
        )
        .sort(
          (a, b) => rules.CARD_MAP[a.id].cost - rules.CARD_MAP[b.id].cost,
        )[0].i;
      expect(
        live.play(
          team,
          slot,
          team === "blue" ? 4 : 14,
          team === "blue" ? 22 : 10,
        ).ok,
      ).toBe(true);
    }
    play("blue");
    play("red");
    while (live.tick < 180) live.step();
    play("blue");
    while (live.tick < 900) live.step();
    play("red");
    const replay: Replay = { ...live.exportReplay(), perspective: viewer };
    const before = await openReplay(page, replay);
    await page.locator("#replay-play").click();
    await page.locator("#replay-speed").click();
    const picker = page.getByRole("combobox", {
      name: "Card plays",
      exact: true,
    });
    await expect(picker).toBeEnabled();
    await expect(picker.locator("option")).toHaveCount(4);
    await expect(picker.locator("option").nth(1)).toHaveText(
      `0:00 · ${viewer === "blue" ? "Player" : "Opponent"}: ${rules.CARD_MAP[replay.actions[0].card].name} · ${viewer === "red" ? "Player" : "Opponent"}: ${rules.CARD_MAP[replay.actions[1].card].name}`,
    );
    await expect(picker.locator("option").nth(2)).toHaveText(
      new RegExp(`^0:06 · ${viewer === "blue" ? "Player" : "Opponent"}:`),
    );
    await expect(picker.locator("option").nth(3)).toHaveText(
      new RegExp(`^0:30 · ${viewer === "red" ? "Player" : "Opponent"}:`),
    );
    async function check(tick: number) {
      const expected = new rules.Battle({ replay });
      while (expected.tick < tick && !expected.winner) expected.step();
      const actual = await state(page);
      expect(actual.time).toBe(expected.time);
      expect(actual.hand).toEqual(expected.players[viewer].hand);
      expect(actual.elixir).toBeCloseTo(expected.players[viewer].elixir, 9);
      expect(actual.actions).toBe(expected.actions.length);
      expect(actual.troops).toBe(
        expected.entities.filter((e) => e.kind === "troop").length,
      );
      expect(actual.paused).toBe(true);
      await expect(page.locator("#replay-speed")).toHaveText("2×");
    }
    await picker.selectOption("0");
    await check(1);
    await picker.selectOption("180");
    await check(181);
    await picker.selectOption("900");
    await check(900);
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Restart replay",
    );
    const canvas = page.locator("#arena-canvas canvas");
    await canvas.focus();
    await page.keyboard.press("[");
    await check(181);
    await expect(picker).toHaveValue("180");
    await page.keyboard.press("[");
    await check(1);
    // A held shortcut rebuilds only once, even with repeated keydown events.
    await page.keyboard.down("]");
    await page.keyboard.down("]");
    await page.keyboard.up("]");
    await check(181);
    await page.keyboard.press("Control+]");
    await check(181);
    // A pending slider position takes precedence; jumping cancels its queued seek.
    await page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>("#replay-seek")!;
      slider.value = "66.6667";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#arena-canvas canvas")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "[", bubbles: true }),
      );
    });
    await check(181);
    await picker.focus();
    await page.keyboard.press("]");
    await page.keyboard.press("1");
    await page.keyboard.press("Escape");
    await check(181);
    await canvas.focus();
    await page.keyboard.press("End");
    await check(900);
    // Reopening with a pointer permits choosing the same entry again.
    await picker.dispatchEvent("pointerdown");
    await expect(picker).toHaveValue("");
    await picker.selectOption("180");
    await check(181);
    // Keyboard navigation retains the native selection and Enter behavior.
    await picker.focus();
    await expect(picker).toHaveValue("");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveValue("180");
    await check(181);
    // Seeks preserve a running replay as well as a paused one.
    await page.locator("#replay-play").click();
    await picker.selectOption("0");
    expect((await state(page)).paused).toBe(false);
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    await page.locator("#replay-play").click();
    await picker.selectOption("180");
    await check(181);
    await page.locator("#replay-exit").click();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });

test("recordings without card plays disable the picker and ignore play shortcuts", async ({
  page,
}) => {
  const live = new rules.Battle({ seed: 1, ai: false });
  while (live.tick < 900) live.step();
  await openReplay(page, live.exportReplay());
  await page.locator("#replay-play").click();
  await expect(
    page.getByRole("combobox", { name: "Card plays" }),
  ).toBeDisabled();
  await expect(page.locator("#replay-plays option")).toHaveText(
    "No recorded plays",
  );
  await page.locator("#arena-canvas canvas").focus();
  const time = (await state(page)).time;
  await page.keyboard.press("[");
  await page.keyboard.press("]");
  expect((await state(page)).time).toBe(time);
});
