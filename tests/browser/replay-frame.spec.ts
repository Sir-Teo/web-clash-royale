import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { Replay, Team } from "../../src/game/engine";
import { expectedCards } from "./native-assets";

test.use({ serviceWorkers: "block" });
const key = "browser-royale.profile.v1";
const source = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const replay: Replay = {
  ...source,
  version: 5,
  duration: 600,
  actions: source.actions.slice(0, 3),
};
let rules: typeof import("../../src/game/engine");
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-frame-rules.mjs");
  await build({
    stdin: {
      contents: 'export { Battle } from "./src/game/engine.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
  });
  rules = await import(pathToFileURL(file).href);
});
async function openReplay(page: Page, perspective: Team, recording = replay) {
  await page.addInitScript(
    ({ key, replay }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          name: "Frame Student",
          sound: false,
          music: false,
          seenTutorial: true,
          history: [
            {
              id: 42,
              date: "2026-11-01T00:00:00Z",
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
    { key, replay: { ...recording, perspective } },
  );
  await page.goto("/");
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__arena?.state.loadedCards),
      { timeout: 60000 },
    )
    .toBe(expectedCards);
  const raw = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator("[data-replay]").click();
  if (!(await state(page)).paused) await page.locator("#replay-play").click();
  return raw;
}
for (const perspective of ["blue", "red"] as const) {
  test(`${perspective} replay steps exact frames through commands, keeps view and speed, and protects native controls`, async ({
    page,
  }, info) => {
    test.setTimeout(150000);
    if (info.project.name !== "desktop")
      await page.setViewportSize({ width: 320, height: 740 });
    const raw = await openReplay(page, perspective);
    const canvas = page.locator("#arena-canvas canvas");
    async function check(tick: number, viewed = perspective) {
      const expected = new rules.Battle({ replay });
      while (expected.tick < tick && !expected.winner) expected.step();
      const actual = await state(page);
      expect(actual.time).toBe(expected.time);
      expect(actual.hand).toEqual(expected.players[viewed].hand);
      expect(actual.elixir).toBeCloseTo(expected.players[viewed].elixir, 9);
      expect(actual.actions).toBe(expected.actions.length);
      expect(actual.paused).toBe(true);
      expect(actual.speed).toBe(2);
    }
    await canvas.focus();
    await page.keyboard.press("Home");
    await page.locator("#replay-speed").click();
    await canvas.focus();
    await page.keyboard.press(".");
    await check(1);
    await page.keyboard.down("Period");
    await check(2);
    await page.keyboard.down("Period");
    await check(2);
    await page.keyboard.up("Period");
    await page.keyboard.press(",");
    await check(1);
    const queuedFrame = await page.evaluate(() => {
      const seek = document.querySelector<HTMLInputElement>("#replay-seek")!;
      seek.value = "33.42";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#arena-settings")!.click();
      const note = document.querySelector("#replay-frame-note")!.textContent;
      document.querySelector<HTMLButtonElement>("#replay-frame-next")!.click();
      return note;
    });
    expect(queuedFrame).toContain("Frame 200 of 600");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await check(201);
    await page.locator("#replay-seek").evaluate((input: HTMLInputElement) => {
      input.value = "21.5";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await check(129);
    await canvas.focus();
    await page.keyboard.press("Control+Period");
    await page.keyboard.press("Shift+Period");
    await check(129);
    await page.locator("#arena-settings").click();
    await page.locator("#player-name").fill("");
    await page.locator("#player-name").press(",");
    await page.locator("#player-name").press(".");
    await expect(page.locator("#player-name")).toHaveValue(",.");
    await check(129);
    await expect(page.locator("#replay-frame-note")).toContainText(
      "Frame 129 of 600",
    );
    await page.locator("#replay-frame-next").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(canvas).toBeFocused();
    await check(130);
    await page.locator("#replay-side").click();
    const other: Team = perspective === "blue" ? "red" : "blue";
    await canvas.focus();
    await page.keyboard.press(",");
    await check(129, other);
    await page.locator("#replay-play").click();
    await canvas.focus();
    const beforeStep = await canvas.evaluate((canvas) => {
      const time = (window as any).__arena.state.time;
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ".",
          code: "Period",
          bubbles: true,
          cancelable: true,
        }),
      );
      return Math.round(time * 30);
    });
    await check(beforeStep + 1, other);
    await page.keyboard.press("End");
    await check(600, other);
    await page.keyboard.press(".");
    await check(600, other);
    await page.locator("#arena-settings").click();
    await expect(page.locator("#replay-frame-next")).toBeDisabled();
    await page.locator("#replay-frame-previous").click();
    await check(599, other);
    await page.keyboard.press("Home");
    await page.locator("#replay-seek").focus();
    await page.keyboard.press(".");
    await check(0, other);
    await page.locator("#arena-settings").click();
    await expect(page.locator("#replay-frame-previous")).toBeDisabled();
    await expect(page.locator("#replay-frame-next")).toBeEnabled();
    await page.locator("#replay-frame-next").scrollIntoViewIfNeeded();
    expect(
      (await page.locator("#replay-frame-next").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("replay-frame-settings.png"),
      animations: "disabled",
    });
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      raw,
    );
  });
}
test("zero-duration replay frame controls retain its final-boundary command", async ({
  page,
}) => {
  const raw = await openReplay(page, "blue", {
    ...replay,
    duration: 0,
    actions: replay.actions.slice(0, 1),
  });
  await page.locator("#arena-settings").click();
  await expect(page.locator("#replay-frame-previous")).toBeDisabled();
  await expect(page.locator("#replay-frame-next")).toBeDisabled();
  await expect(page.locator("#replay-frame-note")).toContainText(
    "Frame 0 of 0",
  );
  await page.keyboard.press("Escape");
  await page.locator("#arena-canvas canvas").focus();
  await page.keyboard.press(".");
  await page.keyboard.press(",");
  expect((await state(page)).time).toBe(0);
  expect((await state(page)).actions).toBe(1);
  expect((await state(page)).paused).toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
});
