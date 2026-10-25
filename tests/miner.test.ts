import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { destructionPlan } from "../src/render/destruction";
import { deployFilterFrame, hasNativeDeployFilter } from "../src/render/deploy-filter";
import { snapshot } from "../src/network/perspective";
import rules from "../src/game/miner-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Miner", () => {
  it("pins his native art, travel rocks, digging trail and distinct deploy filter", () => {
    const manifest = json("reference/client/miner-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 3, rarity: "Legendary", enemySide: true,
      sourceHitpoints: 1000, sourceDamage: 160,
      travelSpeed: 650 / 60, crownTowerDamageFraction: 0.4,
      travelEffect: "miner_travel_effect", deployFilter: "filter_deploy_unit_miner",
    });
    expect(CARD_MAP.miner).toMatchObject({
      hp: 1210, damage: 194, cost: 3, range: 1.3, interval: 1.2,
    });
    const sprite = json("public/assets/animations/manifest.json").files.find((file: { id: string }) => file.id === "miner");
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_miner.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits.miner.row).toBe("Miner");
    expect(json("public/assets/effects/effects.json").clips.miner_trail.frames).toHaveLength(39);
    expect(json("src/render/destruction-data.json").impacts["miner-travel"].source).toBe("miner_travel_effect");
    expect(destructionPlan("miner-travel", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("trail:miner", 7).length).toBeGreaterThan(0);
    expect(hasNativeDeployFilter("miner")).toBe(true);
    expect(json("src/render/deploy-filter-data.json").miner.frames).toHaveLength(45);
    expect(deployFilterFrame(44 / 60, false, true)).toBe(44);
    expect(deployFilterFrame(45 / 60, false, true)).toBe(-1);
  });

  it("tunnels to the enemy side, emerges there and deals reduced tower damage", () => {
    const battle = new Battle({ seed: 21, ai: false,
      deck: ["miner", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "miner";
    battle.players.blue.elixir = 10;
    expect(battle.canPlace("blue", "miner", 4, 8).ok).toBe(true);
    expect(battle.canPlace("blue", "knight", 4, 8).ok).toBe(false);
    expect(battle.canPlace("blue", "miner", 4, 16).ok).toBe(false);
    expect(battle.play("blue", 0, 4, 8).ok).toBe(true);
    expect(battle.entities.some((e) => e.card === "miner")).toBe(false);
    const travel = battle.projectiles.find((p) => p.style === "miner-travel")!;
    expect(travel.duration).toBeGreaterThan(1);
    expect(snapshot(battle).projectiles.some((p) => p.id === travel.id && p.style === "miner-travel")).toBe(true);
    for (let i = 0; i < Math.ceil(travel.duration / STEP) + 1; i++) battle.step();
    expect(battle.projectiles.some((p) => p.id === travel.id)).toBe(false);
    const miner = battle.entities.find((e) => e.card === "miner" && e.team === "blue")!;
    expect(miner).toMatchObject({ x: 4, y: 8 });
    expect(miner.deploy).toBeGreaterThan(0.9);
    expect(battle.events.some((e) => e.type === "deploy" && e.card === "miner" && e.y === 8)).toBe(true);
    miner.y = 7;
    miner.deploy = 0;
    const tower = battle.entities.find((e) => e.kind === "tower" && !e.king && e.team === "red" && e.x === 4)!;
    for (let i = 0; i < 60 && !battle.events.some((e) => e.type === "hit" && e.card === "miner"); i++) battle.step();
    const hit = battle.events.find((e) => e.type === "hit" && e.card === "miner")!;
    expect(hit.value).toBe(78);
    expect(tower.hp).toBe(tower.maxHp - 78);
  });
});
