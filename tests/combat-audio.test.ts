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
    expect(manifest.audioFiles).toHaveLength(221);
    expect(manifest.sources).toHaveLength(11);
    expect(Object.keys(definitions.profiles)).toHaveLength(55);
    expect(Object.keys(definitions.sounds)).toHaveLength(181);
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
        expect(sound.loop).toBe(row.Loop?.toLowerCase() === "true");
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
    const files = (
      profile: string,
      phase: CombatAudioEvent["phase"] | "charge",
    ) => combatAudioPlan(profile, phase, 29).map((cue) => cue.file);
    expect(files("knight", "impact")).toEqual(["knight_hit_01"]);
    expect(files("giant", "impact")).toEqual(["giant_hit_01"]);
    expect(files("prince", "charge")).toEqual(["rider_charge_03"]);
    expect(files("knight", "charge")).toEqual([]);
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
  it("plays the Balloon's distinct death-bomb explosion after its owner has died", () => {
    const battle = arena();
    const balloon = unit(battle, "balloon", "blue", 4, 21);
    balloon.hp = 1;
    balloon.speed = 0;
    battle.players.red.elixir = 10;
    battle.players.red.hand[0] = "fireball";
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    advanceUntil(battle, () =>
      battle.audioEvents.some((e) => e.phase === "death-impact"),
    );
    const explosion = battle.audioEvents.find(
      (e) => e.phase === "death-impact",
    )!;
    const death = battle.audioEvents.find(
      (e) => e.phase === "death" && e.actor === balloon.id,
    )!;
    const dropped = battle.audioEvents.find((e) => e.phase === "death-spawn")!;
    expect(dropped.actor).toBe(balloon.id);
    expect(dropped.time).toBe(death.time);
    expect(explosion.actor).toBe(balloon.id);
    expect(explosion.time - death.time).toBeCloseTo(0.8, 1);
    expect(battle.entities.some((e) => e.id === balloon.id)).toBe(false);
    const plan = combatAudioPlan(
      "balloon",
      "death-impact",
      battle.seed ^ explosion.id,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].file).toBe("explosion_01");
    expect(plan[0].volume).toBeCloseTo(0.8 * 0.35);
    expect(plan[0].pitch).toBeGreaterThanOrEqual(0.97);
    expect(plan[0].pitch).toBeLessThanOrEqual(1.03);
    expect(plan[0].maximum).toBe(3);
    expect(combatAudioPlan("balloon", "impact", 29)[0].file).not.toBe(
      plan[0].file,
    );
    const wire = snapshot(battle);
    const impact = wire.events.filter((e) => e.effect === "balloon-bomb");
    expect(impact).toHaveLength(1);
    expect(impact[0]).toMatchObject({
      time: explosion.time,
      x: balloon.x,
      y: balloon.y,
      type: "hit",
      team: "blue",
    });
    expect(
      perspective(wire, "red").events.find((e) => e.id === impact[0].id),
    ).toMatchObject({
      effect: "balloon-bomb",
      x: 18 - balloon.x,
      y: 32 - balloon.y,
      team: "red",
    });
    expect(wire.audioEvents?.some((e) => e.phase === "death-impact")).toBe(
      false,
    );
    expect(wire.lifecycleAudioEvents).toContainEqual(explosion);
    const { audio, cues } = harness();
    cues.consume([death, dropped], battle.seed, dropped.time);
    cues.update(dropped.time, false, new Set());
    expect(audio.play.mock.calls[0]).toEqual([
      "bomb_drop_01",
      0.8 * 0.35,
      { pitch: 1, group: "sound_Balloon_Bomb_deploy", maximum: 2 },
    ]);
    cues.consume([death, explosion], battle.seed, battle.time);
    cues.update(battle.time, false, new Set());
    expect(audio.play.mock.calls[1][0]).toBe("explosion_01");
  });
  it("uses the source Tesla opening and closing cues for both perspectives", () => {
    for (const team of ["blue", "red"] as const)
      for (const [phase, file, volume] of [
        ["appear", "tesla_open_02", 0.8],
        ["hide", "tesla_close_02", 0.7],
      ] as const) {
        const [cue] = combatAudioPlan("tesla", phase, 29, team);
        expect(cue.file).toBe(file);
        expect(cue.delay).toBe(0);
        expect(cue.volume).toBeCloseTo(volume * 0.35);
        expect(cue.pitch).toBeGreaterThanOrEqual(0.98);
        expect(cue.pitch).toBeLessThanOrEqual(1.02);
        expect(cue.maximum).toBe(3);
        expect(combatAudioPlan("cannon", phase, 29, team)).toEqual([]);
      }
  });
  it("sounds only Tesla transition starts, including reversal, and projects them through the optional lifecycle stream", () => {
    const battle = arena();
    const tesla = unit(battle, "tesla", "blue", 9, 21);
    for (let i = 0; i < 30; i++) battle.step();
    const transitions = () =>
      battle.audioEvents.filter(
        (e) => e.actor === tesla.id && ["appear", "hide"].includes(e.phase),
      );
    expect(transitions()).toEqual([]);
    const enemy = unit(battle, "knight", "red", 9, 24);
    enemy.speed = 0;
    enemy.damage = 0;
    enemy.hp = 10000;
    for (let i = 0; i < 30; i++) battle.step();
    expect(transitions().map((e) => e.phase)).toEqual(["appear"]);
    enemy.y = 10;
    advanceUntil(battle, () => tesla.burrow!.phase === "sinking");
    expect(transitions().map((e) => e.phase)).toEqual(["appear", "hide"]);
    enemy.y = 24;
    battle.step();
    expect(transitions().map((e) => e.phase)).toEqual([
      "appear",
      "hide",
      "appear",
    ]);
    const wire = snapshot(battle);
    expect(
      wire.audioEvents?.some((e) => ["appear", "hide"].includes(e.phase)),
    ).toBe(false);
    const received = arena();
    applySnapshot(received, wire, "red");
    const projected = received.audioEvents.filter((e) =>
      transitions().some((t) => t.id === e.id),
    );
    expect(projected).toEqual(
      transitions().map((e) => ({ ...e, team: "red" })),
    );
    enemy.y = 10;
    advanceUntil(battle, () => tesla.burrow!.phase === "hidden");
    expect(transitions().map((e) => e.phase)).toEqual([
      "appear",
      "hide",
      "appear",
      "hide",
    ]);
  });
  it("does not revive stale or dead Tesla transition audio after pause or snapshot catch-up", () => {
    const { audio, cues } = harness();
    const start = event(1, 0, "tesla", "appear");
    cues.consume([start], 29, 0);
    cues.update(0, true, new Set([7]));
    expect(audio.play).not.toHaveBeenCalled();
    cues.update(0, false, new Set([7]));
    cues.consume([start], 29, 0);
    cues.update(0);
    expect(audio.play).toHaveBeenCalledOnce();
    cues.consume([event(2, 1, "tesla", "hide")], 29, 1.6);
    cues.update(1.6);
    cues.consume([event(3, 2, "tesla", "appear")], 29, 2);
    cues.update(2, false, new Set());
    expect(audio.play).toHaveBeenCalledOnce();
  });
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
  it("queues Prince's render-only charge voice on match time and drops stale crossings", () => {
    const { audio, cues } = harness();
    cues.queueCharge(29, "blue", 2.3, 0.05);
    cues.update(2.35, true);
    expect(audio.play).not.toHaveBeenCalled();
    cues.update(2.35);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "rider_charge_03",
    ]);
    cues.queueCharge(30, "red", 3, 0.6);
    cues.update(3.6);
    expect(audio.play).toHaveBeenCalledTimes(2);
    cues.queueCharge(32, "red", 3.7, 1.5);
    cues.update(5.2);
    expect(audio.play).toHaveBeenCalledTimes(2);
    cues.queueCharge(31, "red", 4, 0);
    cues.skip([]);
    cues.update(4);
    expect(audio.play).toHaveBeenCalledTimes(2);
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
    const events = battle.audioEvents.filter(
      (e) => e.actor === knight.id && ["attack", "impact"].includes(e.phase),
    );
    expect(events.map((e) => e.phase)).toEqual(["attack", "impact"]);
    expect(events[1].time - events[0].time).toBeCloseTo(
      combatTraits(knight).windup,
    );
    expect(events[1].time).toBe(
      battle.events.find((e) => e.type === "hit")!.time,
    );
  });
  it("uses the archived special impact only for Prince's charged strike and preserves it for a peer", () => {
    expect(combatAudioPlan("prince", "impact-special", 29)).toMatchObject([
      {
        group: "sound_prince_charge_hit",
        file: "prince_charge_hit_01",
        pitch: 1,
        maximum: 3,
      },
    ]);
    expect(
      combatAudioPlan("prince", "impact-special", 29)[0].volume,
    ).toBeCloseTo(0.28);
    const battle = arena();
    const prince = unit(battle, "prince", "blue", 4, 21);
    const giant = unit(battle, "giant", "red", 4, 20);
    giant.active = false;
    prince.move = 2.4;
    advanceUntil(battle, () =>
      battle.audioEvents.some((e) => e.phase === "impact-special"),
    );
    const charged = battle.audioEvents.find(
      (e) => e.phase === "impact-special",
    )!;
    expect(charged.actor).toBe(prince.id);
    expect(battle.events.find((e) => e.type === "hit")?.value).toBe(
      prince.damage * 2,
    );
    expect(snapshot(battle).lifecycleAudioEvents).toContainEqual(charged);
    const guest = arena();
    applySnapshot(guest, snapshot(battle), "red");
    expect(guest.audioEvents.find((e) => e.id === charged.id)?.team).toBe(
      "red",
    );
    const { audio, cues } = harness();
    cues.consume(guest.audioEvents, guest.seed, guest.time);
    cues.update(guest.time);
    const specialCall = audio.play.mock.calls.find(
      (call) => call[0] === "prince_charge_hit_01",
    );
    expect(specialCall?.[1]).toBeCloseTo(0.28);
    expect(specialCall?.[2]).toMatchObject({
      group: "sound_prince_charge_hit",
    });

    const ordinary = arena();
    const normalPrince = unit(ordinary, "prince", "blue", 4, 21);
    const normalTarget = unit(ordinary, "giant", "red", 4, 20);
    normalTarget.active = false;
    advanceUntil(ordinary, () =>
      ordinary.audioEvents.some(
        (e) => e.actor === normalPrince.id && e.phase === "impact",
      ),
    );
    expect(ordinary.audioEvents.some((e) => e.phase === "impact-special")).toBe(
      false,
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
    const start = battle.audioEvents.find(
      (e) => e.actor === knight.id && e.phase === "attack",
    )!;
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

describe("native deployment and summoning audio", () => {
  it("retains a briefly delayed deployment and its follow-up spacing without replaying stale attacks", () => {
    const battle = arena();
    battle.tick = 90;
    battle.audioEvents = [
      event(1, -2, "musketeer", "spawn"),
      event(2, 0, "musketeer", "spawn"),
      event(3, 0, "knight", "attack"),
    ];
    const wire = snapshot(battle);
    expect(wire.audioEvents).toEqual([]);
    expect(wire.lifecycleAudioEvents?.map((e) => e.id)).toEqual([2]);
    const { audio, cues } = harness();
    cues.consume(wire.lifecycleAudioEvents!, 29, battle.time);
    cues.update(3, false, new Set([7]));
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "musketeer_deploy_01",
    ]);
    cues.update(4, false, new Set([7]));
    expect(audio.play).toHaveBeenCalledOnce();
    cues.update(4.2, false, new Set([7]));
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "musketeer_deploy_01",
      "musketeer_reload_01",
    ]);
  });
  it("suppresses an orphaned delayed voice even when a network snapshot has skipped its death event", () => {
    const { audio, cues } = harness();
    cues.consume([event(1, 0, "pekka", "spawn")], 29, 0);
    cues.update(0, false, new Set([7]));
    expect(audio.play).toHaveBeenCalledOnce();
    cues.consume([event(10, 3, "musketeer", "impact")], 29, 3);
    cues.update(3, false, new Set());
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "pekka_deploy_01",
      "musket_impact_01",
    ]);
  });
  it("keeps distinct troop/building cues, authored follow-up delays and the bounded source correction", () => {
    const files = (
      profile: string,
      phase: CombatAudioEvent["phase"],
      team: Team = "blue",
    ) => combatAudioPlan(profile, phase, 29, team).map((cue) => cue.file);
    expect(files("spear-goblins", "spawn")).toEqual(["spear_gob_dep_01v2"]);
    expect(files("bomber", "spawn")).toEqual([
      "deploy_skeleton_01",
      "skeleton_deploy_end_01",
    ]);
    expect(files("witch", "spawn")).toEqual(["summon_witch_01"]);
    expect(files("witch", "summon")).toEqual(["witch_summon_02"]);
    expect(files("cannon", "spawn")).toEqual(["cannon_deploy_01"]);
    expect(files("tesla", "spawn")).toEqual(["building_place_01"]);
    expect(files("cannon", "cast")).toEqual(["spellcast01"]);
    expect(files("giant", "spawn", "red")).toEqual(["giant_deploy_01"]);
    expect(files("king-tower", "spawn")).toEqual([]);
    const musketeer = combatAudioPlan("musketeer", "spawn", 29);
    expect(musketeer.map((cue) => [cue.file, cue.delay, cue.volume])).toEqual([
      ["musketeer_deploy_01", 0, 0.7 * 0.35],
      ["musketeer_reload_01", 1.2, 0.6 * 0.35],
    ]);
    expect(combatAudioPlan("knight", "spawn", 29)[1].delay).toBe(1);
    expect(combatAudioPlan("pekka", "spawn", 29)[1].delay).toBe(3);
    const manifest = JSON.parse(
      readFileSync("reference/client/combat-audio-manifest.json", "utf8"),
    );
    expect(manifest.ignoredEnemyVersions).toHaveLength(1);
    const correction = manifest.ignoredEnemyVersions[0];
    const effects = csvGroups(
      readFileSync("reference/client/effects.csv", "utf8"),
    );
    expect(effects[correction.effect][0].EnemyVersion).toBe(
      correction.enemyVersion,
    );
    expect(
      effects[correction.enemyVersion].some(
        (row: any) => row.Effect === correction.effect,
      ),
    ).toBe(true);
    expect(definitions.profiles["skeleton-army"].cardSource).toEqual({
      table: "spells_characters",
      row: "SkeletonArmy",
    });
    expect(combatAudioPlan("knight", "future-phase" as any, 29)).toEqual([]);
  });
  it("cancels only the dead troop's pending voices and preserves later projectile impact", () => {
    const { audio, cues } = harness();
    cues.consume(
      [
        event(1, 0, "musketeer", "spawn"),
        { ...event(2, 0, "musketeer", "spawn"), actor: 8 },
      ],
      29,
      0,
    );
    cues.update(0);
    cues.consume(
      [{ ...event(3, 0.2, "musketeer", "cancel"), attack: 99 }],
      29,
      0.2,
    );
    cues.consume(
      [
        event(4, 0.5, "musketeer", "death"),
        event(5, 0.6, "musketeer", "impact"),
      ],
      29,
      0.6,
    );
    cues.update(0.6);
    cues.update(1.2, true);
    expect(audio.play.mock.calls.map((call) => call[0])).toEqual([
      "musketeer_deploy_01",
      "musketeer_deploy_01",
      "musket_impact_01",
    ]);
    cues.update(1.2);
    expect(audio.play.mock.calls.at(-1)).toEqual([
      "musketeer_reload_01",
      0.6 * 0.35,
      {
        pitch: combatAudioPlan("musketeer", "spawn", 29 ^ 2)[1].pitch,
        group: "sound_musketeer_deploy_end",
        maximum: 3,
      },
    ]);
    expect(audio.play).toHaveBeenCalledTimes(4);
  });
  it("transports a swarm once per entity without exposing new phases to old clients or overlapping Skeleton voices", () => {
    const battle = arena();
    battle.players.blue.hand[0] = "skeleton-army";
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.events[0].id).toBe(7);
    const spawned = battle.entities.filter((e) => e.card === "skeleton-army");
    const voices = battle.audioEvents.filter((e) => e.phase === "spawn");
    expect(voices.map((e) => e.actor)).toEqual(spawned.map((e) => e.id));
    expect(voices).toHaveLength(15);
    const wire = snapshot(battle);
    expect(wire.audioEvents?.map((e) => e.phase)).toEqual(["cast"]);
    expect(wire.lifecycleAudioEvents).toHaveLength(15);
    const rendered = arena();
    applySnapshot(rendered, wire, "red");
    expect(rendered.audioEvents.map((e) => e.id)).toEqual(
      battle.audioEvents.map((e) => e.id),
    );
    expect(rendered.audioEvents.every((e) => e.team === "red")).toBe(true);
    const { audio, cues } = harness();
    cues.consume(rendered.audioEvents, battle.seed, 0);
    cues.update(0);
    expect(
      audio.play.mock.calls.filter((call) => call[0] === "skeleton_deploy_03"),
    ).toHaveLength(1);
    delete wire.lifecycleAudioEvents;
    applySnapshot(rendered, wire, "blue");
    expect(rendered.audioEvents.map((e) => e.phase)).toEqual(["cast"]);
  });
  it.each([1, 5] as const)(
    "emits one Witch summon cue per burst under version-%i combat",
    (version) => {
      const initial = arena();
      const battle = new Battle({
        replay: { ...initial.exportReplay(), version },
      });
      for (const tower of battle.entities) tower.active = false;
      const witch = unit(battle, "witch", "blue", 4, 25);
      advanceUntil(battle, () =>
        battle.audioEvents.some((e) => e.phase === "summon"),
      );
      const summon = battle.audioEvents.find((e) => e.phase === "summon")!;
      expect(summon.actor).toBe(witch.id);
      expect(summon.profile).toBe("witch");
      expect(
        battle.audioEvents.filter((e) => e.phase === "summon"),
      ).toHaveLength(1);
      expect(
        battle.audioEvents.filter(
          (e) => e.phase === "spawn" && e.profile === "skeletons",
        ),
      ).toHaveLength(3);
      expect(battle.actions).toHaveLength(1);
    },
  );
});
