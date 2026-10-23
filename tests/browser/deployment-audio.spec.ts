import { expectedEffects } from "./native-assets";
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
  test(`${perspective} replay deployment plays its native voice and delayed reload without replaying sought history`, async ({
    page,
  }, info) => {
    const path = info.outputPath("deployment-rules.mjs");
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
      readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
    );
    const replay = { ...fixture.replay, version: 5, perspective };
    const battle = new Battle({ replay });
    while (
      !battle.audioEvents.some(
        (e) => e.profile === "musketeer" && e.phase === "spawn",
      ) &&
      !battle.winner
    )
      battle.step();
    const spawned = battle.audioEvents.find(
      (e) => e.profile === "musketeer" && e.phase === "spawn",
    )!;
    expect(spawned).toBeDefined();
    const expected = combatAudioPlan(
      "musketeer",
      "spawn",
      replay.seed ^ spawned.id,
      perspective === "blue" ? spawned.team : other(spawned.team),
    );
    expect(expected.map((cue) => [cue.file, cue.delay])).toEqual([
      ["musketeer_deploy_01", 0],
      ["musketeer_reload_01", 1.2],
    ]);
    const files = expected.map((cue) => `/assets/audio/${cue.file}.ogg`);
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
        () => page.evaluate(() => (window as any).__arena?.state.loadedEffects),
        { timeout: 60000 },
      )
      .toBe(expectedEffects);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator('[data-replay="0"]').click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const seek = page.getByRole("slider", { name: "Replay timeline" });
    await seek.fill(
      replaySeekValue(
        (Math.max(0, spawned.time * 30 - 30) / replay.duration) * 100,
      ),
    );
    expect(await playedCombatAudio(page, files)).toEqual([]);
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await playedCombatAudio(page, files)).filter(
            (entry: any) => entry.outcome === "playing",
          ).length,
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(2);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const played = await playedCombatAudio(page, files);
    expect(played.slice(0, 2).map((entry: any) => entry.path)).toEqual(files);
    for (const [index, cue] of expected.entries()) {
      expect(played[index].outcome).toBe("playing");
      expect(played[index].volume).toBeCloseTo(cue.volume);
      expect(played[index].rate).toBeCloseTo(cue.pitch);
      expect(played[index].time).toBeGreaterThanOrEqual(
        spawned.time + cue.delay,
      );
      expect(played[index].time).toBeLessThan(spawned.time + cue.delay + 0.6);
    }
    expect(played.every((entry: any) => entry.paused)).toBe(true);
    await seek.fill("90");
    await seek.fill("0");
    await page.waitForTimeout(250);
    expect((await playedCombatAudio(page, files)).length).toBe(played.length);
    expect(
      (await playedCombatAudio(page, files)).every(
        (entry: any) => entry.paused,
      ),
    ).toBe(true);
  });
