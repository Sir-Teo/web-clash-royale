import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { Battle, entityVisualHeight, projectileHitHeight } from "../src/game/engine";
import type { Entity } from "../src/game/engine";
import { combatAudioPlan } from "../src/game/combat-audio";
import { deathAudioPlan } from "../src/game/death-audio";
import { combatTraits } from "../src/game/combat";
import { perspective, snapshot } from "../src/network/perspective";
import { deathEffect, destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/lava-hound-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const setup = () => {
  const game = new Battle({ seed: 67, ai: false,
    deck: ["lava-hound", ...STARTER_DECK.filter((id) => id !== "arrows")] });
  for (const tower of game.entities) tower.active = false;
  game.players.blue.hand[0] = "lava-hound";
  game.players.blue.elixir = 10;
  expect(game.play("blue", 0, 4, 22).ok).toBe(true);
  const hound = game.entities.find((e) => e.card === "lava-hound")!;
  return { game, hound };
};
const hurt = (game: Battle, entity: Entity, amount: number) =>
  (game as unknown as { hurt: (entity: Entity, amount: number) => void }).hurt(entity, amount);

describe("archived Lava Hound", () => {
  it("pins the flying tank, Pup, projectile rules and original artwork", () => {
    const manifest = json("reference/client/lava-hound-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ card: "LavaHound", rarity: "Legendary", cost: 7,
      hound: { sourceHitpoints: 3000, sourceDamage: 45, sourceSpeed: 45,
        sourceRange: 2, targetsBuildings: true, hitsAir: true, flyingHeight: 5,
        projectileStartZ: 1.8,
        projectile: { source: "LavaHoundProjectile", speed: 400 / 60,
          homing: true, export: "particle_coal1", trail: "lava_hound_Emitter" },
        deathSpawn: { character: "LavaPups", count: 6, radius: 2.5,
          pushback: true } },
      pup: { sourceHitpoints: 179, sourceDamage: 45, sourceSpeed: 60,
        flyingHeight: 3.5, projectileStartZ: 0.1,
        projectile: { source: "LavaPupProjectile",
          homing: true, export: "particle_coal1", trail: "lava_pups_emitter" } } });
    expect(CARDS).toHaveLength(73);
    expect(CARDS.some((card) => card.id === "lava-pup")).toBe(false);
    expect(CARD_MAP["lava-hound"]).toMatchObject({ cost: 7, hp: 3630,
      damage: 54, air: true, hitsAir: true, buildingsOnly: true });
    expect(CARD_MAP["lava-pup"]).toMatchObject({ hp: 217, damage: 54,
      air: true, hitsAir: true });
    expect(entityVisualHeight({ card: "lava-hound", air: true })).toBe(5);
    expect(entityVisualHeight({ card: "lava-pup", air: true })).toBe(3.5);
    expect(entityVisualHeight({ card: "minions", air: true })).toBe(1.5);
    expect(projectileHitHeight({ card: "lava-hound", air: true, kind: "troop" })).toBe(5.1);
    expect(projectileHitHeight({ card: "lava-pup", air: true, kind: "troop" })).toBe(3.6);
    const models = json("public/assets/animations/manifest.json").files;
    for (const [id, source, clips] of [
      ["lava-hound", "chr_lava_hound", 54],
      ["lava-pup", "chr_lava_pups", 27],
    ] as const) {
      const model = models.find((file: { id: string }) => file.id === id);
      expect(model.clips).toBe(clips);
      expect(model.metadataSha256).toBe(hash(`reference/sc/${source}.bin`));
      expect(deathEffect(id)).toBe(id);
      expect(destructionPlan(id, 7).length).toBeGreaterThan(0);
      expect(destructionPlan(`trail:${id}`, 7).length).toBeGreaterThan(0);
      expect(destructionPlan(`hit:${id}`, 7).length).toBeGreaterThan(0);
      expect(combatAudioPlan(id, "spawn", 7).length).toBeGreaterThan(0);
      // The archive's Hound death group is silent; Pups inherit generic death.
      expect(deathAudioPlan(id, 7).length).toBe(id === "lava-pup" ? 1 : 0);
      expect(combatTraits({ card: id }).projectile?.homing).toBe(true);
      expect(projectileArt({ style: id, team: "blue" } as any)).toBe("particle_coal1");
    }
    expect(json("public/assets/ui/cards/cards.json").portraits["lava-hound"].row)
      .toBe("LavaHound");
    expect(() => new Battle({ deck: ["lava-pup", ...STARTER_DECK.filter((id) => id !== "knight")] }))
      .toThrow("eight unique valid cards");
  });

  it("flies past defenders, aims only at buildings and fires a homing coal", () => {
    const { game, hound } = setup();
    const tower = game.entities.find((e) => e.team === "red" && e.lane === "left")!;
    Object.assign(hound, { x: tower.x, y: tower.y + 2, deploy: 0, cooldown: 0,
      speed: 0 });
    game.players.red.hand[0] = "knight";
    game.players.red.elixir = 10;
    expect(game.play("red", 0, 4, 10).ok).toBe(true);
    const knight = game.entities.find((e) => e.team === "red" && e.card === "knight")!;
    Object.assign(knight, { x: hound.x, y: hound.y + 0.1, deploy: 0,
      active: false, speed: 0, damage: 0 });
    for (let i = 0; i < 50 && !game.projectiles.some((p) => p.style === "lava-hound"); i++)
      game.step();
    expect(hound.target).toBe(tower.id);
    const shot = game.projectiles.find((p) => p.style === "lava-hound")!;
    expect(shot).toMatchObject({ damage: 54, air: true, homing: true,
      speed: 400 / 60, fromHeight: 6.8, toHeight: 1.8 });
    expect(knight.hp).toBe(knight.maxHp);
  });

  it("releases six living air Pups without death damage and mirrors them for the guest", () => {
    const { game, hound } = setup();
    Object.assign(hound, { x: 4, y: 21, deploy: 0, hp: 1 });
    game.players.red.hand[0] = "minions";
    game.players.red.elixir = 10;
    expect(game.play("red", 0, 4, 10).ok).toBe(true);
    const enemy = game.entities.find((e) => e.team === "red" && e.card === "minions")!;
    Object.assign(enemy, { x: 4, y: 20, deploy: 0, active: false, speed: 0,
      damage: 0 });
    const hp = enemy.hp;
    hurt(game, hound, 1);
    expect(enemy.hp).toBe(hp);
    const pups = game.entities.filter((e) => e.card === "lava-pup" && e.team === "blue");
    expect(pups).toHaveLength(6);
    expect(pups.every((e) => e.hp === 217 && e.air && e.deploy === 1)).toBe(true);
    expect(game.audioEvents.filter((e) => e.phase === "spawn" && e.profile === "lava-pup"))
      .toHaveLength(6);
    const guest = perspective(snapshot(game), "red");
    expect(guest.entities.filter((e) => e.card === "lava-pup" && e.team === "red"))
      .toHaveLength(6);
    expect(guest.events?.some((e) => e.type === "death" && e.card === "lava-hound"))
      .toBe(true);
    const pup = pups[0];
    Object.assign(pup, { x: enemy.x, y: enemy.y + 1.5, deploy: 0,
      speed: 0, cooldown: 0 });
    for (let i = 0; i < 40 && !game.projectiles.some((p) => p.style === "lava-pup"); i++)
      game.step();
    expect(game.projectiles.some((p) => p.style === "lava-pup" && p.air && p.damage === 54 && p.fromHeight === 3.6))
      .toBe(true);
  });
});
