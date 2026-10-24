import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { deploymentPositions } from "../src/game/deployment";
import { Battle } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import { impactEffect, continuousEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/fire-spirits-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["fire-spirits", ...STARTER_DECK.filter((id) => id !== "arrows")];
const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((value) => {
  const battle = new Battle({ seed: value, ai: false, deck, enemyDeck: deck });
  return battle.players.blue.hand.includes("fire-spirits") &&
    battle.players.red.hand.includes("knight");
})!;

describe("archived Fire Spirits", () => {
  it("pins the three-unit card, original sprites, portrait, projectile and audio", () => {
    const manifest = json("reference/client/fire-spirits-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "FireSpirits", character: "FireSpirits",
      projectile: "FireSpiritsProjectile", cost: 2, count: 3,
      sourceHitpoints: 43, sourceRange: 2, sourceHitSpeed: 0.3,
      sourceProjectileDamage: 80, splashRadius: 1.5,
      projectileExport: "projectile_firespirit",
      projectileHitEffect: "firespirit_projectile_hit",
      projectileTrailEffect: "PrincessArrowProjectileEmitter",
    });
    const sprite = json("public/assets/animations/fire-spirits.json");
    expect(Object.keys(sprite.clips)).toHaveLength(27);
    expect(sprite.clips["blue-attack-1"].source).toBe("firespirit_attack1_1");
    expect(sprite.clips["blue-run-9"].source).toBe("firespirit_run1_9");
    expect(json("public/assets/ui/cards/cards.json").portraits["fire-spirits"].row)
      .toBe("FireSpirits");
    expect(projectileArt({ style: "fire-spirits" } as any)).toBe("projectile_firespirit");
    expect(impactEffect("fire-spirits")).toBe("hit:fire-spirits");
    expect(continuousEffect("fire-spirits")).toBe("continuous:fire-spirits");
    expect(json("src/render/destruction-data.json").trails["fire-spirits"].source)
      .toBe("PrincessArrowProjectileEmitter");
    expect(combatAudioPlan("fire-spirits", "spawn", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("fire-spirits", "impact", 7).length).toBeGreaterThan(0);
    expect(CARDS).toHaveLength(73);
  });

  it("spends two elixir, deploys a readable triangle and resolves a deterministic battle", () => {
    expect(CARD_MAP["fire-spirits"]).toMatchObject({
      cost: 2, count: 3, hp: 109, damage: 215, speed: 2,
      range: 2, interval: 0.3, hitsAir: true, splash: 1.5,
    });
    expect(combatTraits({ card: "fire-spirits" })).toMatchObject({
      source: "FireSpirits", windup: 0.2, sight: 5.5,
      projectile: { source: "FireSpiritsProjectile", homing: true },
    });
    const blue = deploymentPositions("fire-spirits", { x: 4, y: 22 }, "blue");
    const red = deploymentPositions("fire-spirits", { x: 4, y: 10 }, "red");
    expect(blue).toEqual([
      { x: 3.45, y: 22.25 }, { x: 4, y: 21.35 }, { x: 4.55, y: 22.25 },
    ]);
    expect(red).toEqual([
      { x: 3.45, y: 9.75 }, { x: 4, y: 10.65 }, { x: 4.55, y: 9.75 },
    ]);
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    while (battle.players.red.elixir < 3) battle.step();
    expect(battle.play("red", battle.players.red.hand.indexOf("knight"), 4, 13.6).ok).toBe(true);
    const beforeElixir = battle.players.blue.elixir;
    expect(battle.play("blue", battle.players.blue.hand.indexOf("fire-spirits"), 4, 18.2).ok).toBe(true);
    expect(battle.players.blue.elixir).toBeCloseTo(beforeElixir - 2);
    const spirits = battle.entities.filter((e) => e.card === "fire-spirits");
    expect(spirits).toHaveLength(3);
    expect(spirits.every((e) => e.deploy === 1.4)).toBe(true);
    expect(perspective(snapshot(battle), "red").entities.filter((e) =>
      e.card === "fire-spirits")).toHaveLength(3);
    for (let i = 0; i < 240 && (spirits.some((e) => e.hp > 0) ||
      battle.projectiles.some((p) => p.style === "fire-spirits")); i++) battle.step();
    expect(spirits.every((e) => e.hp === 0)).toBe(true);
    expect(battle.events.some((e) => e.type === "hit" && e.card === "fire-spirits"))
      .toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    expect(knight.hp).toBeLessThan(knight.maxHp);
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.entities.find((e) => e.id === knight.id)?.hp).toBe(knight.hp);
  });

  it("launches one splash projectile per surviving spirit", () => {
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    while (battle.players.red.elixir < 3) battle.step();
    expect(battle.play("red", battle.players.red.hand.indexOf("knight"), 4, 13.6).ok).toBe(true);
    expect(battle.play("blue", battle.players.blue.hand.indexOf("fire-spirits"), 4, 18.2).ok).toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    const spirits = battle.entities.filter((e) => e.card === "fire-spirits");
    for (const entity of battle.entities) if (entity.team === "red") entity.active = false;
    for (let i = 0; i < 240 && (spirits.some((e) => e.hp > 0) ||
      battle.projectiles.some((p) => p.style === "fire-spirits")); i++) battle.step();
    expect(spirits.every((e) => e.hp === 0)).toBe(true);
    expect(battle.events.filter((e) => e.type === "hit" && e.card === "fire-spirits"))
      .toHaveLength(3);
    expect(knight.hp).toBeLessThan(knight.maxHp);
  });
});
