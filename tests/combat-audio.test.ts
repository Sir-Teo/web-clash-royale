import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { csvGroups } from "../scripts/lib/csv.mjs";
import definitions from "../src/game/combat-audio-data.json";
import { combatAudioPlan, NativeCombatAudio } from "../src/game/combat-audio";
import type { CombatAudioEvent } from "../src/game/combat-audio-events";
import { Battle, STEP } from "../src/game/engine";
import type { Entity, Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";

const event = (
  id: number,
  time: number,
  profile: CombatAudioEvent["profile"] = "knight",
  phase: CombatAudioEvent["phase"] = "attack",
): CombatAudioEvent => ({ id, time, phase, profile, team: "blue", actor: 7 });
function harness() {
  const audio = { enabled: true, play: vi.fn(() => () => {}) };
  return { audio, cues: new NativeCombatAudio(audio) };
}
function arena() {
  const battle = new Battle({ seed: 29, ai: false });
  for (const tower of battle.entities) tower.active = false;
  return battle;
}
function unit(
  battle: Battle,
  card: CardId,
  team: Team,
  x: number,
  y: number,
): Entity {
  const previous = new Set(battle.entities.map((e) => e.id));
  battle.players[team].elixir = 10;
  battle.players[team].hand[0] = card;
  expect(battle.play(team, 0, x, team === "blue" ? 22 : 10).ok).toBe(true);
  const result = battle.entities.find((e) => !previous.has(e.id))!;
  result.y = y;
  result.deploy = 0;
  result.cooldown = 0;
  return result;
}
function advanceUntil(battle: Battle, condition: () => boolean) {
  for (let tick = 0; tick < 300 && !condition(); tick++) battle.step();
  expect(condition()).toBe(true);
}

describe("native combat audio evidence", () => {
  it("retains all source rows, variant-specific values and pinned file hashes", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/combat-audio-manifest.json", "utf8"),
    );
    expect(manifest.audioFiles).toHaveLength(75);
    expect(Object.keys(definitions.profiles)).toHaveLength(26);
    expect(Object.keys(definitions.sounds)).toHaveLength(55);
    for (const file of [
      ...manifest.sources,
      ...manifest.audioFiles,
      manifest.output,
    ])
      expect(
        createHash("sha256").update(readFileSync(file.path)).digest("hex"),
      ).toBe(file.sha256);
    const source = csvGroups(
      readFileSync("reference/client/sounds.csv", "utf8"),
    );
    for (const [group, variants] of Object.entries(definitions.sounds)) {
      expect(variants).toHaveLength(source[group].length);
      for (const [index, sound] of variants.entries()) {
        const row = source[group][index];
        expect(sound.sourceFile).toBe(row.FileNames);
        expect(sound.volume).toEqual([
          Number(row.MinVolume) / 100,
          Number(row.MaxVolume) / 100,
        ]);
        expect(sound.pitch).toEqual([
          Number(row.MinPitch) / 100,
          Number(row.MaxPitch) / 100,
        ]);
        expect(sound.startDelay).toEqual([
          Number(row.StartDelayMinMs) / 1000,
          Number(row.StartDelayMaxMs) / 1000,
        ]);
        expect(sound.maximum).toBe(Number(row.MaximumByType));
        expect(sound.repeat).toBe(Number(row.MaxRepeatMs) / 1000);
        expect(sound.priority).toBe(Number(row.Priority));
        expect(sound.padding).toBe(Number(row.PadEmpyToEndMs) / 1000);
      }
    }
    expect(
      definitions.sounds.sound_valkyrie_attack_start.filter(
        (v) => v.file === "valkyrie_atk_04",
      ),
    ).toHaveLength(2);
  });
  it("distinguishes swings, launch effects, impacts, tower weapons and spell casting", () => {
    const files = (profile: string, phase: CombatAudioEvent["phase"]) =>
      combatAudioPlan(profile, phase, 29).map((cue) => cue.file);
    expect(files("knight", "impact")).toEqual(["knight_hit_01"]);
    expect(files("giant", "impact")).toEqual(["giant_hit_01"]);
    expect(files("musketeer", "attack")).toEqual([]);
    expect(files("musketeer", "launch")).toEqual(["musket_fire_02"]);
    expect(files("musketeer", "impact")).toEqual(["musket_impact_01"]);
    expect(files("cannon", "launch")).toEqual(["cannon_fire_03"]);
    expect(files("cannon", "impact")).toEqual([]);
    expect(files("king-tower", "launch")).toEqual(["king_fire_06"]);
    expect(files("princess-tower", "launch")).toEqual(["archer_tower_fire_05"]);
    expect(files("princess-tower", "impact")).toEqual(["arrow_hit_13"]);
    expect(files("fireball", "cast")).toEqual(["fire_ball_02"]);
    expect(files("arrows", "cast")).toEqual([
      "spellcast01",
      "archer_queen_attack_02",
    ]);
    expect(files("zap", "cast")).toEqual(["spellcast01"]);
    expect(files("unknown", "impact")).toEqual([]);
  });
  it("varies adjacent event IDs while preserving repeatable authored delay, gain and pitch", () => {
    const seen = new Set();
    for (let index = 0; index < 100; index++) {
      const seed = 183345833 ^ index;
      const plan = combatAudioPlan("knight", "attack", seed);
      expect(combatAudioPlan("knight", "attack", seed)).toEqual(plan);
      const cue = plan[0];
      const source = definitions.sounds.sound_knight_attack_start.find(
        (v) => v.file === cue.file,
      )!;
      seen.add(cue.file);
      expect(cue.delay).toBe(source.startDelay[0]);
      expect(cue.volume).toBeGreaterThanOrEqual(source.volume[0] * 0.35);
      expect(cue.volume).toBeLessThanOrEqual(source.volume[1] * 0.35);
      expect(cue.pitch).toBeGreaterThanOrEqual(source.pitch[0]);
      expect(cue.pitch).toBeLessThanOrEqual(source.pitch[1]);
    }
    expect(seen.size).toBe(5);
  });
});

