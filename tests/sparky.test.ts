import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatAudioPlan } from "../src/game/combat-audio";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/sparky-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function scene() {
  const battle = new Battle({ seed: 52, ai: false,
    deck: ["sparky", ...STARTER_DECK.filter((id) => id !== "arrows")],
  });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "sparky";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const sparky = battle.entities.find((e) => e.card === "sparky")!;
  Object.assign(sparky, { x: 4, y: 21, deploy: 0, speed: 0,
    cooldown: rules.sourceLoadTime });
  const victims = [];
  for (const [card, x] of [["knight", 4], ["knight", 4.8], ["minions", 4.5]] as const) {
    battle.players.red.hand[0] = card;
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const spawned = battle.entities.filter((e) => e.team === "red" &&
      e.card === card && e.deploy > 0);
    for (const [index, e] of spawned.entries())
      Object.assign(e, { x: index ? 14 : x, y: 18, deploy: 0,
        hp: 10000, maxHp: 10000, speed: 0, damage: 0, active: false });
    victims.push(spawned[0]);
  }
  return { battle, sparky, victims };
}

describe("archived Sparky", () => {
  it("pins charge stages, ground-only cannon and 54 directional model clips", () => {
    const manifest = json("reference/client/sparky-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ cost: 6, rarity: "Legendary",
      sourceHitpoints: 1200, sourceHitSpeed: 5, sourceLoadTime: 4.5,
      loadsBeforeFirstHit: true, ignoresPushback: true, pushback: 0.75,
      projectile: { damage: 1300, speed: 1400 / 60,
        radius: 1.8, homing: true, hitsGround: true, hitsAir: false } });
    expect(CARD_MAP.sparky).toMatchObject({ hp: 1452, damage: 1573,
      cost: 6, range: 4.5, interval: 5, hitsAir: false, splash: 1.8 });
    const model = json("public/assets/animations/manifest.json").files.find((file: {id:string}) => file.id === "sparky");
    expect(model.clips).toBe(54);
    expect(model.metadataSha256).toBe(hash("reference/sc/chr_zap_machine.bin"));
    expect(json("public/assets/effects/effects.json").clips.zapMachine_projectile.frames).toHaveLength(10);
    expect(json("public/assets/ui/cards/cards.json").portraits.sparky.row).toBe("ZapMachine");
    expect(impactEffect("sparky")).toBe("hit:sparky");
    expect(destructionPlan("trail:sparky", 7).length).toBeGreaterThan(0);
    for (const phase of ["load-1", "load-2", "load-3", "load-ready"] as const)
      expect(combatAudioPlan("sparky", phase, 7).length).toBeGreaterThan(0);
  });

  it("charges before the first shot and splashes nearby ground defenders only", () => {
    const { battle, sparky, victims } = scene();
    for (let i = 0; i < 145; i++) battle.step();
    expect(battle.projectiles.some((p) => p.style === "sparky")).toBe(false);
    expect(sparky.sparkyCharge).toBeGreaterThan(4.4);
    for (let i = 0; i < 20 && !battle.projectiles.some((p) => p.style === "sparky"); i++) battle.step();
    const shot = battle.projectiles.find((p) => p.style === "sparky")!;
    expect(shot).toBeTruthy();
    expect(projectileArt(shot)).toBe("zapMachine_projectile");
    expect(shot.homing).toBe(true);
    for (let i = 0; i < 20 && battle.projectiles.some((p) => p.id === shot.id); i++) battle.step();
    expect(victims.map((e) => e.hp)).toEqual([8427, 8427, 10000]);
    expect(victims[0].y).toBeLessThan(18);
    expect(victims[1].x).toBeGreaterThan(4.8);
    expect(battle.events.some((e) => e.type === "hit" && e.card === "sparky")).toBe(true);
    expect(battle.audioEvents.filter((e) => e.profile === "sparky" &&
      e.phase.startsWith("load-")).map((e) => e.phase))
      .toEqual(["load-1", "load-2", "load-3", "load-ready"]);
  });

  it("loses its charge to Zap and needs another load before firing", () => {
    const { battle, sparky } = scene();
    for (let i = 0; i < 75; i++) battle.step();
    expect(sparky.sparkyCharge).toBeGreaterThan(2);
    battle.players.red.hand[0] = "zap";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 10; i++) battle.step();
    expect(sparky.sparkyCharge).toBe(0);
    expect(sparky.cooldown).toBeCloseTo(rules.sourceLoadTime);
    const resetAt = battle.time;
    while (battle.time < resetAt + 4 && !battle.projectiles.some((p) => p.style === "sparky")) battle.step();
    expect(battle.projectiles.some((p) => p.style === "sparky")).toBe(false);
    expect(sparky.sparkyCharge).toBeGreaterThan(3.5);
    for (let i = 0; i < Math.ceil(1.5 / STEP) &&
      !battle.projectiles.some((p) => p.style === "sparky"); i++) battle.step();
    expect(battle.projectiles.some((p) => p.style === "sparky")).toBe(true);
  });
});
