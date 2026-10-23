import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(
  readFileSync("reference/client/death-audio-manifest.json", "utf8"),
);
const files: string[] = manifest.audioFiles.map((file: { path: string }) =>
  file.path.replace(/^public/, ""),
);

test("all six native death sounds decode, including the retained Wizard placeholder", async ({
  page,
}, info) => {
  await page.goto("/");
  const decoded = await page.evaluate(async (paths) => {
    return Promise.all(
      paths.map(
        (path) =>
          new Promise<{ path: string; duration: number }>((resolve, reject) => {
            const audio = new Audio(path);
            const timer = setTimeout(
              () => finish(new Error(`${path}: decode timeout`)),
              15000,
            );
            function finish(error?: Error) {
              clearTimeout(timer);
              audio.oncanplay = audio.onerror = null;
              const duration = audio.duration;
              audio.pause();
              audio.removeAttribute("src");
              audio.load();
              if (error) reject(error);
              else resolve({ path, duration });
            }
            audio.oncanplay = () => finish();
            audio.onerror = () =>
              finish(
                new Error(`${path}: ${audio.error?.message ?? "decode error"}`),
              );
            audio.preload = "auto";
            audio.load();
          }),
      ),
    );
  }, files);
  expect(decoded).toHaveLength(6);
  await info.attach("decoded-death-audio.json", {
    body: JSON.stringify(decoded, null, 2),
    contentType: "application/json",
  });
  expect(
    decoded.every(
      (sound) => Number.isFinite(sound.duration) && sound.duration > 0,
    ),
  ).toBe(true);
});

for (const perspective of ["blue", "red"] as const)
  test(`${perspective} replay deaths play native sounds and stay silent across pause, seek and mute`, async ({
    page,
  }, info) => {
    const rules = info.outputPath("death-rules.mjs");
    await build({
      stdin: {
        contents:
          'export { Battle } from "./src/game/engine.ts"; export { deathAudioPlan } from "./src/game/death-audio.ts";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: rules,
    });
    const { Battle, deathAudioPlan } = (await import(
      pathToFileURL(rules).href
    )) as typeof import("../../src/game/engine") &
      typeof import("../../src/game/death-audio");
    const fixture = JSON.parse(
      readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
    );
    const replay = { ...fixture.replay, version: 5, perspective };
    const battle = new Battle({ replay });
    // Derive a real recorded death from canonical commands, without mutating game state.
    while (
      !battle.events.some((e) => e.type === "death" && e.card !== "tower") &&
      !battle.winner
    )
      battle.step();
    const death = battle.events.find(
      (e) => e.type === "death" && e.card !== "tower",
    )!;
    expect(death).toBeDefined();
    const cues = deathAudioPlan(
      death.card!,
      replay.seed ^ death.id,
      perspective === "red"
        ? death.team === "red"
          ? "blue"
          : "red"
        : death.team,
    );
    expect(cues.length).toBeGreaterThan(0);
    const expectedFiles = cues.map((cue) => `/assets/audio/${cue.file}.ogg`);
    await page.addInitScript(
      (saved) => {
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify(saved),
        );
        const log: {
          path: string;
          rate: number;
          volume: number;
          time: number;
          outcome?: string;
        }[] = [];
        Object.defineProperty(window, "__playedAudio", { value: log });
        const original = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          const entry: (typeof log)[number] = {
            path: new URL(this.src).pathname,
            rate: this.playbackRate,
            volume: this.volume,
            time: (window as any).__arena?.state.time ?? 0,
          };
          log.push(entry);
          const playing = original.call(this);
          void playing.then(
            () => {
              entry.outcome = "playing";
            },
            (error) => {
              entry.outcome = String(error);
            },
          );
          return playing;
        };
      },
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
      .toBe(45);
    await page.getByRole("button", { name: "Battle log", exact: true }).click();
    await page.locator('[data-replay="0"]').click();
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const timeline = page.getByRole("slider", { name: "Replay timeline" });
    const before = Math.max(
      0,
      ((death.time * 30 - 45) / replay.duration) * 100,
    );
    await timeline.fill(before.toFixed(2));
    const nativeCalls = () =>
      page.evaluate(
        (paths) =>
          (window as any).__playedAudio.filter((entry: { path: string }) =>
            paths.includes(entry.path),
          ),
        files,
      );
    expect(await nativeCalls()).toEqual([]);
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await nativeCalls()).map((cue: { path: string }) => cue.path),
        { timeout: 15000 },
      )
      .toEqual(expectedFiles);
    await expect
      .poll(async () =>
        (await nativeCalls()).every(
          (entry: { outcome?: string }) => entry.outcome === "playing",
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const played = await nativeCalls();
    for (const [index, entry] of played.entries()) {
      expect(entry.rate).toBeCloseTo(cues[index].pitch);
      expect(entry.volume).toBeCloseTo(cues[index].volume);
      expect(entry.time).toBeGreaterThanOrEqual(death.time);
    }
    await page.waitForTimeout(250);
    expect(await nativeCalls()).toEqual(played);
    await timeline.fill("90");
    expect(await nativeCalls()).toEqual(played);
    await timeline.fill(before.toFixed(2));
    await page
      .getByRole("button", { name: "Battle settings", exact: true })
      .click();
    await page.locator("label:has(#sound-setting)").click();
    await expect(page.locator("#sound-setting")).not.toBeChecked();
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.time), {
        timeout: 15000,
      })
      .toBeGreaterThan(death.time + 0.3);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    expect(await nativeCalls()).toEqual(played);
  });
