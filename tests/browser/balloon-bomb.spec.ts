import { expectedEffects } from "./native-assets";
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  observeCombatAudio,
  playedCombatAudio,
  replaySeekValue,
} from "./audio-helpers";

for (const perspective of ["blue", "red"] as const)
  test(`a recorded Balloon death preserves native bomb artwork, explosion, sound and camera from ${perspective}`, async ({
    page,
  }, info) => {
    const path = info.outputPath("bomb-rules.mjs");
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
    const source = new Battle({
      seed: 91,
      deck: [
        "balloon",
        "knight",
        "archers",
        "musketeer",
        "fireball",
        "arrows",
        "zap",
        "goblins",
      ],
    });
    // Record legal commands against the normal AI, with no HP/position mutation.
    for (let i = 0; i < 5400 && !source.winner; i++) {
      if (
        i % 90 === 0 &&
        !source.audioEvents.some((e) => e.phase === "death-impact")
      ) {
        const hand = source.players.blue.hand;
        const slot = hand.includes("balloon") ? hand.indexOf("balloon") : 0;
        source.play(
          "blue",
          slot,
          4,
          ["fireball", "arrows", "zap"].includes(hand[slot]) ? 10 : 23,
        );
      }
      source.step();
      const impact = source.audioEvents.find((e) => e.phase === "death-impact");
      // Leave room for delayed browser automation and the complete ground-mark
      // lifetime. The previous one-second tail ended before CI could click Pause.
      if (impact && source.time > impact.time + 15) break;
    }
    const replay = { ...source.exportReplay(), perspective };
    expect(replay.version).toBe(21);
    const battle = new Battle({ replay });
    while (
      !battle.audioEvents.some((e) => e.phase === "death-impact") &&
      !battle.winner &&
      battle.tick < replay.duration
    )
      battle.step();
    const events = battle.audioEvents.filter(
      (e) => e.phase === "death-spawn" || e.phase === "death-impact",
    );
    const death = battle.events.find(
      (e) => e.type === "death" && e.card === "balloon",
    )!;
    expect(events.map((e) => e.phase)).toEqual(["death-spawn", "death-impact"]);
    // Combat-born shots advance this frame; projectile-born shots wait for
    // the next snapshot. Preserve that existing one-tick phase distinction.
    const bombDelay = events[1].time - events[0].time;
    expect(bombDelay).toBeGreaterThanOrEqual(1 - 1 / 30 - 1e-8);
    expect(bombDelay).toBeLessThanOrEqual(1 + 1e-8);
    const expected = events.map((e) => ({
      ...combatAudioPlan(e.profile, e.phase, replay.seed ^ e.id, e.team)[0],
      time: e.time,
    }));
    const files = expected.map((e) => `/assets/audio/${e.file}.ogg`);
    expect(files).toEqual([
      "/assets/audio/bomb_drop_01.ogg",
      "/assets/audio/explosion_01.ogg",
    ]);
    await observeCombatAudio(page);
    await page.addInitScript(
      (saved) => {
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify(saved),
        );
        (window as any).__bombShake = [];
        const sample = () => {
          const state = (window as any).__arena?.state;
          if (
            state?.shake.lastEffect === "MegaBombExplodeBalloon" &&
            Math.hypot(state.shake.x, state.shake.y) > 0
          )
            (window as any).__bombShake.push({
              time: state.time,
              ...state.shake,
            });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
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
      replaySeekValue(((events[0].time * 30 - 30) / replay.duration) * 100),
    );
    expect(await playedCombatAudio(page, files)).toEqual([]);
    const artName = `balloon_bomb_${perspective === "blue" ? "blue" : "red"}`;
    const shownBomb = () =>
      page.evaluate(
        (name) =>
          (window as any).__arena?.state?.projectileArtwork?.find((p: any) =>
            p.sprites.some((s: any) => s.name === name),
          ),
        artName,
      );
    await seek.fill(
      replaySeekValue((((events[0].time + 0.2) * 30) / replay.duration) * 100),
    );
    await expect.poll(shownBomb).toBeTruthy();
    const early = await shownBomb();
    expect(early.position[0]).toBeCloseTo(
      (perspective === "blue" ? death.x : 18 - death.x) - 9,
    );
    expect(early.position[1]).toBe(0.2);
    expect(early.position[2]).toBeCloseTo(
      (perspective === "blue" ? death.y : 32 - death.y) - 16,
    );
    await page.screenshot({
      path: info.outputPath(`${perspective}-native-balloon-drop.png`),
    });
    await page.waitForTimeout(200);
    expect(await shownBomb()).toEqual(early);
    await seek.fill(
      replaySeekValue((((events[0].time + 0.6) * 30) / replay.duration) * 100),
    );
    await expect
      .poll(async () => {
        const bomb = await shownBomb();
        return !!bomb && bomb.sprites[0].frame !== early.sprites[0].frame;
      })
      .toBe(true);
    expect(await playedCombatAudio(page, files)).toEqual([]);
    await seek.fill(
      replaySeekValue(((events[0].time * 30 - 30) / replay.duration) * 100),
    );
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await playedCombatAudio(page, files)).filter(
            (e: any) => e.outcome === "playing",
          ).length,
        { timeout: 15000 },
      )
      .toBe(2);
    await expect
      .poll(() => page.evaluate(() => (window as any).__bombShake.length))
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__arena.state.destruction.clips
              .bomb_destruction_state ?? 0,
        ),
      )
      .toBe(1);
    // Deliberately outwait the old fixture's one-second tail before pausing.
    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const explosionState = await page.evaluate(
      () => (window as any).__arena.state.destruction,
    );
    expect(explosionState.clips.bomb_destruction_state).toBe(1);
    await page.screenshot({
      path: info.outputPath(`${perspective}-native-balloon-explosion.png`),
    });
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => (window as any).__arena.state.destruction),
    ).toEqual(explosionState);
    const calls = await playedCombatAudio(page, files);
    expect(calls.map((e: any) => e.path)).toEqual(files);
    for (const [i, cue] of expected.entries()) {
      expect(calls[i].rate).toBeCloseTo(cue.pitch);
      expect(calls[i].volume).toBeCloseTo(cue.volume);
      expect(calls[i].time).toBeGreaterThanOrEqual(cue.time);
      expect(calls[i].time).toBeLessThan(cue.time + 0.6);
      expect(calls[i].paused).toBe(true);
    }
    const shake = await page.evaluate(() => (window as any).__bombShake);
    expect(
      shake.every(
        (s: any) => s.time >= events[1].time && Math.hypot(s.x, s.y) <= 6.00001,
      ),
    ).toBe(true);
    await info.attach("balloon-bomb-playback.json", {
      body: JSON.stringify({ events, calls, shake }, null, 2),
      contentType: "application/json",
    });
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).__arena.state.destruction.clips
                .bomb_destruction_state ?? 0,
          ),
        { timeout: 10000 },
      )
      .toBe(0);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const completed = await playedCombatAudio(page, files);
    await seek.fill("0");
    expect(
      await page.evaluate(
        () => (window as any).__arena.state.destruction.clips,
      ),
    ).toEqual({});
    expect(await playedCombatAudio(page, files)).toEqual(completed);
  });
