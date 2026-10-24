import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { snapshot } from "../src/network/perspective";
import { continuousEffect, destructionPlan, impactEffect } from "../src/render/destruction";
import rules from "../src/game/inferno-tower-data.json" with { type: "json" };
import effects from "../src/render/destruction-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Inferno Tower", () => {
  it("pins its building art, portrait, three beam stages, and source effects", () => {
    const manifest = JSON.parse(readFileSync("reference/client/inferno-tower-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 5, rarity: "Rare", sourceHitpoints: 800,
      sourceDamage: [20, 75, 400], stageDurations: [2, 2],
      hitSpeed: 0.4, range: 6, lifetime: 40, hitsAir: true,
      beamArt: ["inferno_beam", "inferno_beam_stage2", "inferno_beam_stage3"],
    });
    expect(CARD_MAP["inferno-tower"]).toMatchObject({
      hp: 2048, damage: 51, cost: 5, rarity: "Rare",
      hitsAir: true, range: 6, interval: 0.4,
    });
    const buildings = JSON.parse(readFileSync("public/assets/buildings/manifest.json", "utf8"));
    const sprite = buildings.files.find((file: { id: string }) => file.id === "inferno-tower");
    expect(sprite.metadataSha256).toBe(hash("reference/sc/building_inferno_tower.bin"));
    const art = JSON.parse(readFileSync("public/assets/buildings/inferno-tower.json", "utf8"));
    expect(Object.keys(art.clips)).toEqual(["blue", "red"]);
    for (const clip of Object.values(art.clips) as { frames: number[] }[])
      expect(clip.frames).toHaveLength(1);
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits["inferno-tower"].row).toBe("InfernoTower");
    const native = JSON.parse(readFileSync("public/assets/effects/effects.json", "utf8"));
    for (const name of rules.beamArt) expect(native.clips[name].frames).toHaveLength(80);
    for (const name of rules.muzzleArt) expect(native.clips[name].frames).toHaveLength(30);
    expect(impactEffect("inferno-tower")).toBe("hit:inferno-tower");
    expect(effects.impacts["hit:inferno-tower"].source).toBe("inferno_hit_effect");
    expect(destructionPlan("hit:inferno-tower", 7).length).toBeGreaterThan(0);
    expect(continuousEffect("inferno-tower")).toBe("continuous:inferno-tower");
  });

  it("ramps against a ground target, syncs the stage, and resets after stun", () => {
    const battle = new Battle({
      seed: 7, ai: false,
      deck: ["inferno-tower", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "inferno-tower";
    battle.players.red.hand[0] = "knight";
    battle.players.blue.elixir = battle.players.red.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const inferno = battle.entities.find((e) => e.card === "inferno-tower")!;
    const target = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    Object.assign(inferno, { x: 4, y: 21, deploy: 0 });
    Object.assign(target, { x: 4, y: 18, deploy: 0, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < 160; i++) battle.step();
    const hits = battle.events.filter((event) => event.type === "hit" && event.card === "inferno-tower");
    expect(hits.map((event) => event.value)).toContain(51);
    expect(hits.map((event) => event.value)).toContain(192);
    expect(hits.map((event) => event.value)).toContain(1024);
    expect(inferno.inferno).toMatchObject({ target: target.id, stage: 2 });
    expect(snapshot(battle).entities.find((e) => e.id === inferno.id)?.inferno?.stage).toBe(2);
    inferno.stun = 0.5;
    battle.step();
    expect(inferno.inferno).toBeUndefined();
    for (let i = 0; i < Math.ceil(0.5 / STEP) + 2; i++) battle.step();
    expect(inferno.inferno?.stage).toBe(0);
  });

  it("acquires an airborne target and keeps the lock in the guest snapshot", () => {
    const battle = new Battle({ seed: 19, ai: false });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "inferno-tower";
    battle.players.red.hand[0] = "minions";
    battle.players.blue.elixir = battle.players.red.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const inferno = battle.entities.find((e) => e.card === "inferno-tower")!;
    const minions = battle.entities.filter((e) => e.card === "minions" && e.team === "red");
    Object.assign(inferno, { x: 4, y: 21, deploy: 0 });
    for (const target of minions)
      Object.assign(target, { x: 4, y: 18, deploy: 0, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < 36; i++) battle.step();
    expect(battle.events.some((event) => event.type === "hit" && event.card === "inferno-tower")).toBe(true);
    expect(minions.some((target) => target.hp < target.maxHp)).toBe(true);
    expect(snapshot(battle).entities.find((e) => e.id === inferno.id)?.inferno?.target)
      .toBe(inferno.inferno?.target);
  });
});