describe("combat audio timing and lifecycle", () => {
  it("cancels only unreleased windup cues and deduplicates repeated snapshots", () => {
    const { audio, cues } = harness();
    const start = event(1, 0);
    cues.consume([start], 29, 0);
    cues.update(0.1);
    expect(audio.play).not.toHaveBeenCalled();
    const impact = event(2, 0.2, "giant", "impact");
    const cancel = { ...event(3, 0.2, "knight", "cancel"), attack: 1 };
    cues.consume([start, impact, cancel], 29, 0.2);
    cues.update(0.4);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "giant_hit_01",
    ]);
    cues.consume([start, impact, cancel], 29, 0.4);
    cues.update(0.5);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
  it("holds delays on pause, skips sought history and drops muted or stale cues", () => {
    const { audio, cues } = harness();
    cues.consume([event(1, 0)], 29, 0);
    cues.update(0.45, true);
    expect(audio.play).not.toHaveBeenCalled();
    cues.update(0.45);
    expect(audio.play).toHaveBeenCalledOnce();
    cues.consume([event(2, 1)], 29, 1);
    cues.skip([event(2, 1)]);
    cues.consume([event(2, 1)], 29, 1.2);
    cues.update(1.5);
    expect(audio.play).toHaveBeenCalledOnce();
    cues.consume([event(3, 2)], 29, 2);
    audio.enabled = false;
    cues.update(2, true);
    audio.enabled = true;
    cues.update(2.5);
    cues.consume([event(4, 3)], 29, 4);
    cues.update(4.5);
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it("limits Wizard voice repetition across all four variations using match time", () => {
    const { audio, cues } = harness();
    for (let index = 0; index < 5; index++) {
      const time = index * 2;
      cues.consume([event(index + 1, time, "wizard")], 29, time);
      cues.update(time);
      cues.update(time + 0.55);
    }
    expect(
      audio.play.mock.calls.filter((call) =>
        String(call[0]).startsWith("wiz_atk_vo_"),
      ),
    ).toHaveLength(2);
    expect(
      audio.play.mock.calls.filter((call) => call[0] === "wiz_fireball_01v9"),
    ).toHaveLength(5);
  });
});

describe("canonical combat presentation events", () => {
  it("omits expired network sound history while retaining delayed live cues", () => {
    const battle = arena();
    battle.tick = 300;
    battle.audioEvents = [
      event(1, 1, "giant", "impact"),
      event(2, 9.8),
      event(3, 9.9, "giant", "impact"),
    ];
    const view = snapshot(battle);
    expect(view.audioEvents?.map((e) => e.id)).toEqual([2, 3]);
    expect(battle.audioEvents).toHaveLength(3);
    const { audio, cues } = harness();
    cues.consume(view.audioEvents!, 29, battle.time);
    cues.update(battle.time);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "giant_hit_01",
    ]);
    cues.update(10.3);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "giant_hit_01",
      combatAudioPlan("knight", "attack", 29 ^ 2)[0].file,
    ]);
  });
  it("emits a melee windup and contact on their actual simulation ticks", () => {
    const battle = arena();
    const knight = unit(battle, "knight", "blue", 4, 21);
    const giant = unit(battle, "giant", "red", 4, 20);
    giant.active = false;
    advanceUntil(battle, () =>
      battle.audioEvents.some((e) => e.phase === "impact"),
    );
    const events = battle.audioEvents.filter((e) => e.actor === knight.id);
    expect(events.map((e) => e.phase)).toEqual(["attack", "impact"]);
    expect(events[1].time - events[0].time).toBeCloseTo(
      combatTraits(knight).windup,
    );
    expect(events[1].time).toBe(
      battle.events.find((e) => e.type === "hit")!.time,
    );
  });
  it("retains a projectile's weapon identity after its shooter dies", () => {
    const battle = arena();
    const shooter = unit(battle, "musketeer", "blue", 4, 22);
    const target = unit(battle, "giant", "red", 4, 15.5);
    target.active = false;
    advanceUntil(battle, () =>
      battle.audioEvents.some((e) => e.phase === "launch"),
    );
    const launch = battle.audioEvents.find((e) => e.phase === "launch")!;
    const start = battle.audioEvents.find((e) => e.phase === "attack")!;
    expect(launch.time - start.time).toBeCloseTo(combatTraits(shooter).windup);
    shooter.hp = 1;
    battle.players.red.elixir = 10;
    battle.players.red.hand[0] = "zap";
    battle.play("red", 0, shooter.x, shooter.y);
    advanceUntil(battle, () => !battle.entities.includes(shooter));
    expect(
      battle.audioEvents.some(
        (e) => e.profile === "musketeer" && e.phase === "impact",
      ),
    ).toBe(false);
    advanceUntil(battle, () =>
      battle.audioEvents.some(
        (e) => e.profile === "musketeer" && e.phase === "impact",
      ),
    );
    const impact = battle.audioEvents.find(
      (e) => e.profile === "musketeer" && e.phase === "impact",
    )!;
    expect(impact.actor).toBe(shooter.id);
    expect(impact.time).toBeGreaterThan(launch.time);
  });
  it("emits a cancellation when Zap interrupts a pending attack", () => {
    const battle = arena();
    const knight = unit(battle, "knight", "blue", 4, 21);
    unit(battle, "giant", "red", 4, 20).active = false;
    battle.step();
    const start = battle.audioEvents.find((e) => e.actor === knight.id)!;
    battle.players.red.hand[0] = "zap";
    battle.players.red.elixir = 10;
    battle.play("red", 0, knight.x, knight.y);
    for (let i = 0; i < 8; i++) battle.step();
    expect(
      battle.audioEvents.find(
        (e) => e.phase === "cancel" && e.actor === knight.id,
      )?.attack,
    ).toBe(start.id);
    expect(
      battle.audioEvents.some(
        (e) => e.phase === "impact" && e.actor === knight.id,
      ),
    ).toBe(false);
  });
  it("preserves simulation IDs and the three Arrows waves while transporting team-relative cues", () => {
    const battle = arena();
    battle.players.blue.hand[0] = "arrows";
    battle.play("blue", 0, 4, 6);
    expect(battle.events[0].id).toBe(7);
    expect(battle.projectiles.map((p) => p.id)).toEqual([8, 9, 10]);
    advanceUntil(
      battle,
      () => battle.audioEvents.filter((e) => e.phase === "impact").length === 3,
    );
    const impacts = battle.audioEvents.filter((e) => e.phase === "impact");
    expect(impacts[1].time - impacts[0].time).toBeCloseTo(6 * STEP);
    expect(impacts[2].time - impacts[1].time).toBeCloseTo(6 * STEP);
    const original = JSON.stringify(battle.audioEvents);
    const canonical = snapshot(battle);
    const view = perspective(canonical, "red");
    expect(view.audioEvents!.every((e) => e.team === "red")).toBe(true);
    expect(view.audioEvents!.map((e) => e.id)).toEqual(
      canonical.audioEvents!.map((e) => e.id),
    );
    expect(JSON.stringify(battle.audioEvents)).toBe(original);
    const rendered = arena();
    applySnapshot(rendered, snapshot(battle), "red");
    expect(rendered.audioEvents).toEqual(view.audioEvents);
    const older = snapshot(battle);
    delete older.audioEvents;
    applySnapshot(rendered, older, "blue");
    expect(rendered.audioEvents).toEqual([]);
  });
});
