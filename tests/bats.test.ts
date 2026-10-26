import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { deploymentPositions } from "../src/game/deployment";
import { Battle } from "../src/game/engine";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import rules from "../src/game/bats-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Bats", () => {
  it("pins the five-creature source rules, portrait, model and sounds", () => {
    const manifest = json("reference/client/bats-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Bats", source: "Bat", cost: 2, count: 5, summonRadius: 0.75,
      sourceHitpoints: 32, sourceDamage: 32, sourceSpeed: 120,
      sourceHitSpeed: 1, sourceLoadTime: 0.5, sourceRange: 1.2,
      flyingHeight: 2, attackDashTime: 0.15, deployDelay: 0.4,
      loopingFilter: "filter_wiggle",
    });
    expect(CARD_MAP.bats).toMatchObject({
      hp: 83, damage: 83, cost: 2, count: 5,
      air: true, hitsAir: true, range: 1.2,
    });
    const model = json("public/assets/animations/manifest.json").files
      .find((file: { id: string }) => file.id === "bats");
    expect(model.clips).toBe(27);
    expect(model.metadataSha256).toBe(hash("reference/sc/chr_bats.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits.bats.row).toBe("Bats");
    expect(combatAudioPlan("bats", "attack", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("bats", "spawn", 7).length).toBeGreaterThan(0);
  });

  it("deploys five within source radius and attacks a flying target on both peers", () => {
    const positions = deploymentPositions("bats", { x: 4, y: 22 });
    expect(positions).toHaveLength(5);
    expect(positions.every((p) => Math.hypot(p.x - 4, p.y - 22) <= 0.750001)).toBe(true);
    const battle = new Battle({
      seed: 54, ai: false,
      deck: ["bats", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "bats";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const bats = battle.entities.filter((e) => e.card === "bats");
    expect(bats).toHaveLength(5);
    expect(bats.every((e) => e.deploy === 1 && e.air)).toBe(true);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.filter((e) => e.card === "bats")).toHaveLength(5);
    for (const bat of bats) Object.assign(bat, { x: 4, y: 21, deploy: 0, speed: 0, cooldown: 0 });
    battle.players.red.hand[0] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const targets = battle.entities.filter((e) => e.team === "red" && e.card === "minions");
    for (const [index, target] of targets.entries())
      Object.assign(target, { x: index ? 14 : 4, y: 20, deploy: 0, speed: 0,
        damage: 0, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < 90 && targets[0].hp === 10000; i++) battle.step();
    expect(targets[0].hp).toBeLessThan(10000);
    expect(targets[1].hp).toBe(10000);
  });
});
