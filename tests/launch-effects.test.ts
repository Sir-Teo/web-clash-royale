import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import type { CombatAudioEvent } from "../src/game/combat-audio-events";
import { applySnapshot, snapshot } from "../src/network/perspective";
import { destructionPlan, launchEffect } from "../src/render/destruction";
import { NativeLaunchEffects } from "../src/render/launch-effects";
import definitions from "../src/render/destruction-data.json";

describe("native Cannon muzzle particles", () => {
  it("binds the original ProjectileEffect with smoke, fire and delayed tails", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const cannon = csvRows(
      readFileSync("reference/logic/buildings.csv", "utf8"),
    ).find((r: any) => r.Name === "Cannon")!;
    expect(cannon.ProjectileEffect).toBe("cannon_fire_projectile");
    expect(definitions.launches.cannon.source).toBe(cannon.ProjectileEffect);
    expect(launchEffect("cannon")).toBe("launch:cannon");
    expect(launchEffect("tesla")).toBeUndefined();
    const particles = destructionPlan("launch:cannon", 42);
    expect(particles).toHaveLength(26);
    expect(
      particles.filter((p) => p.clip === "fireplace_particle"),
    ).toHaveLength(9);
    expect(particles.some((p) => p.ground)).toBe(true);
    expect(particles.some((p) => p.tailDelay > 0)).toBe(true);
    expect(destructionPlan("launch:cannon", 42, "red")).toEqual(particles);
  });

  it("anchors the launch after the Cannon moves, rotates it for the guest, and deduplicates snapshots", () => {
    const host = new Battle({ seed: 37, ai: false });
    for (const tower of host.entities) tower.active = false;
    const cast = (
      team: "blue" | "red",
      card: "cannon" | "giant",
      y: number,
    ) => {
      host.players[team].elixir = 10;
      host.players[team].hand[0] = card;
      expect(host.play(team, 0, 9, team === "blue" ? 22 : 10).ok).toBe(true);
      const unit = host.entities.findLast((e) => e.card === card)!;
      unit.y = y;
      unit.deploy = 0;
      return unit;
    };
    const cannon = cast("blue", "cannon", 21);
    const giant = cast("red", "giant", 18);
    giant.active = false;
    for (
      let i = 0;
      i < 120 &&
      !host.audioEvents.some(
        (e) => e.phase === "launch" && e.profile === "cannon",
      );
      i++
    )
      host.step();
    const launch = host.audioEvents.find(
      (e) => e.phase === "launch" && e.profile === "cannon",
    )!;
    expect(launch.origin).toEqual({ x: cannon.x, y: cannon.y });
    expect(launch.actor).toBe(cannon.id);
    const wire = snapshot(host);
    cannon.x += 2;
    const cursor = new NativeLaunchEffects();
    const bursts = cursor.consume(host.audioEvents, host.seed, host.time + 0.2);
    expect(bursts).toMatchObject([
      { effect: "launch:cannon", origin: { x: 9, y: 21 } },
    ]);
    expect(bursts[0].age).toBeCloseTo(0.2);
    expect(
      cursor.consume(host.audioEvents, host.seed, host.time + 0.3),
    ).toEqual([]);
    cursor.reset(host.audioEvents);
    expect(
      cursor.consume(host.audioEvents, host.seed, host.time + 0.4),
    ).toEqual([]);
    const guest = new Battle({ seed: host.seed, ai: false });
    applySnapshot(guest, wire, "red");
    expect(
      new NativeLaunchEffects().consume(
        guest.audioEvents,
        guest.seed,
        guest.time,
      ),
    ).toMatchObject([
      { effect: "launch:cannon", origin: { x: 9, y: 11 }, team: "red", age: 0 },
    ]);
    const old: CombatAudioEvent = {
      ...launch,
      id: launch.id + 1,
      origin: undefined,
    };
    expect(
      new NativeLaunchEffects().consume([old], host.seed, host.time),
    ).toEqual([]);
    expect(host.tick * STEP).toBeCloseTo(host.time);
  });
});
