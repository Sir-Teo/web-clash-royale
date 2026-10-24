import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { Battle } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import { impactEffect, continuousEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/ice-spirit-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["ice-spirit", ...STARTER_DECK.filter((id) => id !== "arrows")];
const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((value) => {
  const battle = new Battle({ seed: value, ai: false, deck, enemyDeck: deck });
  return battle.players.blue.hand.includes("ice-spirit") &&
    battle.players.red.hand.includes("knight");
})!;

describe("archived Ice Spirit", () => {
  it("pins its portrait, 27 directional clips, particle bindings and audio", () => {
    const manifest = json("reference/client/ice-spirit-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "IceSpirits", character: "IceSpirits",
      projectile: "IceSpiritsProjectile", cost: 1,
      sourceHitpoints: 90, sourceRange: 2.5, sourceHitSpeed: 0.3,
      splashRadius: 1.5, freezeDuration: 1.5,
      projectileExport: "projectile_icespirit",
      projectileHitEffect: "icespirit_projectile_hit",
      projectileTrailEffect: "ice_wiz_emitter",
    });
    const sprite = json("public/assets/animations/ice-spirit.json");
    expect(Object.keys(sprite.clips)).toHaveLength(27);
    expect(sprite.clips["blue-attack-1"].source).toBe("icespirit_attack1_1");
    expect(sprite.clips["blue-run-9"].source).toBe("icespirit_run1_9");
    expect(json("public/assets/ui/cards/cards.json").portraits["ice-spirit"].row)
      .toBe("IceSpirits");
    expect(projectileArt({ style: "ice-spirit" } as any)).toBe("projectile_icespirit");
    expect(impactEffect("ice-spirit")).toBe("hit:ice-spirit");
    expect(json("src/render/destruction-data.json").trails["ice-spirit"].source)
      .toBe("ice_wiz_emitter");
    expect(continuousEffect("ice-spirit")).toBe("continuous:ice-spirit");
    expect(combatAudioPlan("ice-spirit", "spawn", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("ice-spirit", "impact", 7).length).toBeGreaterThan(0);
    expect(CARDS).toHaveLength(67);
  });

  it("spends one elixir and freezes a target after its one-use splash projectile", () => {
    expect(CARD_MAP["ice-spirit"]).toMatchObject({
      cost: 1, count: 1, hp: 227, damage: 121, speed: 2,
      range: 2.5, interval: 0.3, hitsAir: true, splash: 1.5,
    });
    expect(combatTraits({ card: "ice-spirit" })).toMatchObject({
      source: "IceSpirits", windup: 0.2, sight: 5.5,
      projectile: { source: "IceSpiritsProjectile", homing: true },
    });
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    while (battle.players.red.elixir < 3) battle.step();
    expect(battle.play("red", battle.players.red.hand.indexOf("knight"), 4, 13.6).ok).toBe(true);
    const elixir = battle.players.blue.elixir;
    expect(battle.play("blue", battle.players.blue.hand.indexOf("ice-spirit"), 4, 18.2).ok).toBe(true);
    expect(battle.players.blue.elixir).toBeCloseTo(elixir - 1);
    const spirit = battle.entities.find((e) => e.card === "ice-spirit")!;
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    expect(spirit.deploy).toBe(1.4);
    expect(perspective(snapshot(battle), "red").entities.some((e) => e.card === "ice-spirit"))
      .toBe(true);
    for (let i = 0; i < 240 && knight.stun <= 0; i++) battle.step();
    expect(spirit.hp).toBe(0);
    expect(knight.hp).toBeLessThan(knight.maxHp);
    expect(knight.stun).toBeGreaterThan(0);
    expect(battle.events.some((e) => e.type === "hit" && e.card === "ice-spirit")).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.entities.find((e) => e.id === knight.id)?.stun).toBeCloseTo(knight.stun);
  });
});
