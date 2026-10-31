import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import type { RecordEntry } from "../../src/game/profile";
import type { Team } from "../../src/game/engine";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/game/cards") &
  typeof import("../../src/network/perspective");
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena?.state);
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);

test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-side-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { CARD_MAP, PRESETS, STARTER_DECK } from "./src/game/cards.ts"; export { snapshot, perspective } from "./src/network/perspective.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});

function recording(red: boolean): RecordEntry {
  const battle = new rules.Battle({
    seed: 29,
    ai: false,
    deck: rules.PRESETS[1].deck,
    enemyDeck: rules.PRESETS[2].deck,
  });
  while (battle.tick < 300) {
    if (battle.tick === 0 || battle.tick === 90)
      for (const team of ["blue", "red"] as const) {
        const player = battle.players[team];
        const slot = player.hand.findIndex(
          (id) =>
            rules.CARD_MAP[id].kind === "troop" &&
            rules.CARD_MAP[id].cost <= player.elixir,
        );
        if (slot < 0) {
          expect(battle.tick).toBe(90);
          continue;
        }
        expect(
          battle.play(
            team,
            slot,
            team === "blue" ? 4 : 14,
            team === "blue" ? 24 : 8,
          ).ok,
        ).toBe(true);
      }
    battle.step();
  }
  return {
    id: 99,
    date: "2026-10-31T12:00:00.000Z",
    playerName: "Recorded Captain",
    opponent: "Rival Captain",
    opponentType: red ? "friend" : "ai",
    mode: battle.mode,
    winner: red ? "blue" : "red",
    crowns: [0, 0],
    replay: {
      ...battle.exportReplay(),
      ...(red ? { perspective: "red" } : {}),
    },
  };
}

async function expectView(
  page: Page,
  record: RecordEntry,
  team: Team,
  tick: number,
) {
  const canonical = new rules.Battle({ replay: record.replay });
  while (canonical.tick < tick) canonical.step();
  const expected = rules.perspective(rules.snapshot(canonical), team);
  await expect
    .poll(async () => (await state(page)).time)
    .toBeCloseTo(tick / 30, 5);
  const actual = await state(page);
  expect(actual.hand).toEqual(expected.players.blue.hand);
  expect(actual.elixir).toBeCloseTo(expected.players.blue.elixir, 6);
  expect(
    actual.units.map(({ id, team, hp, card }: any) => ({ id, team, hp, card })),
  ).toEqual(
    expected.entities.map(({ id, team, hp, card }) => ({
      id,
      team,
      hp,
      card,
    })),
  );
  for (const [index, entity] of expected.entities.entries()) {
    // V8 and WebKit can differ at the final floating-point bit.
    expect(actual.units[index].x).toBeCloseTo(entity.x, 10);
    expect(actual.units[index].y).toBeCloseTo(entity.y, 10);
  }
}

