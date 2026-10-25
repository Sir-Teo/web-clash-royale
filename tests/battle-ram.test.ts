import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { chargeEffect, destructionPlan, impactEffect } from "../src/render/destruction";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import rules from "../src/game/battle-ram-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const makeBattle = () => {
  const battle = new Battle({ seed: 41, ai: false,
    deck: ["battle-ram", ...STARTER_DECK.filter((id) => id !== "arrows")],
  });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "battle-ram";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const ram = battle.entities.find((e) => e.card === "battle-ram")!;
  Object.assign(ram, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { battle, ram };
};

describe("archived Battle Ram", () => {
  it("pins its building charge, native log and release effects", () => {
    const manifest = json("reference/client/battle-ram-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 4, rarity: "Rare", sourceHitpoints: 430, sourceDamage: 140,
      sourceChargeDamage: 280, chargeRange: 3, chargeSpeedMultiplier: 2,
      targetsBuildings: true, deathSpawnCharacter: "Barbarian",
      deathSpawnCount: 2, deathSpawnRadius: 0.6,
      deathSpawnDeployTime: 0.8, kamikaze: true,
    });
    expect(CARD_MAP["battle-ram"]).toMatchObject({
      hp: 911, damage: 305, cost: 4, range: 0.5,
      interval: 0.4, buildingsOnly: true,
    });
    const sprite = json("public/assets/animations/manifest.json").files.find((file: { id: string }) => file.id === "battle-ram");
    expect(sprite.clips).toBe(72);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_battle_ram.bin"));
    expect(json("public/assets/effects/effects.json").clips.battle_ram_log.frames).toHaveLength(16);
    expect(json("public/assets/ui/cards/cards.json").portraits["battle-ram"].row).toBe("BattleRam");
    expect(destructionPlan("battle-ram", 7).length).toBeGreaterThan(0);
    expect(impactEffect("battle-ram")).toBe("hit:battle-ram");
    expect(chargeEffect("battle-ram")).toBe("charge:battle-ram");
    expect(combatAudioPlan("battle-ram", "charge", 7).length).toBeGreaterThan(0);
  });

  it("ignores troops, charges a building, then releases two Barbarians", () => {
    const { battle, ram } = makeBattle();
    Object.assign(ram, { move: 3.1, speed: 0 });
    battle.players.red.hand[0] = "knight";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const knight = battle.entities.find((e) => e.team === "red" && e.card === "knight")!;
    Object.assign(knight, { x: 4, y: 20.2, hp: 10000, maxHp: 10000, deploy: 0, speed: 0, damage: 0 });
    battle.players.red.hand[0] = "cannon";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const cannon = battle.entities.find((e) => e.team === "red" && e.card === "cannon")!;
    Object.assign(cannon, { x: 4, y: 19.9, hp: 10000, maxHp: 10000, deploy: 0, damage: 0, active: false, lifetime: undefined });
    for (let i = 0; i < 90 && ram.hp > 0; i++) battle.step();
    expect(ram.hp).toBe(0);
    expect(cannon.hp).toBe(9390);
    expect(knight.hp).toBe(10000);
    const barbarians = battle.entities.filter((e) => e.team === "blue" && e.card === "barbarians");
    expect(barbarians).toHaveLength(2);
    expect(barbarians.every((e) => e.hp === CARD_MAP.barbarians.hp && e.deploy > 0)).toBe(true);
    expect(battle.events.some((e) => e.type === "death" && e.card === "battle-ram")).toBe(true);
  });

  it("also releases both Barbarians when destroyed before impact", () => {
    const { battle, ram } = makeBattle();
    ram.hp = 200;
    battle.players.red.hand[0] = "fireball";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 90 && ram.hp > 0; i++) battle.step();
    expect(ram.hp).toBe(0);
    expect(battle.entities.filter((e) => e.team === "blue" && e.card === "barbarians")).toHaveLength(2);
  });

  it("passes through a defender to its building and mirrors the released pair to a guest", () => {
    const { battle, ram } = makeBattle();
    Object.assign(ram, { y: 23, speed: CARD_MAP["battle-ram"].speed });
    for (const [card, y] of [["knight", 20], ["cannon", 17.5]] as const) {
      battle.players.red.hand[0] = card;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const target = battle.entities.find((e) => e.team === "red" && e.card === card)!;
      Object.assign(target, { x: 4, y, deploy: 0, hp: 10000, maxHp: 10000,
        speed: 0, damage: 0, active: false, lifetime: undefined });
    }
    for (let i = 0; i < 240 && ram.hp > 0; i++) battle.step();
    expect(ram.hp).toBe(0);
    expect(battle.events.find((e) => e.type === "hit" && e.card === "battle-ram")?.value).toBe(610);
    expect(battle.entities.find((e) => e.team === "red" && e.card === "knight")?.hp).toBe(10000);
    expect(perspective(snapshot(battle), "red").entities.filter(
      (e) => e.team === "red" && e.card === "barbarians",
    )).toHaveLength(2);
  });
});
