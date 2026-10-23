import { expectedEffects } from "./native-assets";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { replaySeekValue } from "./audio-helpers";

for (const perspective of ["blue", "red"] as const)
  test(`${perspective} replay impacts shift the arena with aligned picking, fixed controls and reduced-motion support`, async ({
    page,
  }, info) => {
    const path = info.outputPath("shake-rules.mjs");
    await build({
      stdin: {
        contents: 'export { Battle } from "./src/game/engine.ts";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: path,
    });
    const { Battle } = (await import(
      pathToFileURL(path).href
    )) as typeof import("../../src/game/engine");
    const fixture = JSON.parse(
      readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
    );
    const replay = { ...fixture.replay, version: 5, perspective };
    const battle = new Battle({ replay });
    while (
      !battle.audioEvents.some(
        (e) => e.profile === "fireball" && e.phase === "impact",
      ) &&
      !battle.winner
    )
      battle.step();
    const impact = battle.audioEvents.find(
      (e) => e.profile === "fireball" && e.phase === "impact",
    )!;
    expect(impact).toBeDefined();
    await page.addInitScript(
      (saved) => {
        localStorage.setItem(
          "browser-royale.profile.v1",
          JSON.stringify(saved),
        );
        (window as any).__shakeSamples = [];
        let frame = -1;
        const sample = () => {
          const arena = (window as any).__arena;
          if (arena && arena.state.renderedFrames !== frame) {
            const state = arena.state;
            frame = state.renderedFrames;
            const point = arena.project(4, 23);
            const picked = arena.pick(point.x, point.y);
            (window as any).__shakeSamples.push({
              time: state.time,
              ...state.shake,
              destruction: state.destruction,
              point,
              picked,
            });
            if ((window as any).__shakeSamples.length > 900)
              (window as any).__shakeSamples.shift();
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      {
        version: 1,
        sound: false,
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    const before = replaySeekValue(
      ((impact.time * 30 - 30) / replay.duration) * 100,
    );
    await seek.fill(before);
    const baseline = await page.evaluate(() =>
      (window as any).__arena.project(4, 23),
    );
    const controls = await page.locator("#hand").boundingBox();
    await page.evaluate(() => {
      (window as any).__shakeSamples.length = 0;
    });
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as any).__shakeSamples.some(
              (s: any) =>
                s.lastEffect === "Fireball_explosion" &&
                Math.hypot(s.x, s.y) > 0,
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    const samples = await page.evaluate(() => (window as any).__shakeSamples);
    const moving = samples.filter(
      (s: any) =>
        s.lastEffect === "Fireball_explosion" && Math.hypot(s.x, s.y) > 0,
    );
    expect(moving.length).toBeGreaterThan(0);
    // The real replay hit must dispatch the full composition, not only shake.
    expect(
      moving.some((s: any) => s.destruction.clips.explosion_cloud_1 > 0),
    ).toBe(true);
    expect(moving.some((s: any) => s.destruction.tails.stretched > 0)).toBe(
      true,
    );
    for (const sample of moving) {
      expect(sample.time).toBeGreaterThanOrEqual(impact.time);
      expect(Math.hypot(sample.x, sample.y)).toBeLessThanOrEqual(4.80001);
      expect(sample.point.x - baseline.x).toBeCloseTo(
        sample.x * sample.pixelsPerUnit,
        3,
      );
      expect(sample.point.y - baseline.y).toBeCloseTo(
        sample.y * sample.pixelsPerUnit,
        3,
      );
      expect(sample.picked.x).toBeCloseTo(4, 5);
      expect(sample.picked.y).toBeCloseTo(23, 5);
    }
    expect(await page.locator("#hand").boundingBox()).toEqual(controls);
    const held = await page.evaluate(() => (window as any).__arena.state.shake);
    const heldParticles = await page.evaluate(
      () => (window as any).__arena.state.destruction,
    );
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => (window as any).__arena.state.shake),
    ).toEqual(held);
    expect(
      await page.evaluate(() => (window as any).__arena.state.destruction),
    ).toEqual(heldParticles);
    await page.screenshot({
      path: info.outputPath(`fireball-${perspective}-impact.png`),
    });
    await info.attach("impact-motion.json", {
      body: JSON.stringify({ impact, baseline, moving }, null, 2),
      contentType: "application/json",
    });
    await seek.fill("90");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__arena.state.shake.remaining),
      )
      .toBe(0);
    await seek.fill(before);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__arena.state.destruction.particles,
        ),
      )
      .toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      (window as any).__shakeSamples.length = 0;
    });
    await page
      .getByRole("button", { name: "Resume replay", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__arena.state.time), {
        timeout: 15000,
      })
      .toBeGreaterThan(impact.time + 1);
    await page
      .getByRole("button", { name: "Pause replay", exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        (window as any).__shakeSamples.every(
          (s: any) => s.x === 0 && s.y === 0,
        ),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        (window as any).__shakeSamples.some(
          (s: any) => s.destruction.clips.MolotovTrailParticle > 0,
        ),
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(
      await page.evaluate(() => (window as any).__arena.state.shake.remaining),
    ).toBe(0);
    expect(errors).toEqual([]);
  });
