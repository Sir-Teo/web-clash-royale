import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { projectileArt } from "../src/render/projectiles";
import { deathEffect, impactEffect, launchEffect, destructionPlan } from "../src/render/destruction";
import { perspective, snapshot } from "../src/network/perspective";
import rules from "../src/game/bomb-tower-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["bomb-tower", ...STARTER_DECK.filter((id) => id !== "arrows")];
function game() {
  const battle = new Battle({ seed: 22, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "bomb-tower";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 9, 19).ok).toBe(true);
  const building = battle.entities.find((e) => e.card === "bomb-tower")!;
  Object.assign(building, { deploy: 0, cooldown: 0 });
  return { battle, building };
}
function enemy(battle: Battle, x: number, y: number) {
  battle.players.red.hand[0] = "knight";
  battle.players.red.elixir = 10;
  expect(battle.play("red", 0, 4, 10).ok).toBe(true);
  const knight = battle.entities.filter((e) => e.team === "red" && e.card === "knight").at(-1)!;
  Object.assign(knight, { x, y, deploy: 0, speed: 0, damage: 0, range: 0,
    cooldown: 999, hp: 10000, maxHp: 10000 });
  return knight;
}

describe("archived Bomb Tower", () => {
  it("pins the original split building, attached Bomber, card and particle effects", () => {
    const manifest = json("reference/client/bomb-tower-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ card: "BombTower", rarity: "Rare", cost: 5,
      sourceHitpoints: 950, sourceDamage: 100, deployTime: 1,
      hitSpeed: 1.6, loadTime: 1.1, range: 6, lifetime: 40,
      splash: 1.5, attachedCharacter: "Bomber", attachedCharacterHeight: 3.2,
      deathEffect: "BombTower_die", hitEffect: "BombTower_projectile_hit" });
    expect(CARDS).toHaveLength(73);
    expect(CARD_MAP["bomb-tower"]).toMatchObject({ kind: "building", rarity: "Rare",
      cost: 5, hp: 2432, damage: 256, range: 6, interval: 1.6,
      lifetime: 40, splash: 1.5 });
    expect(combatTraits({ card: "bomb-tower" })).toMatchObject({ source: "BombTower",
      windup: 0.5, projectile: { source: "BombTowerProjectile",
        speed: 500 / 60, homing: false, gravity: 200 } });
    const sprite = json("public/assets/buildings/bomb-tower.json");
    expect(Object.keys(sprite.clips)).toEqual(["blue", "red", "blue-top", "red-top"]);
    expect(sprite.attachedCharacterHeight).toBe(3.2);
    expect(json("public/assets/ui/cards/cards.json").portraits["bomb-tower"].row)
      .toBe("BombTower");
    expect(deathEffect("bomb-tower")).toBe("bomb-tower");
    expect(impactEffect("bomb-tower")).toBe("hit:bomb-tower");
    expect(launchEffect("bomb-tower")).toBe("launch:bomb-tower");
    for (const effect of ["bomb-tower", "hit:bomb-tower"])
      expect(destructionPlan(effect as any, 9).length).toBeGreaterThan(0);
  });

  it("throws a native bomb from the raised Bomber and splashes only enemy ground units", () => {
    const { battle, building } = game();
    const target = enemy(battle, 9, 13.5);
    const nearby = enemy(battle, 10, 13.5);
    const far = enemy(battle, 13, 13.5);
    const air = { ...target, id: 99999, card: "minions" as const,
      x: 9.5, air: true, hp: 10000, maxHp: 10000 };
    const ally = { ...target, id: 99998, team: "blue" as const,
      x: 9.4, hp: 10000, maxHp: 10000 };
    battle.entities.push(air, ally);
    let shot = battle.projectiles.find((p) => p.source === building.id);
    for (let i = 0; !shot && i < 100; i++) {
      battle.step();
      shot = battle.projectiles.find((p) => p.source === building.id);
    }
    expect(shot).toMatchObject({ style: "bomb-tower", damage: 256,
      splash: 1.5, air: false, homing: false, fromHeight: 4.5, arc: 2 });
    expect(shot?.target).toBe(target.id);
    expect(projectileArt(shot!)).toBe("projectile_bomb");
    for (let i = 0; i < 120 && battle.projectiles.some((p) => p.id === shot?.id); i++)
      battle.step();
    expect(target.hp).toBeLessThan(10000);
    expect(nearby.hp).toBeLessThan(10000);
    expect(far.hp).toBe(10000);
    expect(air.hp).toBe(10000);
    expect(ally.hp).toBe(10000);
  });

  it("keeps building commands in replay and the opposing view", () => {
    const { battle } = game();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i <= battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.some((e) => e.card === "bomb-tower")).toBe(true);
    expect(perspective(snapshot(battle), "red").entities.some((e) => e.card === "bomb-tower"))
      .toBe(true);
    expect(STEP).toBeGreaterThan(0);
  });
});
