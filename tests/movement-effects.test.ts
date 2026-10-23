import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Entity } from "../src/game/engine";
import { destructionPlan, movementEffect } from "../src/render/destruction";
import { NativeMovementEffects } from "../src/render/movement-effects";
import { Battle } from "../src/game/engine";
import definitions from "../src/render/destruction-data.json";

const actor = (card: "knight" | "prince", x = 4, y = 22) =>
  ({
    id: card === "knight" ? 7 : 8,
    card,
    team: "blue",
    hp: 100,
    deploy: 0,
    move: 0,
    x,
    y,
  }) as Entity;

describe("native footstep dust", () => {
  it("uses the retained Knight and Prince ground emitter", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const characters = csvRows(
      readFileSync("reference/logic/characters.csv", "utf8"),
    );
    for (const [card, source] of [
      ["knight", "Knight"],
      ["prince", "Prince"],
    ] as const) {
      const row = characters.find((r: any) => r.Name === source)!;
      expect(row.MoveEffect).toBe(definitions.movements[card].source);
      expect(movementEffect(card)).toBe(`move:${card}`);
      const plan = destructionPlan(`move:${card}`, 42);
      expect(plan).toHaveLength(3);
      expect(
        plan.every((p) => ["d2", "d3", "d4"].includes(p.clip) && p.ground),
      ).toBe(true);
    }
    expect(movementEffect("giant")).toBeUndefined();
  });

  it("emits at traveled intervals, skips pause and teleports, and resets on replay", () => {
    const knight = actor("knight");
    const footsteps = new NativeMovementEffects();
    expect(footsteps.consume([knight], 17, 0)).toEqual([]);
    knight.y -= 0.5;
    knight.move = 0.2;
    expect(footsteps.consume([knight], 17, 0.2)).toEqual([]);
    expect(footsteps.consume([knight], 17, 0.2)).toEqual([]);
    knight.y -= 0.5;
    knight.move = 0.4;
    const first = footsteps.consume([knight], 17, 0.4);
    expect(first).toMatchObject([
      { effect: "move:knight", origin: { x: 4, y: 21.25 }, team: "blue" },
    ]);
    expect(first[0].age).toBeCloseTo(0.1);
    expect(footsteps.consume([knight], 17, 0.4)).toEqual([]);
    knight.y -= 3;
    knight.move = 0.6;
    expect(footsteps.consume([knight], 17, 0.6)).toEqual([]);
    knight.y -= 1;
    knight.move = 0.8;
    expect(footsteps.consume([knight], 17, 0.8)).toHaveLength(1);
    footsteps.reset();
    expect(footsteps.consume([knight], 17, 0.1)).toEqual([]);
    knight.y -= 0.8;
    knight.move = 1;
    expect(footsteps.consume([knight], 17, 0.3)).toHaveLength(1);
  });

  it("samples footsteps during an actual Knight and Prince advance", () => {
    const battle = new Battle({ seed: 12, ai: false });
    for (const tower of battle.entities) tower.active = false;
    const unit = (
      card: "knight" | "prince" | "giant",
      team: "blue" | "red",
      x: number,
      y: number,
    ) => {
      battle.players[team].elixir = 10;
      battle.players[team].hand[0] = card;
      expect(battle.play(team, 0, x, team === "blue" ? 22 : 10).ok).toBe(true);
      const entity = battle.entities.findLast(
        (e) => e.card === card && e.team === team,
      )!;
      entity.x = x;
      entity.y = y;
      entity.deploy = 0;
      entity.cooldown = 0;
      return entity;
    };
    unit("knight", "blue", 4, 23);
    unit("prince", "blue", 14, 23);
    unit("giant", "red", 4, 10).active = false;
    unit("giant", "red", 14, 10).active = false;
    const effects = new NativeMovementEffects();
    effects.consume(battle.entities, battle.seed, battle.time);
    let count = 0;
    for (let i = 0; i < 40; i++) {
      for (let tick = 0; tick < 3; tick++) battle.step();
      count += effects.consume(
        battle.entities,
        battle.seed,
        battle.time,
      ).length;
    }
    expect(count).toBeGreaterThan(0);
  });
});
