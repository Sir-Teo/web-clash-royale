import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { deathAudioPlan } from "../src/game/death-audio";
import { Battle } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import type { Entity, Team } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import { deathEffect, destructionPlan, impactEffect } from "../src/render/destruction";
import rules from "../src/game/ice-golem-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function game() {
  const deck = ["ice-golem", ...STARTER_DECK.filter((id) => id !== "arrows")];
  const battle = new Battle({ seed: 71, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "ice-golem";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const golem = battle.entities.find((e) => e.card === "ice-golem")!;
  Object.assign(golem, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { battle, golem };
}
function opponent(battle: Battle, card: CardId, team: Team, x: number, y: number) {
  battle.players[team].hand[0] = card;
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, x, team === "blue" ? 22 : 10).ok).toBe(true);
  const target = battle.entities.filter((e) => e.team === team && e.card === card).at(-1)!;
  Object.assign(target, { x, y, deploy: 0, active: false, speed: 0,
    hp: 10000, maxHp: 10000 });
  return target;
}
const damage = (battle: Battle, entity: Entity, amount: number) =>
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void }).hurt(entity, amount);

describe("archived Ice Golem", () => {
  it("pins its source rules, original art, cold effects and sounds", () => {
    const manifest = json("reference/client/ice-golem-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "IceGolemite", character: "IceGolemite", rarity: "Rare",
      cost: 2, count: 1, sourceHitpoints: 595, sourceDamage: 40,
      sourceSpeed: 45, sourceRange: 0.75, sourceHitSpeed: 2.5,
      sourceDeployTime: 1, targetsBuildings: true, deathDamage: 40,
      deathRadius: 2, deathArea: "FreezeIceGolemite",
      deathAreaDuration: 2, slowDuration: 2, slowMultiplier: 0.65,
      oneShotEffect: "IceGolem_slow_loop", groundEffect: "IceGolem_slow_ground",
    });
    const sprite = json("public/assets/animations/ice-golem.json");
    expect(Object.keys(sprite.clips)).toHaveLength(54);
    expect(sprite.clips["blue-run-9"].source).toBe("snowman_blue_run1_9");
    expect(sprite.clips["red-attack-1"].source).toBe("snowman_red_attack1_1");
    expect(json("public/assets/ui/cards/cards.json").portraits["ice-golem"].row)
      .toBe("IceGolemite");
    expect(deathEffect("ice-golem")).toBe("ice-golem");
    expect(impactEffect("ice-golem-slow")).toBe("ice-golem-slow");
    expect(destructionPlan("ice-golem-slow", 9).length).toBeGreaterThan(0);
    expect(destructionPlan("ice-golem-ground", 9).length).toBeGreaterThan(0);
    expect(combatAudioPlan("ice-golem", "spawn", 9).length).toBeGreaterThan(0);
    expect(deathAudioPlan("ice-golem", 9).length).toBeGreaterThan(0);
    expect(CARDS).toHaveLength(65);
  });

  it("hunts buildings, then damages and slows ground and air on death", () => {
    expect(CARD_MAP["ice-golem"]).toMatchObject({
      cost: 2, count: 1, hp: 1260, damage: 87, speed: 0.75,
      range: 0.75, interval: 2.5, rarity: "Rare", buildingsOnly: true,
    });
    expect(combatTraits({ card: "ice-golem" })).toMatchObject({
      source: "IceGolemite", windup: 1, sight: 7,
    });
    const { battle, golem } = game();
    const knight = opponent(battle, "knight", "red", 4, 20);
    const air = opponent(battle, "minions", "red", 4.5, 20);
    const distant = opponent(battle, "knight", "red", 9, 20);
    const ally = opponent(battle, "knight", "blue", 4.2, 20);
    battle.step();
    expect(battle.entities.find((e) => e.id === golem.target)?.kind).toBe("tower");
    golem.hp = 1;
    damage(battle, golem, 1);
    expect(knight.hp).toBe(10000 - 87);
    expect(air.hp).toBe(10000 - 87);
    expect(distant.hp).toBe(10000);
    expect(ally.hp).toBe(10000);
    expect(knight.slow?.remaining).toBe(2);
    expect(air.slow?.remaining).toBe(2);
    expect(battle.areas.filter((area) => area.card === "ice-golem"))
      .toHaveLength(1);
    expect(battle.events.some((event) => event.type === "spell" &&
      event.effect === "ice-golem-slow")).toBe(true);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.areas.some((area) => area.card === "ice-golem")).toBe(true);
    distant.x = 4.7;
    battle.step();
    expect(distant.slow?.remaining).toBeGreaterThan(1.9);
    expect(distant.hp).toBe(10000);
    for (let i = 0; i < 65; i++) battle.step();
    expect(battle.areas.some((area) => area.card === "ice-golem")).toBe(false);
    expect(knight.slow?.remaining).toBeGreaterThan(1.5);
    for (let i = 0; i < 60; i++) battle.step();
    expect(knight.slow).toBeUndefined();
  });
});