for (const red of [false, true])
  for (const entry of ["local", "shared"] as const)
    test(`${entry} ${red ? "red" : "blue"} recording switches sides through seeks, endings and restart`, async ({
      page,
    }, info) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const record = recording(red);
      await page.addInitScript(
        ({ key, record, entry }) => {
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              name: "Local King",
              sound: false,
              music: false,
              seenTutorial: true,
              history: entry === "local" ? [record] : [],
            }),
          );
        },
        { key, record, entry },
      );
      if (info.project.name !== "desktop")
        await page.setViewportSize({ width: 320, height: 740 });
      await page.goto("/");
      await expect
        .poll(async () => (await state(page))?.loadedCards, { timeout: 60000 })
        .toBe(expectedCards);
      await expect(page.locator("#replay-side")).toBeHidden();
      const before = await saved(page);
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
      if (entry === "shared") {
        await page.locator("#replay-file").setInputFiles({
          name: "replay-side.json",
          mimeType: "application/json",
          buffer: Buffer.from(
            JSON.stringify({
              format: "browser-royale-replay",
              version: 1,
              playerName: record.playerName,
              match: {
                date: record.date,
                mode: record.mode,
                winner: record.winner,
                crowns: record.crowns,
                opponent: record.opponent,
                opponentType: record.opponentType,
                replay: record.replay,
              },
            }),
          ),
        });
        await page
          .getByRole("button", { name: "Watch shared replay", exact: true })
          .click();
      } else await page.locator("[data-replay]").click();
      const side = page.getByRole("button", {
        name: "View opponent side",
        exact: true,
      });
      await expect(side).toHaveAttribute("aria-pressed", "false");
      await page
        .getByRole("button", { name: "Pause replay", exact: true })
        .click();
      await page.locator("#replay-speed").click();
      await page.locator("#replay-seek").fill("50");
      await expectView(page, record, red ? "red" : "blue", 150);
      const originalPlays = await page
        .locator("#replay-plays option")
        .allTextContents();
      await side.focus();
      await side.press("Enter");
      await expect(side).toBeFocused();
      await expect(side).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        "Rival Captain",
      );
      await expect(page.locator(".competitor.enemy b")).toHaveText(
        "Recorded Captain",
      );
      await expect(page.locator("#replay-speed")).toHaveText("2×");
      expect((await state(page)).paused).toBe(true);
      await expectView(page, record, red ? "blue" : "red", 150);
      expect(
        await page.locator("#replay-plays option").allTextContents(),
      ).not.toEqual(originalPlays);
      await side.press("Space");
      await expect(side).toHaveAttribute("aria-pressed", "false");
      await expectView(page, record, red ? "red" : "blue", 150);
      // A pending slider input must keep its latest target when the side changes.
      await page
        .locator("#replay-seek")
        .evaluate((slider: HTMLInputElement) => {
          slider.value = "70";
          slider.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await side.click();
      await expectView(page, record, red ? "blue" : "red", 210);
      if (!red && entry === "local") {
        for (const viewport of [
          { width: 320, height: 740 },
          { width: 390, height: 844 },
          { width: 844, height: 390 },
          { width: 740, height: 360 },
        ]) {
          await page.setViewportSize(viewport);
          expect(
            await page
              .locator(".arena-heading")
              .evaluate(
                (heading) => heading.scrollWidth <= heading.clientWidth + 1,
              ),
          ).toBe(true);
          const bounds = (await side.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: info.outputPath("opponent-replay-side.png"),
          animations: "disabled",
        });
        const supported = await page
          .locator("#arena-canvas canvas")
          .evaluate((canvas) => {
            const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
            const extension = gl.getExtension("WEBGL_lose_context");
            (window as any).__replaySideGraphics = { gl, extension };
            extension?.loseContext();
            return !!extension;
          });
        expect(supported).toBe(true);
        await expect
          .poll(async () => (await state(page)).graphicsAvailable)
          .toBe(false);
        await expect(side).toBeDisabled();
        await page.evaluate(() =>
          (window as any).__replaySideGraphics.extension.restoreContext(),
        );
        await expect(side).toBeEnabled({ timeout: 45000 });
        await expect(side).toHaveAttribute("aria-pressed", "true");
        await expectView(page, record, "red", 210);
        await page.locator("#replay-seek").fill("10");
        await page
          .getByRole("button", { name: "Resume replay", exact: true })
          .click();
        const runningTime = (await state(page)).time;
        await side.click();
        expect((await state(page)).paused).toBe(false);
        await expect(page.locator("#replay-speed")).toHaveText("2×");
        await expect
          .poll(async () => (await state(page)).time)
          .toBeGreaterThan(runningTime);
        await page
          .getByRole("button", { name: "Pause replay", exact: true })
          .click();
        await side.click();
        await expect(side).toHaveAttribute("aria-pressed", "true");
      }
      await page.locator("#replay-seek").fill("100");
      await expect(
        page.getByRole("button", { name: "Restart replay", exact: true }),
      ).toBeVisible();
      expect((await state(page)).winner).toBe(red ? "red" : "blue");
      await expect(
        page.getByRole("img", { name: /Match over\. Rival Captain:/ }),
      ).toBeVisible({ timeout: 30000 });
      await side.click();
      expect((await state(page)).winner).toBe(record.winner);
      await expect(
        page.getByRole("img", { name: /Match over\. Recorded Captain:/ }),
      ).toBeVisible();
      await side.click();
      await page
        .getByRole("button", { name: "Restart replay", exact: true })
        .click();
      await expect(page.locator("#replay-speed")).toHaveText("2×");
      await expect(side).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        "Rival Captain",
      );
      await side.click();
      await expect(page.locator(".match-bottom .player-name")).toHaveText(
        "Recorded Captain",
      );
      await page.locator("#replay-exit").click();
      await expect(side).toBeHidden();
      await expect(page.locator(".player-card .player-name")).toHaveText(
        "Local King",
      );
      expect(await saved(page)).toBe(before);
      if (entry === "shared") {
        await expect(
          page.getByRole("heading", { name: "Shared replay", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await page.locator("#battle-button").click();
      await expect(side).toBeHidden();
      expect(errors).toEqual([]);
    });
