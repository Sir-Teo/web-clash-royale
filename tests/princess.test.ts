import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { snapshot } from "../src/network/perspective";
import rules from "../src/game/princess-data.json";
import effects from "../src/render/destruction-data.json";
import deployFilter from "../src/render/deploy-filter-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Princess", () => {
  it("pins her original five-arrow attack, sprite, portrait and effects", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/princess-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      rarity: "Legendary",
      cost: 3,
      sourceHitpoints: 216,
      sourceDamage: 140,
      sourceRange: 9000,
      projectileCount: 5,
      projectile: "PrincessProjectile",
      decorativeProjectile: "PrincessProjectileDeco",
      projectileExport: "projectile_princess",
      hitEffect: "PrincessArrowHitGround",
      trailEffect: "PrincessArrowProjectileEmitter",
      splash: 2.5,
    });
    expect(CARD_MAP.princess).toMatchObject({
      cost: 3,
      rarity: "Legendary",
      hp: 261,
      damage: 169,
      range: 9,
      interval: 3,
      hitsAir: true,
      splash: 2.5,
    });
    expect(combatTraits({ card: "princess" }).projectile).toMatchObject({
      source: "PrincessProjectileDeco",
      speed: 450 / 60,
      homing: false,
    });
    const animations = JSON.parse(
      readFileSync("public/assets/animations/manifest.json", "utf8"),
    );
    const sprite = animations.files.find(
      (file: { id: string }) => file.id === "princess",
    );
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_princess.bin"));
    const clipData = JSON.parse(
      readFileSync("public/assets/animations/princess.json", "utf8"),
    );
    expect(clipData.clips["blue-run-9"]).toMatchObject({
      source: "princess_run1_8",
      emptySource: "princess_run1_9",
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.princess.row).toBe("Princess");
    expect(deployFilter.legendary.cards).toContain("princess");
    expect(
      projectileArt({ style: "princess" } as Parameters<
        typeof projectileArt
      >[0]),
    ).toBe("projectile_princess");
    expect(impactEffect("princess")).toBe("hit:princess");
    expect(effects.impacts["hit:princess"].source).toBe(
      "PrincessArrowHitGround",
    );
    expect(effects.trails.princess.source).toBe(
      "PrincessArrowProjectileEmitter",
    );
    expect(destructionPlan("trail:princess", 8).length).toBeGreaterThan(0);
  });

  it("fires five arrows while only the custom first arrow deals splash damage", () => {
    const battle = new Battle({
      seed: 7,
      ai: false,
      deck: ["princess", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "princess";
    battle.players.blue.elixir = 10;
    battle.players.red.hand[0] = "knight";
    battle.players.red.hand[1] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    expect(battle.play("red", 1, 4, 10).ok).toBe(true);
    const archer = battle.entities.find((e) => e.card === "princess")!;
    const knight = battle.entities.find(
      (e) => e.card === "knight" && e.team === "red",
    )!;
    const minion = battle.entities.find(
      (e) => e.card === "minions" && e.team === "red",
    )!;
    Object.assign(archer, { x: 4, y: 17, deploy: 0, cooldown: 0 });
    Object.assign(knight, {
      x: 4,
      y: 12,
      deploy: 0,
      active: false,
      hp: 10000,
      maxHp: 10000,
    });
    Object.assign(minion, {
      x: 5,
      y: 12,
      deploy: 0,
      active: false,
      hp: 10000,
      maxHp: 10000,
    });
    for (
      let i = 0;
      i < 60 && !battle.projectiles.some((p) => p.source === archer.id);
      i++
    )
      battle.step();
    const shots = battle.projectiles.filter((p) => p.source === archer.id);
    expect(shots).toHaveLength(5);
    expect(shots.filter((p) => p.decorative)).toHaveLength(4);
    expect(shots.filter((p) => p.damage > 0)).toHaveLength(1);
    expect(shots.find((p) => p.damage > 0)).toMatchObject({
      splash: 2.5,
      air: true,
      target: knight.id,
      style: "princess",
    });
    expect(
      snapshot(battle).projectiles.filter((p) => p.style === "princess"),
    ).toHaveLength(5);
    archer.active = false;
    for (
      let i = 0;
      i < 60 && battle.projectiles.some((p) => p.source === archer.id);
      i++
    )
      battle.step();
    expect(knight.hp).toBe(10000 - CARD_MAP.princess.damage);
    expect(minion.hp).toBe(10000 - CARD_MAP.princess.damage);
  });
});
