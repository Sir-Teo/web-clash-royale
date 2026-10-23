import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Entity } from "../src/game/engine";
import { Battle } from "../src/game/engine";
import { STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { csvGroups, csvRows } from "../scripts/lib/csv.mjs";
import { continuousEffect, destructionPlan } from "../src/render/destruction";
import { NativeContinuousEffects } from "../src/render/continuous-effects";
import definitions from "../src/render/destruction-data.json";

const actor = (team: "blue" | "red" = "blue") => ({
  id: 8, card: "golem", team, hp: 5154, deploy: 0,
  age: 3, x: 4, y: 21,
}) as Entity;

describe("native Golem fireflies", () => {
  it("imports four source times, native blue/red art and emitter physics", () => {
    const characters = csvRows(readFileSync("reference/logic/characters.csv", "utf8"));
    const effects = csvGroups(readFileSync("reference/client/effects.csv", "utf8"));
    const emitters = csvGroups(readFileSync("reference/client/particle_emitters.csv", "utf8"));
    expect(characters.find((row: any) => row.Name === "Golem")?.ContinuousEffect)
      .toBe("golem_cont_effect");
    expect(effects.golem_cont_effect.map((row: any) => Number(row.Time) / 1000))
      .toEqual([0, 3, 9, 12]);
    expect(emitters.golem_firefly_trail[0].EnemyVersion)
      .toBe("golem_firefly_trail_red");
    expect(definitions.continuities.golem.cycle).toBe(15);
    expect(continuousEffect("golem")).toBe("continuous:golem");
    expect(continuousEffect("golemite")).toBeUndefined();
    for (const [team, color] of [["blue", "blue"], ["red", "red"]] as const) {
      const plan = destructionPlan("continuous:golem", 42, team);
      expect(plan).toHaveLength(4);
      expect(plan.map((particle) => particle.delay)).toEqual([0, 3, 9, 12]);
      expect(plan.map((particle) => particle.component)).toEqual([0, 1, 2, 3]);
      expect(plan.every((particle) =>
        particle.clip.startsWith(`Golem_firefly_${color}_particle`) &&
        particle.life >= 5.5 && particle.life <= 7 &&
        particle.emitter.height > 1.5 && !particle.ground)).toBe(true);
    }
  });

  it("emits at authored times, follows movement, pauses and recreates recent effects after a peer snapshot", () => {
    const golem = actor();
    const effect = new NativeContinuousEffects();
    expect(effect.consume([golem], 41)).toMatchObject([
      { actor: 8, component: 0, origin: { x: 4, y: 21 }, age: 0 },
    ]);
    expect(effect.consume([golem], 41)).toEqual([]);
    golem.age = 5;
    expect(effect.consume([golem], 41)).toEqual([]);
    golem.age = 7;
    golem.x = 8;
    expect(effect.consume([golem], 41)).toMatchObject([
      { component: 1, origin: { x: 6, y: 21 }, age: 1 },
    ]);
    golem.age = 12;
    expect(effect.consume([golem], 41)).toMatchObject([
      { component: 2, origin: { x: 8, y: 21 }, age: 0 },
    ]);
    effect.reset();
    golem.age = 19;
    expect(effect.consume([golem], 41).map((burst) => [burst.component, burst.age]))
      .toEqual([[3, 4], [0, 1]]);
    golem.hp = 0;
    expect(effect.consume([golem], 41)).toEqual([]);
  });

  it("mirrors the attachment and chooses red fireflies in a peer view", () => {
    const game = new Battle({ seed: 61, ai: false,
      deck: ["golem", ...STARTER_DECK.filter((id) => id !== "arrows")] });
    game.players.blue.hand[0] = "golem";
    game.players.blue.elixir = 10;
    expect(game.play("blue", 0, 4, 22).ok).toBe(true);
    const golem = game.entities.find((entity) => entity.card === "golem")!;
    golem.deploy = 0;
    golem.age = 3;
    const host = new NativeContinuousEffects().consume(game.entities, game.seed)[0];
    const guest = new NativeContinuousEffects().consume(
      perspective(snapshot(game), "red").entities, game.seed,
    )[0];
    expect(host.team).toBe("blue");
    expect(guest.team).toBe("red");
    expect(host.origin.x + guest.origin.x).toBe(18);
    expect(host.origin.y + guest.origin.y).toBe(32);
    expect(destructionPlan(guest.effect, guest.seed, guest.team)[0].clip)
      .toMatch(/^Golem_firefly_red_particle/);
  });
});
