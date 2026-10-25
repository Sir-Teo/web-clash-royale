import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { snapshot } from "../src/network/perspective";
import rules from "../src/game/inferno-dragon-data.json";
import effects from "../src/render/destruction-data.json";
import deployFilter from "../src/render/deploy-filter-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Inferno Dragon", () => {
  it("pins its flying Legendary card, 54 clips, portrait and three native beam stages", () => {
    const manifest = JSON.parse(readFileSync("reference/client/inferno-dragon-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 4, rarity: "Legendary", sourceHitpoints: 1000,
      sourceDamage: [30, 100, 350], stageDurations: [2, 2],
      sourceHitSpeed: 400, sourceRange: 4000, sourceFlyingHeight: 4000,
      beams: ["inferno_dragon_beam_lvl1", "inferno_dragon_beam_lvl2", "inferno_dragon_beam_lvl3"],
      hitEffect: "inferno_hit_effect", hitsAir: true,
    });
    expect(CARD_MAP["inferno-dragon"]).toMatchObject({
      hp: 1210, damage: 36, cost: 4, rarity: "Legendary",
      air: true, hitsAir: true, range: 4, interval: 0.4,
    });
    const animations = JSON.parse(readFileSync("public/assets/animations/manifest.json", "utf8"));
    const sprite = animations.files.find((file: { id: string }) => file.id === "inferno-dragon");
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_baby_dragon.bin"));
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits["inferno-dragon"].row).toBe("InfernoDragon");
    expect(deployFilter.legendary.cards).toContain("inferno-dragon");
    const native = JSON.parse(readFileSync("public/assets/effects/effects.json", "utf8"));
    for (const name of ["inferno_dragon_beam", "inferno_dragon_beam1", "inferno_dragon_beam2"])
      expect(native.clips[name].frames).toHaveLength(80);
    expect(impactEffect("inferno-dragon")).toBe("hit:inferno-dragon");
    expect(effects.impacts["hit:inferno-dragon"].source).toBe("inferno_hit_effect");
    expect(destructionPlan("hit:inferno-dragon", 7).length).toBeGreaterThan(0);
  });

  it("ramps only while locked, damages every 400 ms and resets after stun", () => {
    const battle = new Battle({
      seed: 7, ai: false,
      deck: ["inferno-dragon", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "inferno-dragon";
    battle.players.red.hand[0] = "knight";
    battle.players.blue.elixir = battle.players.red.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const dragon = battle.entities.find((e) => e.card === "inferno-dragon")!;
    const target = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    Object.assign(dragon, { x: 4, y: 21, deploy: 0 });
    Object.assign(target, { x: 4, y: 18, deploy: 0, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < 160; i++) battle.step();
    const hits = battle.events.filter((event) => event.type === "hit" && event.card === "inferno-dragon");
    expect(hits.map((event) => event.value)).toContain(36);
    expect(hits.map((event) => event.value)).toContain(121);
    expect(hits.map((event) => event.value)).toContain(424);
    expect(dragon.inferno).toMatchObject({ target: target.id, stage: 2 });
    expect(snapshot(battle).entities.find((e) => e.id === dragon.id)?.inferno?.stage).toBe(2);
    dragon.stun = 0.5;
    battle.step();
    expect(dragon.inferno).toBeUndefined();
    for (let i = 0; i < Math.ceil(0.5 / STEP) + 2; i++) battle.step();
    expect(dragon.inferno?.stage).toBe(0);
  });
});
