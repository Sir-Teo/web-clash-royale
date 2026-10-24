import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { RecordEntry } from "../../src/game/profile";
import type { Replay } from "../../src/game/engine";
let rules: typeof import("../../src/game/engine");
const fixture = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
);
test.beforeAll(async ({}, info) => {
  const path = info.outputPath("replay-completion-rules.mjs");
  await build({
    stdin: {
      contents: 'export { Battle, STEP } from "./src/game/engine.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path,
  });
  rules = await import(pathToFileURL(path).href);
});
for (const viewer of ["blue", "red"] as const)
  test(`${viewer} replay restarts after a natural ending earlier than the file duration`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const canonical = new rules.Battle({
      replay: { ...fixture.replay, version: 5 },
    });
    while (!canonical.winner && canonical.tick < 9000) canonical.step();
    expect(canonical.winner).toBe("red");
    const actual = viewer === "red" ? "blue" : "red";
    const declared = canonical.tick + 600;
    const replay: Replay = {
      ...fixture.replay,
      version: 5,
      duration: declared,
      ...(viewer === "red" ? { perspective: "red" } : {}),
    };
    const record: RecordEntry = {
      id: 42,
      date: "2026-10-24T12:00:00.000Z",
      mode: "classic",
      winner: actual === "red" ? "blue" : "red",
      crowns: viewer === "red" ? [3, 0] : [0, 3],
      opponent: "Other King",
      opponentType: "friend",
      replay,
    };
    await page.addInitScript(
      (record) =>
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify({
            version: 1,
            name: "Replay King",
            seenTutorial: true,
            sound: false,
            history: [record],
          }),
        ),
      record,
    );
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).__arena);
    const before = await page.evaluate(() =>
      localStorage.getItem("browser-royale.profile.v1"),
    );
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator("[data-replay]").click();
    const seek = page.getByRole("slider", { name: "Replay timeline" });
    await seek.fill(
      String(Math.floor(((canonical.tick - 10) / declared) * 10_000) / 100),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.winner), {
        timeout: 15000,
      })
      .toBe(actual);
    const state = await page.evaluate(() => (window as any).__arena.state);
    expect(state.time).toBeCloseTo(canonical.time);
    expect(state.time).toBeLessThan(declared * rules.STEP);
    expect(state.actions).toBe(canonical.actions.length);
    await expect(seek).toHaveValue("100");
    await expect(
      page.getByRole("button", { name: "Restart replay", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Restart replay", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.time))
      .toBe(0);
    expect(
      await page.evaluate(() => (window as any).__arena.state.winner),
    ).toBeNull();
    await seek.focus();
    await seek.press("End");
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.winner))
      .toBe(actual);
    await expect(
      page.getByRole("button", { name: "Restart replay", exact: true }),
    ).toBeVisible();
    await page.locator("#replay-exit").click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("browser-royale.profile.v1"),
      ),
    ).toBe(before);
    expect(errors).toEqual([]);
  });
