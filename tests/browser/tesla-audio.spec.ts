import { expectedBuildings } from "./native-assets";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  observeCombatAudio,
  playedCombatAudio,
  replaySeekValue,
} from "./audio-helpers";

for (const perspective of ["blue", "red"] as const)
  test(`${perspective} replay Tesla opens and retracts once with native transition audio`, async ({
    page,
  }, info) => {
    const path = info.outputPath("tesla-rules.mjs");
    await build({
      stdin: {
        contents:
          'export { Battle, other } from "./src/game/engine.ts"; export { combatAudioPlan } from "./src/game/combat-audio.ts";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: path,
    });
    const { Battle, other, combatAudioPlan } = (await import(
      pathToFileURL(path).href
    )) as typeof import("../../src/game/engine") &
      typeof import("../../src/game/combat-audio");
    const fixture = JSON.parse(
      readFileSync("tests/fixtures/combat-v2-replay.json", "utf8"),
    );
    const replay = { ...fixture.replay, version: 5, perspective };
    const battle = new Battle({ replay });
    while (
      !battle.audioEvents.some((e) => e.phase === "hide") &&
      !battle.winner
    )
      battle.step();
    const transitions = battle.audioEvents.filter(
      (e) => e.phase === "appear" || e.phase === "hide",
    );
    expect(transitions.map((e) => e.phase)).toEqual(["appear", "hide"]);
    const expected = transitions.map((event) => ({
      ...combatAudioPlan(
        event.profile,
        event.phase,
        replay.seed ^ event.id,
        perspective === "blue" ? event.team : other(event.team),
      )[0],
      time: event.time,
    }));
    const files = expected.map((cue) => `/assets/audio/${cue.file}.ogg`);
    expect(files).toEqual([
      "/assets/audio/tesla_open_02.ogg",
      "/assets/audio/tesla_close_02.ogg",
    ]);
    await observeCombatAudio(page);
    await page.addInitScript(
      (saved) =>
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify(saved),
        ),
      {
        version: 1,
        sound: true,
        music: false,
        seenTutorial: true,
        battles: 1,
        history: [
          {
            id: 1,
            date: "2026-10-22T12:00:00.000Z",
            mode: replay.mode,
            winner: "red",
            crowns: [0, 3],
            replay,
          },
        ],
      },
    );
    await page.goto("/");
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).__arena?.state.loadedBuildings),
        { timeout: 60000 },
      )
      .toBe(expectedBuildings);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator('[data-replay="0"]').click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const seek = page.getByRole("slider", { name: "Replay timeline" });
    await seek.fill(
      replaySeekValue(((expected[0].time * 30 - 30) / replay.duration) * 100),
    );
    expect(await playedCombatAudio(page, files)).toEqual([]);
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await playedCombatAudio(page, files)).filter(
            (e: any) => e.outcome === "playing",
          ).length,
        { timeout: 20000 },
      )
      .toBe(2);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const played = await playedCombatAudio(page, files);
    expect(played.map((e: any) => e.path)).toEqual(files);
    for (const [index, cue] of expected.entries()) {
      expect(played[index].outcome).toBe("playing");
      expect(played[index].volume).toBeCloseTo(cue.volume);
      expect(played[index].rate).toBeCloseTo(cue.pitch);
      expect(played[index].time).toBeGreaterThanOrEqual(cue.time);
      expect(played[index].time).toBeLessThan(cue.time + 0.6);
      expect(played[index].paused).toBe(true);
    }
    await seek.fill("90");
    await seek.fill("0");
    await page.waitForTimeout(250);
    expect((await playedCombatAudio(page, files)).length).toBe(2);
    expect(
      (await playedCombatAudio(page, files)).every((e: any) => e.paused),
    ).toBe(true);
  });
