import { expectedEffects } from "./native-assets";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  observeCombatAudio,
  playedCombatAudio,
  decodeAudioFiles,
  replaySeekValue,
} from "./audio-helpers";

test("all imported native combat and lifecycle sound files decode in the browser", async ({
  page,
}, info) => {
  const manifest = JSON.parse(
    readFileSync("reference/client/combat-audio-manifest.json", "utf8"),
  );
  await page.goto("/");
  const decoded = await decodeAudioFiles(
    page,
    manifest.audioFiles.map((file: { path: string }) =>
      file.path.replace(/^public/, ""),
    ),
  );
  expect(decoded).toHaveLength(manifest.audioFiles.length);
  expect(
    decoded.every(
      (sound) => Number.isFinite(sound.duration) && sound.duration > 0,
    ),
  ).toBe(true);
  await info.attach("decoded-combat-audio.json", {
    body: JSON.stringify(decoded, null, 2),
    contentType: "application/json",
  });
});

test("a recorded Musketeer shot sounds at launch and impact, follows replay speed and stops on pause", async ({
  page,
}, info) => {
  const path = info.outputPath("combat-audio-rules.mjs");
  await build({
    stdin: {
      contents:
        'export { Battle } from "./src/game/engine.ts"; export { combatAudioPlan } from "./src/game/combat-audio.ts";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path,
  });
  const { Battle, combatAudioPlan } = (await import(
    pathToFileURL(path).href
  )) as typeof import("../../src/game/engine") &
    typeof import("../../src/game/combat-audio");
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
  );
  const replay = { ...fixture.replay, version: 5 };
  const battle = new Battle({ replay });
  while (
    !battle.audioEvents.some(
      (e) => e.profile === "musketeer" && e.phase === "impact",
    ) &&
    !battle.winner
  )
    battle.step();
  const impact = battle.audioEvents.find(
    (e) => e.profile === "musketeer" && e.phase === "impact",
  )!;
  expect(impact).toBeDefined();
  const launch = battle.audioEvents.find(
    (e) => e.actor === impact.actor && e.phase === "launch",
  )!;
  const expected = [launch, impact].flatMap((event) =>
    combatAudioPlan(
      event.profile,
      event.phase,
      replay.seed ^ event.id,
      event.team,
    ).map((cue) => ({ ...cue, time: event.time + cue.delay })),
  );
  expect(expected.map((cue) => cue.file)).toEqual([
    "musket_fire_02",
    "musket_impact_01",
  ]);
  const files = expected.map((cue) => `/assets/audio/${cue.file}.ogg`);
  await observeCombatAudio(page);
  await page.addInitScript(
    (saved) =>
      localStorage.setItem("browser-royale.profile.v1", JSON.stringify(saved)),
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
      { timeout: 30000 },
    )
    .toBe(expectedEffects);
  await page.getByRole("button", { name: "Battle log", exact: true }).click();
  await page.locator('[data-replay="0"]').click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const seek = page.getByRole("slider", { name: "Replay timeline" });
  await seek.fill(
    replaySeekValue(
      (Math.max(0, launch.time * 30 - 40) / replay.duration) * 100,
    ),
  );
  expect(await playedCombatAudio(page, files)).toEqual([]);
  await page.locator("#replay-speed").click();
  await page.locator("#replay-speed").click();
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
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  const played = await playedCombatAudio(page, files);
  expect(played.slice(0, 2).map((entry: any) => entry.path)).toEqual(files);
  for (const [index, cue] of expected.entries()) {
    expect(played[index].rate).toBeCloseTo(cue.pitch * 4);
    expect(played[index].volume).toBeCloseTo(cue.volume);
    expect(played[index].time).toBeGreaterThanOrEqual(cue.time);
    expect(played[index].time).toBeLessThan(cue.time + 0.6);
  }
  expect(played.every((entry: any) => entry.paused)).toBe(true);
  // Pausing may asynchronously reject an already-observed pending play promise.
  // Compare immutable calls and paused state, not the timing of promise settlement.
  const calls = (entries: any[]) =>
    entries.map(({ outcome: _outcome, ...entry }) => entry);
  await page.waitForTimeout(250);
  expect(calls(await playedCombatAudio(page, files))).toEqual(calls(played));
  await seek.fill("90");
  await seek.fill("0");
  expect(calls(await playedCombatAudio(page, files))).toEqual(calls(played));
});
