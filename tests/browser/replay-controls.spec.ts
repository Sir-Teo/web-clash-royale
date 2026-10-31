import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { Replay } from "../../src/game/engine";
let rules: typeof import("../../src/game/engine");
const replay: Replay = {
  ...JSON.parse(readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"))
    .replay,
  version: 5,
};
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-control-rules.mjs");
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
  test(`${viewer} replay skips preserve canonical state, playback controls and phone layout`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, replay, viewer }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Replay Navigator",
            sound: false,
            music: false,
            seenTutorial: true,
            history: [
              {
                id: 42,
                date: "2026-10-24T12:00:00.000Z",
                mode: replay.mode,
                winner: viewer === "red" ? "blue" : "red",
                crowns: viewer === "red" ? [3, 0] : [0, 3],
                opponent: "Other King",
                opponentType: "friend",
                replay: { ...replay, perspective: viewer },
              },
            ],
          }),
        );
      },
      { key, replay, viewer },
    );
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).__arena);
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-replay]").click();
    await page.locator("#replay-play").click();
    const back = page.getByRole("button", {
      name: "Back 10 seconds",
      exact: true,
    });
    const forward = page.getByRole("button", {
      name: "Forward 10 seconds",
      exact: true,
    });
    const seek = page.getByRole("slider", {
      name: "Replay timeline",
      exact: true,
    });
    const canvas = page.locator("#arena-canvas canvas");
    async function check(tick: number) {
      const expected = new rules.Battle({ replay });
      while (expected.tick < tick && !expected.winner) expected.step();
      await expect
        .poll(async () => (await state(page)).time)
        .toBe(expected.time);
      const actual = await state(page);
      expect(actual.time).toBe(expected.time);
      expect(actual.hand).toEqual(expected.players[viewer].hand);
      expect(actual.elixir).toBeCloseTo(expected.players[viewer].elixir, 9);
      expect(actual.actions).toBe(expected.actions.length);
      expect(actual.troops).toBe(
        expected.entities.filter((e) => e.kind === "troop").length,
      );
      expect(actual.paused).toBe(true);
    }
    await canvas.focus();
    await page.keyboard.press("Home");
    await expect(canvas).toHaveAttribute(
      "aria-keyshortcuts",
      /Shift\+ArrowLeft Shift\+ArrowRight/,
    );
    await page.keyboard.press("Shift+ArrowLeft");
    await check(0);
    await page.keyboard.press("Shift+ArrowRight");
    await check(30);
    await page.keyboard.press("Shift+ArrowRight");
    await check(60);
    await page.keyboard.press("Shift+ArrowLeft");
    await check(30);
    await page.keyboard.press("Home");
    await back.click();
    await check(0);
    await forward.click();
    await check(300);
    await forward.focus();
    await page.keyboard.press("Space");
    await check(600);
    await expect(page.locator("#replay-clock")).toHaveText("0:20 / 1:31");
    await expect(seek).toHaveAttribute("aria-valuetext", "0:20 of 1:31");
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await check(900);
    await page.keyboard.press("ArrowLeft");
    await check(600);
    await page.keyboard.press("Control+ArrowRight");
    await check(600);
    await page.keyboard.down("Shift");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Shift");
    await check(630);
    await page.keyboard.press("Shift+ArrowLeft");
    await check(600);
    // Holding a shortcut must not continuously rebuild a long replay.
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await check(900);
    await back.click();
    await check(600);
    // The range retains its native fine-grained keyboard step.
    await seek.focus();
    await page.keyboard.press("ArrowRight");
    expect((await state(page)).time).toBeLessThan(20.1);
    await page.keyboard.press("Shift+ArrowRight");
    expect((await state(page)).time).toBeLessThan(20.5);
    await canvas.focus();
    await page.keyboard.press("Home");
    await forward.click();
    await forward.click();
    await check(600);
    await page.locator("#arena-settings").click();
    await page.locator("#player-name").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await check(600);
    await page.keyboard.press("Escape");
    await page.locator("#replay-speed").click();
    await expect(page.locator("#replay-speed")).toHaveAttribute(
      "aria-label",
      "Playback speed: 2×",
    );
    await forward.click();
    await check(900);
    await page.locator("#replay-play").click();
    await expect.poll(async () => (await state(page)).time).toBeGreaterThan(30);
    const finePlaying = (await state(page)).time;
    await canvas.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(async () => (await state(page)).time)
      .toBeGreaterThanOrEqual(finePlaying + 1);
    expect((await state(page)).paused).toBe(false);
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    const playing = (await state(page)).time;
    await forward.click();
    const advanced = await state(page);
    expect(advanced.time).toBeGreaterThanOrEqual(playing + 10);
    expect(advanced.paused).toBe(false);
    await expect(page.locator("#replay-speed")).toHaveText("2×");
    await page.locator("#replay-play").click();
    await canvas.focus();
    await page.keyboard.press("End");
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Restart replay",
    );
    await expect(seek).toHaveValue("100");
    await expect(seek).toHaveAttribute("aria-valuetext", /replay complete$/);
    const end = (await state(page)).time;
    await page.keyboard.press("Shift+ArrowRight");
    expect((await state(page)).time).toBe(end);
    await page.keyboard.press("Shift+ArrowLeft");
    await expect
      .poll(async () => (await state(page)).time)
      .toBeCloseTo(end - 1, 9);
    expect((await state(page)).paused).toBe(true);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await state(page)).time).toBe(end);
    await forward.click();
    expect((await state(page)).time).toBe(end);
    await back.click();
    expect((await state(page)).time).toBeCloseTo(end - 10, 9);
    expect((await state(page)).winner).toBeNull();
    await expect(page.locator("#replay-play")).toHaveAttribute(
      "aria-label",
      "Resume replay",
    );
    await canvas.focus();
    await page.keyboard.press("Home");
    await forward.click();
    await forward.click();
    await check(600);
    if (viewer === "blue") {
      for (const size of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 568, height: 320 },
        { width: 667, height: 375 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size);
        await expect
          .poll(() =>
            page
              .locator(".arena-panel")
              .evaluate((e) => Math.round(e.getBoundingClientRect().height)),
          )
          .toBe(size.height);
        const bounds = await page
          .locator(
            ".replay-actions button,#replay-plays,#replay-seek,#replay-clock,#arena-canvas",
          )
          .evaluateAll((nodes) =>
            nodes.map((e) => {
              const r = e.getBoundingClientRect();
              return { id: e.id, x: r.x, y: r.y, w: r.width, h: r.height };
            }),
          );
        for (const b of bounds) {
          expect(b.x, b.id).toBeGreaterThanOrEqual(0);
          expect(b.y, b.id).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w, b.id).toBeLessThanOrEqual(size.width + 1);
          expect(b.y + b.h, b.id).toBeLessThanOrEqual(size.height + 1);
          if (!["replay-seek", "replay-clock", "arena-canvas"].includes(b.id)) {
            expect(b.w, b.id).toBeGreaterThanOrEqual(44);
            expect(b.h, b.id).toBeGreaterThanOrEqual(44);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(size.width);
        if (size.width === 320 || size.width === 667)
          await page.screenshot({
            path: info.outputPath(`replay-${size.width}.png`),
          });
      }
    }
    await page.locator("#replay-exit").click();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });
