import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { Replay } from "../../src/game/engine";
let rules: typeof import("../../src/game/engine");
const fixtures = [
  "legacy-replay.json",
  "combat-v2-replay.json",
  "combat-v3-replay.json",
  "combat-v4-replay.json",
].map(
  (name) =>
    JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8")).replay as Replay,
);
fixtures.push({ ...fixtures[3], version: 5 });
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-seeking-rules.mjs");
  await build({
    stdin: {
      contents: 'export { Battle, STEP } from "./src/game/engine.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});
for (const viewer of ["blue", "red"] as const)
  test(`${viewer} seeks backward and forward through every historical rules version and resumes correctly`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, fixtures, viewer }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Seek King",
            sound: false,
            music: false,
            seenTutorial: true,
            history: fixtures.map((replay, index) => ({
              id: index + 1,
              date: "2026-10-24T12:00:00.000Z",
              mode: replay.mode,
              winner: viewer === "red" ? "blue" : "red",
              crowns: viewer === "red" ? [3, 0] : [0, 3],
              opponent: `Rules ${replay.version}`,
              opponentType: "friend",
              replay: { ...replay, perspective: viewer },
            })),
          }),
        );
      },
      { key, fixtures, viewer },
    );
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).__arena);
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    function expected(replay: Replay, tick: number) {
      const source = new rules.Battle({ replay });
      while (source.tick < tick && !source.winner) source.step();
      if (source.tick >= replay.duration && !source.winner)
        source.finish("red", "Replay complete");
      const winner =
        source.winner && source.winner !== "draw" && viewer === "red"
          ? source.winner === "red"
            ? "blue"
            : "red"
          : source.winner;
      return {
        time: source.time,
        winner,
        hand: source.players[viewer].hand,
        elixir: source.players[viewer].elixir,
        troops: source.entities.filter((entity) => entity.kind === "troop")
          .length,
        actions: source.actions.length,
      };
    }
    for (const [index, replay] of fixtures.entries()) {
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      await page.locator(`[data-replay="${index}"]`).click();
      await page
        .getByRole("button", { name: "Pause replay", exact: true })
        .click();
      const seek = page.getByRole("slider", { name: "Replay timeline" });
      for (const percent of [75, 25, 0, 100, 25]) {
        await seek.fill(String(percent));
        const actual = await state(page),
          target = Math.floor((replay.duration * percent) / 100),
          wanted = expected(replay, target);
        expect(actual.rulesVersion).toBe(replay.version);
        expect(actual.paused).toBe(true);
        expect(actual.time).toBe(wanted.time);
        expect(actual.winner).toBe(wanted.winner);
        expect(actual.hand).toEqual(wanted.hand);
        expect(actual.elixir).toBeCloseTo(wanted.elixir, 9);
        expect(actual.troops).toBe(wanted.troops);
        expect(actual.actions).toBe(wanted.actions);
        expect(actual.enemyDeck).toEqual(
          viewer === "red" ? replay.deck : replay.enemyDeck,
        );
        await expect(page.locator("#replay-play")).toHaveAttribute(
          "aria-label",
          wanted.winner ? "Restart replay" : "Resume replay",
        );
      }
      const start = (await state(page)).time;
      await page
        .getByRole("button", { name: "Resume replay", exact: true })
        .click();
      await expect
        .poll(async () => (await state(page)).time)
        .toBeGreaterThan(start);
      await page
        .getByRole("button", { name: "Pause replay", exact: true })
        .click();
      const actual = await state(page),
        wanted = expected(replay, Math.round(actual.time / rules.STEP));
      expect(actual.hand).toEqual(wanted.hand);
      expect(actual.actions).toBe(wanted.actions);
      expect(actual.troops).toBe(wanted.troops);
      expect(actual.elixir).toBeCloseTo(wanted.elixir, 9);
      await page.locator("#replay-exit").click();
    }
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });
