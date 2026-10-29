import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import type { Replay } from "../../src/game/engine";
import type { RecordEntry } from "../../src/game/profile";

let rules: typeof import("../../src/game/engine") &
  typeof import("../../src/game/cards") &
  typeof import("../../src/game/replay-file");
test.beforeAll(async ({}, info) => {
  const path = info.outputPath("replay-boundary-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle, STEP } from "./src/game/engine.ts"; export { CARD_MAP } from "./src/game/cards.ts"; export { exportReplayFile } from "./src/game/replay-file.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path,
  });
  rules = await import(pathToFileURL(path).href);
});

for (const scenario of [
  { name: "saved blue-side", ticks: 10, team: "blue", shared: false },
  { name: "shared red-side", ticks: 10, team: "red", shared: true },
  { name: "zero-duration", ticks: 0, team: "blue", shared: true },
] as const)
  test(`${scenario.name} replay retains its final card without an extra simulation step`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const live = new rules.Battle({ seed: 1, ai: false });
    const originalHand = [...live.players[scenario.team].hand];
    for (let i = 0; i < scenario.ticks; i++) live.step();
    const player = live.players[scenario.team];
    const slot = player.hand.findIndex(
      (id) =>
        rules.CARD_MAP[id].kind === "troop" &&
        rules.CARD_MAP[id].cost <= player.elixir,
    );
    expect(
      live.play(
        scenario.team,
        slot,
        scenario.team === "blue" ? 4 : 14,
        scenario.team === "blue" ? 22 : 10,
      ).ok,
    ).toBe(true);
    const expected = {
      hand: [...player.hand],
      elixir: player.elixir,
      time: scenario.ticks * rules.STEP,
    };
    live.finish(scenario.team === "blue" ? "red" : "blue", "Surrender");
    const replay: Replay = {
      ...live.exportReplay(),
      ...(scenario.team === "red" ? { perspective: "red" } : {}),
    };
    const record: RecordEntry = {
      id: 42,
      date: "2026-10-24T12:00:00.000Z",
      mode: "classic",
      winner: "red",
      crowns: [0, 0],
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
            name: "Boundary King",
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
    if (scenario.shared) {
      await page.locator("#replay-file").setInputFiles({
        name: "boundary-replay.json",
        mimeType: "application/json",
        buffer: Buffer.from(rules.exportReplayFile(record, "Recorded King")),
      });
      await page
        .getByRole("button", { name: "Watch shared replay", exact: true })
        .click();
    } else await page.locator("[data-replay]").click();
    const state = () =>
      page.evaluate(() => {
        const s = (window as any).__arena.state;
        return {
          troops: s.troops,
          hand: s.hand,
          elixir: s.elixir,
          time: s.time,
          winner: s.winner,
          actions: s.actions,
        };
      });
    const seek = page.getByRole("slider", { name: "Replay timeline" });
    await seek.focus();
    await seek.press("End");
    await expect.poll(async () => (await state()).troops).toBe(1);
    const result = await state();
    expect(result.hand).toEqual(expected.hand);
    expect(result.elixir).toBeCloseTo(expected.elixir);
    expect(result.time).toBe(expected.time);
    expect(result.winner).toBe("red");
    expect(result.actions).toBe(1);
    const plays = page.getByRole("combobox", { name: "Card plays" });
    await expect(plays.locator("option")).toHaveCount(2);
    await plays.selectOption(String(scenario.ticks));
    expect(await state()).toEqual(result);
    await page.waitForTimeout(180);
    expect(await state()).toEqual(result);
    await page
      .getByRole("button", { name: "Restart replay", exact: true })
      .click();
    if (scenario.ticks) {
      await expect.poll(async () => (await state()).time).toBe(0);
      expect((await state()).troops).toBe(0);
      expect((await state()).hand).toEqual(originalHand);
    }
    await seek.focus();
    await seek.press("End");
    await expect.poll(async () => (await state()).troops).toBe(1);
    expect(await state()).toEqual(result);
    await page.locator("#replay-exit").click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("browser-royale.profile.v1"),
      ),
    ).toBe(before);
    expect(errors).toEqual([]);
  });
