import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { combatAudioPlan } from "../src/game/combat-audio";
import { Battle } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import type { Entity, Team } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import { deathEffect, destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { screenShakePlan } from "../src/render/screen-shake";
import rules from "../src/game/giant-skeleton-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function game() {
  const deck = ["giant-skeleton", ...STARTER_DECK.filter((id) => id !== "arrows")];
  const battle = new Battle({ seed: 73, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "giant-skeleton";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const skeleton = battle.entities.find((e) => e.card === "giant-skeleton")!;
  Object.assign(skeleton, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { battle, skeleton };
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

describe("archived Giant Skeleton", () => {
  it("pins its card, 54 native animations, three-second bomb and source audio", () => {
    const manifest = json("reference/client/giant-skeleton-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "GiantSkeleton", character: "GiantSkeleton", rarity: "Epic",
      cost: 6, count: 1, sourceHitpoints: 2000, sourceDamage: 130,
      sourceSpeed: 60, sourceRange: 0.8, sourceHitSpeed: 1.5,
      sourceLoadTime: 1, sourceDeployTime: 1, ignoresPushback: true,
      bomb: { source: "GiantSkeletonBomb", deployTime: 3,
        sourceDamage: 720, radius: 3, pushback: 1.8,
        hitsGround: true, hitsAir: true,
        blueExport: "giant_skeleton_bomb_blue",
        redExport: "giant_skeleton_bomb_red",
        deathEffect: "MegaBombExplodeSkeleton" },
    });
    const sprite = json("public/assets/animations/giant-skeleton.json");
    expect(Object.keys(sprite.clips)).toHaveLength(54);
    expect(sprite.clips["blue-attack-1"].source).toBe("giant_skeleton_attack1_1");
    expect(sprite.clips["red-run-9"].source).toBe("giant_skeleton_enemy_run1_9");
    expect(json("public/assets/ui/cards/cards.json").portraits["giant-skeleton"].row)
      .toBe("GiantSkeleton");
    const effects = json("public/assets/effects/effects.json").clips;
    expect(effects.giant_skeleton_bomb_blue.frames).toHaveLength(90);
    expect(effects.giant_skeleton_bomb_red.frames).toHaveLength(90);
    expect(projectileArt({ style: "giant-skeleton-bomb", team: "blue" } as any))
      .toBe("giant_skeleton_bomb_blue");
    expect(deathEffect("giant-skeleton-bomb")).toBe("giant-skeleton-bomb");
    expect(destructionPlan("giant-skeleton-bomb", 9).length).toBeGreaterThan(0);
    expect(combatAudioPlan("giant-skeleton", "death-spawn", 9).length)
      .toBeGreaterThan(0);
    expect(combatAudioPlan("giant-skeleton", "death-impact", 9).length)
      .toBeGreaterThan(0);
    expect(screenShakePlan("giant-skeleton", "death-impact", "blue"))
      .toMatchObject([{ duration: 1, delay: 0 }]);
    expect(CARDS).toHaveLength(66);
  });

  it("drops a visible bomb before ground-and-air splash and pushback", () => {
    expect(CARD_MAP["giant-skeleton"]).toMatchObject({
      cost: 6, hp: 3221, damage: 209, speed: 1,
      range: 0.8, interval: 1.5, rarity: "Epic",
    });
    expect(combatTraits({ card: "giant-skeleton" })).toMatchObject({
      source: "GiantSkeleton", windup: 0.5,
      sight: 5, ignoresKnockback: true,
    });
    const { battle, skeleton } = game();
    const ground = opponent(battle, "knight", "red", 4, 20);
    const air = opponent(battle, "minions", "red", 4.5, 20);
    const distant = opponent(battle, "knight", "red", 9, 20);
    const ally = opponent(battle, "knight", "blue", 4.5, 20);
    skeleton.hp = 1;
    damage(battle, skeleton, 1);
    const bomb = battle.projectiles.find((p) => p.style === "giant-skeleton-bomb")!;
    expect(bomb).toMatchObject({ remaining: 3, duration: 3,
      damage: 1160, splash: 3, air: true, knockback: 1.8,
      x: 4, y: 21 });
    expect(ground.hp).toBe(10000);
    expect(air.hp).toBe(10000);
    expect(perspective(snapshot(battle), "red").projectiles.some((p) =>
      p.style === "giant-skeleton-bomb" && p.team === "red")).toBe(true);
    for (let i = 0; i < 89; i++) battle.step();
    expect(ground.hp).toBe(10000);
    expect(battle.projectiles.some((p) => p.id === bomb.id)).toBe(true);
    battle.step();
    expect(ground.hp).toBe(8840);
    expect(air.hp).toBe(8840);
    expect(distant.hp).toBe(10000);
    expect(ally.hp).toBe(10000);
    expect(ground.y).toBeLessThan(20);
    expect(air.x).toBeGreaterThan(4.5);
    expect(battle.projectiles.some((p) => p.id === bomb.id)).toBe(false);
    expect(battle.events.some((event) => event.type === "hit" &&
      event.effect === "giant-skeleton-bomb")).toBe(true);
    expect(battle.audioEvents.some((event) => event.phase === "death-impact" &&
      event.profile === "giant-skeleton")).toBe(true);
  });
});
