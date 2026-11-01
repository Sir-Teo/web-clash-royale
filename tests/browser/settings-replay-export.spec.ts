import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { RecordEntry } from "../../src/game/profile";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
let rules: typeof import("../../src/game/replay-file") &
  typeof import("../../src/game/engine");
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), key);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("settings-replay-export-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { exportReplayFile, importReplayFile, replayFileName } from "./src/game/replay-file.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});
for (const shared of [false, true]) {
  test(`exports the complete original ${shared ? "shared red-side" : "local blue-side"} replay from settings after seeking and switching sides without saving its draft`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    const record: RecordEntry = {
      id: 42,
      date: "2026-11-01T00:00:00Z",
      mode: fixture.mode,
      winner: "red",
      crowns: [0, 3],
      opponent: "Other King",
      opponentType: "friend",
      matchId: "private-room-id",
      ...(shared ? { playerName: "Original Pilot" } : {}),
      replay: {
        ...fixture,
        version: 5,
        rulesFamily: "origin",
        perspective: shared ? "red" : "blue",
      },
    };
    const recordedName = shared ? "Original Pilot" : "Local Captain";
    const foreign = {
      ...record,
      playerName: "Foreign History",
      opponent: "Foreign Rival",
      replay: { ...record.replay, seed: record.replay.seed + 1 },
    };
    await page.addInitScript(
      ({ key, history }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Local Captain",
            sound: false,
            music: false,
            seenTutorial: true,
            gold: 5432,
            trophies: 321,
            best: 400,
            wins: 4,
            battles: 12,
            crowns: 15,
            chests: ["gold"],
            history,
          }),
        ),
      { key, history: [shared ? foreign : record] },
    );
    await page.goto("/");
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
        { timeout: 60000 },
      )
      .toBe(expectedCards);
    const raw = await saved(page);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    if (shared) {
      await page
        .locator("#replay-file")
        .setInputFiles({
          name: "original-replay.json",
          mimeType: "application/json",
          buffer: Buffer.from(rules.exportReplayFile(record, recordedName)),
        });
      await page.locator("#watch-shared-replay").click();
    } else await page.locator("[data-replay]").click();
    await page.locator("#replay-speed").click();
    await page.locator("#replay-seek").fill("10");
    await page.locator("#replay-side").click();
    if (shared && !(await state(page)).paused)
      await page.locator("#replay-play").click();
    await page.locator("#arena-settings").click();
    const paused = await state(page);
    expect(paused.paused).toBe(true);
    expect(paused.speed).toBe(2);
    await page.locator("#player-name").fill("Unsubmitted Draft");
    await page.locator("#sound-setting").check();
    const button = page.locator("#settings-export-replay");
    if (!shared) {
      await page.evaluate(() => {
        const original = URL.createObjectURL;
        (window as any).__restoreReplayDownload = () => {
          URL.createObjectURL = original;
        };
        URL.createObjectURL = () => {
          throw new DOMException("Downloads blocked", "NotAllowedError");
        };
      });
      await button.click();
      await expect(page.locator("#settings-export-replay-error")).toHaveText(
        "Downloads blocked",
      );
      await page.evaluate(() => (window as any).__restoreReplayDownload());
    }
    const pending = page.waitForEvent("download");
    await button.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(rules.replayFileName(record));
    const text = await readFile((await download.path())!, "utf8");
    const contents = JSON.parse(text);
    const expected = JSON.parse(rules.exportReplayFile(record, recordedName));
    expect(contents).toEqual(expected);
    expect(rules.importReplayFile(text).record.replay).toEqual(record.replay);
    expect(
      contents.match.replay.actions.some(
        (action: { tick: number }) =>
          action.tick > Math.round(paused.time * 30),
      ),
    ).toBe(true);
    expect(contents.match).not.toHaveProperty("matchId");
    expect(contents).not.toHaveProperty("profile");
    await expect(page.locator("#settings-export-replay-error")).toBeHidden();
    await expect(page.locator("#player-name")).toHaveValue("Unsubmitted Draft");
    await expect(page.locator("#sound-setting")).toBeChecked();
    expect((await state(page)).time).toBe(paused.time);
    expect((await state(page)).paused).toBe(true);
    expect(await saved(page)).toBe(raw);
    await button.scrollIntoViewIfNeeded();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("settings-replay-export.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    expect((await state(page)).paused).toBe(shared);
    await page.locator("#replay-exit").click();
    if (shared) await page.locator("#shared-replay-back").click();
    else
      await page
        .getByRole("button", { name: "Battle log", exact: true })
        .click();
    await page
      .locator("#replay-file")
      .setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/json",
        buffer: Buffer.from(text),
      });
    await expect(
      page.locator(".shared-replay-names strong").first(),
    ).toHaveText(recordedName);
    await expect(page.locator(".shared-replay-names strong").last()).toHaveText(
      record.opponent!,
    );
    await page.locator("#watch-shared-replay").click();
    await page.locator("#replay-play").click();
    await expect(page.locator(".match-bottom .player-name")).toHaveText(
      recordedName,
    );
    const expectedBattle = new rules.Battle({ replay: record.replay });
    expect((await state(page)).hand).toEqual(
      expectedBattle.players[shared ? "red" : "blue"].hand,
    );
    expect(await saved(page)).toBe(raw);
  });
}
