import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Replay } from "../../src/game/engine";

const replay: Replay = {
  ...JSON.parse(readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"))
    .replay,
  version: 16,
  rulesFamily: "origin",
};
let rules: typeof import("../../src/game/engine");
const key = "browser-royale.profile.v1";
const state = (page: Page) =>
  page.evaluate(() => (window as any).__arena.state);
test.beforeAll(async ({}, info) => {
  const file = info.outputPath("replay-scrubbing-rules.mjs");
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
  test(`${viewer} drag scrubbing rebuilds once for the latest requested position`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ replay, key, viewer }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            name: "Scrub King",
            sound: false,
            music: false,
            seenTutorial: true,
            history: [
              {
                id: 42,
                date: "2026-10-24T12:00:00.000Z",
                mode: replay.mode,
                winner: "red",
                crowns: [0, 0],
                opponent: "Other King",
                opponentType: "friend",
                replay: { ...replay, perspective: viewer },
              },
            ],
          }),
        ),
      { replay, key, viewer },
    );
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).__arena);
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-replay]").click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    await page.locator("#replay-speed").click();
    await page.evaluate(async () => {
      const modulePath = "/src/game/engine.ts";
      const { Battle } = await import(modulePath);
      const original = Battle.prototype.step;
      (window as any).__scrubSteps = 0;
      Battle.prototype.step = function () {
        (window as any).__scrubSteps++;
        return original.call(this);
      };
    });
    const wanted = (tick: number) => {
      const expected = new rules.Battle({ replay });
      while (expected.tick < tick && !expected.winner) expected.step();
      return expected;
    };
    await page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>("#replay-seek")!;
      slider.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
      for (const value of [20, 40, 60, 80, 10, 70, 30, 60, 50]) {
        slider.value = String(value);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const expected = wanted(Math.floor(replay.duration / 2));
    await expect.poll(async () => (await state(page)).time).toBe(expected.time);
    expect(await page.evaluate(() => (window as any).__scrubSteps)).toBe(
      expected.tick,
    );
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7 })),
    );
    const actual = await state(page);
    expect(actual.hand).toEqual(expected.players[viewer].hand);
    expect(actual.elixir).toBeCloseTo(expected.players[viewer].elixir, 9);
    expect(actual.actions).toBe(expected.actions.length);
    expect(actual.troops).toBe(
      expected.entities.filter((e) => e.kind === "troop").length,
    );
    expect(actual.paused).toBe(true);
    await expect(page.locator("#replay-speed")).toHaveText("2×");

    // Exercise the browser's trusted range drag and its final pointer release.
    const slider = page.locator("#replay-seek");
    await slider.evaluate((element) => {
      element.addEventListener(
        "input",
        () => {
          (window as any).__lastScrubInput = Number(
            (element as HTMLInputElement).value,
          );
        },
        { capture: true },
      );
    });
    const bounds = (await slider.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width * 0.2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.45,
      bounds.y + bounds.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    const percent = await page.evaluate(() => (window as any).__lastScrubInput);
    expect(typeof percent).toBe("number");
    const dragged = wanted(Math.floor((percent / 100) * replay.duration));
    await expect.poll(async () => (await state(page)).time).toBe(dragged.time);
    expect((await state(page)).paused).toBe(true);
    await expect(page.locator("#replay-speed")).toHaveText("2×");

    // A skip uses the requested position even before the queued frame runs.
    await page.evaluate(() => {
      (window as any).__scrubSteps = 0;
      const input = document.querySelector<HTMLInputElement>("#replay-seek")!;
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 8 }),
      );
      input.value = "25";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#replay-forward")!.click();
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8 }));
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const jumped = wanted(Math.floor(replay.duration / 4) + 300);
    expect((await state(page)).time).toBe(jumped.time);
    expect(await page.evaluate(() => (window as any).__scrubSteps)).toBe(
      jumped.tick,
    );

    await slider.fill("100");
    await expect(
      page.getByRole("button", { name: "Restart replay", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      (window as any).__scrubSteps = 0;
      const input = document.querySelector<HTMLInputElement>("#replay-seek")!;
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }),
      );
      input.value = "25";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#replay-play")!.click();
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect((await state(page)).time).toBe(0);
    expect((await state(page)).winner).toBeNull();
    expect(await page.evaluate(() => (window as any).__scrubSteps)).toBe(0);
    await expect(page.locator("#replay-speed")).toHaveText("1×");

    await page.evaluate(() => {
      (window as any).__scrubSteps = 0;
      const input = document.querySelector<HTMLInputElement>("#replay-seek")!;
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 10 }),
      );
      input.value = "75";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#replay-exit")!.click();
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect((await state(page)).screen).toBe("lobby");
    expect(await page.evaluate(() => (window as any).__scrubSteps)).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(errors).toEqual([]);
  });
