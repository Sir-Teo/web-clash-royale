import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { deploymentPositions } from "../src/game/deployment";
import { Battle } from "../src/game/engine";
import type { Entity } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import { destructionPlan } from "../src/render/destruction";
import { healthSelection } from "../src/ui/health-data";
import rules from "../src/game/guards-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["guards", ...STARTER_DECK.filter((id) => id !== "arrows")];
const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("guards"),
)!;
const hurt = (battle: Battle, entity: Entity, damage: number) =>
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void })
    .hurt(entity, damage);

describe("archived Guards", () => {
  it("pins the original card, both model states, shield effect and audio", () => {
    const manifest = json("reference/client/guards-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "SkeletonWarriors", character: "SkeletonWarrior",
      rarity: "Epic", cost: 3, count: 3,
      sourceHitpoints: 65, sourceShieldHitpoints: 150,
      sourceDamage: 65, sourceSpeed: 90, sourceRange: 1.6,
      sourceHitSpeed: 1.2, sourceLoadTime: 0.8,
      sourceDeployTime: 1, deployDelay: 0.4,
      summonRadius: 0.8, healthBar: "Shield_small",
      shieldBreakEffect: "skeleton_warrior_lose_shield",
    });
    for (const id of ["guards", "guards-shield"]) {
      const sprite = json(`public/assets/animations/${id}.json`);
      expect(Object.keys(sprite.clips)).toHaveLength(54);
      expect(sprite.textures[0].file).toBe("guards-0.webp");
      expect(sprite.clips["blue-attack-1"].source)
        .toBe(id === "guards" ? "skeletonWarrior_blue_attack1_1" :
          "skeletonWarrior_blue_shield_attack1_1");
      expect(sprite.clips["red-run-9"].source)
        .toBe(id === "guards" ? "skeletonWarrior_run1_9" :
          "skeletonWarrior_shield_run1_9");
    }
    expect(json("public/assets/ui/cards/cards.json").portraits.guards.row)
      .toBe("SkeletonWarriors");
    expect(destructionPlan("shield:guards", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("guards", "spawn", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("guards", "shield-lost", 7).map((cue) => cue.file))
      .toContain("shield_skele_lost_02");
    expect(CARDS).toHaveLength(64);
  });

  it("deploys three shielded fighters, absorbs a full breaking hit and replays formation", () => {
    expect(CARD_MAP.guards).toMatchObject({
      cost: 3, count: 3, hp: 105, damage: 105, speed: 1.5,
      range: 1.6, interval: 1.2, rarity: "Epic",
    });
    expect(combatTraits({ card: "guards" })).toMatchObject({
      source: "SkeletonWarrior", windup: 0.4, sight: 5.5,
    });
    const positions = deploymentPositions("guards", { x: 4, y: 22 });
    expect(positions).toHaveLength(3);
    expect(positions.every((p) => Math.hypot(p.x - 4, p.y - 22) <= 0.8 + 1e-8))
      .toBe(true);
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    for (const tower of battle.entities) tower.active = false;
    const beforeElixir = battle.players.blue.elixir;
    expect(battle.play("blue", battle.players.blue.hand.indexOf("guards"), 4, 22).ok)
      .toBe(true);
    expect(battle.players.blue.elixir).toBeCloseTo(beforeElixir - 3);
    const units = battle.entities.filter((e) => e.card === "guards");
    expect(units.map(({ x, y, deploy, shield }) => ({ x, y, deploy, shield })))
      .toEqual(positions.map(({ x, y }) => ({ x, y, deploy: 1.4, shield: 242 })));
    expect(perspective(snapshot(battle), "red").entities.filter((e) =>
      e.card === "guards" && e.shield === 242)).toHaveLength(3);
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i <= battle.tick; i++) replay.step();
    expect(replay.entities.filter((e) => e.card === "guards")
      .map(({ x, y, shield }) => ({ x, y, shield })))
      .toEqual(positions.map(({ x, y }) => ({ x, y, shield: 242 })));
    const [first, second, third] = units;
    const health = json("public/assets/ui/health/health.json");
    expect(healthSelection(health, first).name).toBe("hp_shield_player_number");
    hurt(battle, first, 500);
    expect(first.shield).toBe(0);
    expect(first.hp).toBe(105);
    expect(healthSelection(health, first).name).toBe("hp_player_number");
    hurt(battle, second, 100);
    expect(second.shield).toBe(142);
    expect(healthSelection(health, second).name).toBe("hp_shield_player_medium");
    expect(third.shield).toBe(242);
    expect(battle.events.filter((event) => event.effect === "shield:guards"))
      .toHaveLength(1);
    expect(battle.audioEvents.filter((event) => event.phase === "shield-lost" &&
      event.profile === "guards")).toHaveLength(1);
    hurt(battle, first, 105);
    expect(first.hp).toBe(0);
  });
});
