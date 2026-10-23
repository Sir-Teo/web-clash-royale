import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { snapshot } from "../src/network/perspective";
import { deployFilterFrame, hasNativeDeployFilter } from "../src/render/deploy-filter";
import deployFilter from "../src/render/deploy-filter-data.json";
import rules from "../src/game/ice-wizard-data.json";
import effects from "../src/render/destruction-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Ice Wizard", () => {
  it("pins the original card, projectile, slow buff, art and effects", () => {
    const manifest = JSON.parse(readFileSync("reference/client/ice-wizard-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      rarity: "Legendary", cost: 3, sourceHitpoints: 665,
      sourceDamage: 63, projectileRadius: 1, slowDuration: 2,
      speedMultiplier: 0.65, hitSpeedMultiplier: 0.65,
      spawnSpeedMultiplier: 0.65, audioPitchMultiplier: 0.75,
    });
    expect(CARD_MAP["ice-wizard"]).toMatchObject({
      rarity: "Legendary", kind: "troop", cost: 3, hitsAir: true, splash: 1,
      hp: 805, damage: 76,
    });
    expect(combatTraits({ card: "ice-wizard" }).projectile).toMatchObject({
      source: "ice_wizardProjectile", speed: 700 / 60, homing: true,
    });
    const animations = JSON.parse(readFileSync("public/assets/animations/manifest.json", "utf8"));
    const sprite = animations.files.find((file: {id: string}) => file.id === "ice-wizard");
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_ice_wizard.bin"));
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits["ice-wizard"].row).toBe("IceWizard");
    expect(projectileArt({ style: "ice-wizard" } as Parameters<typeof projectileArt>[0]))
      .toBe("ice_wizard_projectile");
    expect(impactEffect("ice-wizard")).toBe("hit:ice-wizard");
    expect(effects.impacts["hit:ice-wizard"].source).toBe("ice_wizard_hit");
    expect(effects.trails["ice-wizard"].source).toBe("ice_wiz_emitter");
    expect(destructionPlan("trail:ice-wizard", 5).length).toBe(95);
    expect(hasNativeDeployFilter("ice-wizard")).toBe(true);
    expect(deployFilter.legendary).toMatchObject({
      source: "filter_deploy_unit_legendary", cards: ["ice-wizard", "princess", "inferno-dragon", "electro-wizard", "sparky", "night-witch", "bandit"], fps: 60,
    });
    expect(deployFilter.legendary.frames).toHaveLength(31);
    expect(deployFilterFrame(30 / 60, true)).toBe(30);
    expect(deployFilterFrame(31 / 60, true)).toBe(-1);
  });

  it("slows air and ground targets in its splash for two seconds, then restores speed", () => {
    const battle = new Battle({ seed: 7, ai: false, deck: ["ice-wizard", ...STARTER_DECK.filter((id) => id !== "arrows")] });
    for (const tower of battle.entities) tower.active = false;
    battle.players.red.elixir = 10;
    battle.players.red.hand[0] = "knight";
    battle.players.red.hand[1] = "minions";
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    expect(battle.play("red", 1, 4, 10).ok).toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    const minion = battle.entities.find((e) => e.card === "minions" && e.team === "red")!;
    Object.assign(knight, { x: 4, y: 12, active: false, deploy: 0, cooldown: 1 });
    Object.assign(minion, { x: 4.5, y: 12, active: false, deploy: 0 });
    battle.projectiles.push({
      id: 999, team: "blue", x: 4, y: 15, tx: 4, ty: 12, target: knight.id,
      damage: 10, remaining: STEP, duration: STEP, splash: rules.projectileRadius,
      air: true, style: "ice-wizard", stun: 0, slow: rules.slowDuration, source: 1,
    });
    battle.step();
    expect(knight.slow?.remaining).toBeCloseTo(2);
    expect(minion.slow?.remaining).toBeCloseTo(2);
    expect(snapshot(battle).entities.find((e) => e.id === knight.id)?.slow?.remaining).toBeCloseTo(2);
    knight.active = true;
    knight.cooldown = 1;
    const beforeMove = knight.y;
    battle.step();
    expect(knight.cooldown).toBeCloseTo(1 - STEP * rules.hitSpeedMultiplier);
    expect(knight.y - beforeMove).toBeCloseTo(CARD_MAP.knight.speed * STEP * rules.speedMultiplier);
    knight.active = false;
    for (let i = 0; i < 60; i++) battle.step();
    expect(knight.slow).toBeUndefined();
    expect(minion.slow).toBeUndefined();
  });
});
