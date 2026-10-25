import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NativeScreenShake, screenShakePlan } from "../src/render/screen-shake";
import type { CombatAudioEvent } from "../src/game/combat-audio-events";
import { perspective, snapshot } from "../src/network/perspective";
import { Battle } from "../src/game/engine";

const event = (
  id: number,
  time: number,
  profile: CombatAudioEvent["profile"] = "fireball",
  phase: CombatAudioEvent["phase"] = "impact",
): CombatAudioEvent => ({ id, time, phase, profile, team: "blue" });
const radius = (state: { x: number; y: number }) =>
  Math.hypot(state.x, state.y);

describe("native impact shake", () => {
  it("retains source hashes, effect durations, the continuation-row King value and immediate group timing", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/screen-shake-manifest.json", "utf8"),
    );
    expect(manifest.sources).toHaveLength(8);
    for (const file of [...manifest.sources, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(file.path)).digest("hex"),
      ).toBe(file.sha256);
    expect(
      manifest.continuationScalars.map((entry: any) => [
        entry.effect,
        entry.row,
        entry.milliseconds,
      ]),
    ).toEqual([
      ["King_player_die", 1, 2000],
      ["King_enemy_die", 1, 2000],
    ]);
    for (const team of ["blue", "red"] as const)
      for (const [profile, phase, duration] of [
        ["fireball", "impact", 0.8],
        ["rocket", "impact", 1.5],
        ["zap", "impact", 0.25],
        ["lightning", "impact", 1],
        ["balloon", "impact", 0.35],
        ["balloon", "death-impact", 1],
        ["princess-tower", "death", 1],
        ["king-tower", "death", 2],
      ] as const) {
        const [cue] = screenShakePlan(profile, phase, team);
        expect(cue.duration).toBe(duration);
        expect(cue.delay).toBe(0);
      }
    expect(screenShakePlan("knight", "impact", "blue")).toEqual([]);
    expect(screenShakePlan("fireball", "cast", "blue")).toEqual([]);
  });
  it("uses a decaying circular displacement and maximum overlap instead of adding impacts", () => {
    const shake = new NativeScreenShake();
    const events = [event(1, 0), event(2, 0), event(3, 0, "zap")];
    shake.consume(events, 29, 0);
    expect(radius(shake.update(0.1))).toBeCloseTo(0.8 * 6);
    expect(shake.state.remaining).toBeCloseTo(0.7);
    shake.consume(events, 29, 0.1);
    expect(radius(shake.update(0.1))).toBeCloseTo(0.7 * 6);
    expect(shake.state.triggers).toBe(3);
    shake.consume([event(4, 0.2, "king-tower", "death")], 29, 0.2);
    expect(radius(shake.update(0.1))).toBeCloseTo(2 * 6);
    expect(shake.state.remaining).toBeCloseTo(1.9);
    shake.update(2);
    expect(radius(shake.update(0.1))).toBe(0);
  });
  it("accounts for late snapshots and keeps guest projection equivalent", () => {
    const battle = new Battle({ seed: 29 });
    battle.tick = 15;
    battle.audioEvents = [event(1, 0), event(2, 0, "zap")];
    const guest = perspective(snapshot(battle), "red");
    const own = new NativeScreenShake(),
      theirs = new NativeScreenShake();
    own.consume(battle.audioEvents, 29, 0.5);
    theirs.consume(guest.audioEvents!, 29, 0.5);
    const state = own.update(0.1);
    expect(theirs.update(0.1)).toEqual(state);
    expect(radius(state)).toBeCloseTo(0.3 * 6);
    expect(state.triggers).toBe(1);
  });
  it("holds the timer on pause, skips sought history and discards motion while reduced", () => {
    const shake = new NativeScreenShake();
    const events = [event(1, 0)];
    shake.consume(events, 29, 0);
    shake.update(0.1);
    const remaining = shake.state.remaining;
    const paused = shake.state;
    expect(shake.update(0)).toEqual(paused);
    expect(shake.state.remaining).toBe(remaining);
    expect(radius(shake.update(0.1))).toBeGreaterThan(0);
    shake.reset(events);
    shake.consume(events, 29, 0);
    expect(radius(shake.update(0.1))).toBe(0);
    shake.consume([event(2, 0.2)], 29, 0.2);
    expect(radius(shake.update(0.1, true))).toBe(0);
    expect(shake.state.remaining).toBe(0);
    expect(radius(shake.update(0.1, false))).toBe(0);
  });
  it("continues the final impact after match time stops without replaying it or consuming battle RNG", () => {
    const b = new Battle({ seed: 29 }),
      control = new Battle({ seed: 29 });
    const shake = new NativeScreenShake();
    const final = [event(1, 180, "king-tower", "death")];
    const samples = [];
    for (let i = 0; i < 30; i++) {
      shake.consume(final, b.seed, 180);
      samples.push(shake.update(0.1));
    }
    expect(samples[0].triggers).toBe(1);
    expect(samples.at(-1)!.triggers).toBe(1);
    expect(radius(samples.at(-1)!)).toBe(0);
    const repeat = new NativeScreenShake();
    expect(samples).toEqual(
      Array.from({ length: 30 }, () => {
        repeat.consume(final, b.seed, 180);
        return repeat.update(0.1);
      }),
    );
    for (let i = 0; i < 100; i++) {
      b.step();
      control.step();
    }
    expect(b.exportReplay()).toEqual(control.exportReplay());
    expect(b.entities).toEqual(control.entities);
  });
});
