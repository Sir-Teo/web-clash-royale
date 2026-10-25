import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { executionerFlightPoint, executionerFlightSeconds, projectileArt } from "../src/render/projectiles";
import rules from "../src/game/executioner-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Executioner", () => {
  it("pins the Epic card, 72 native unit clips and spinning axe sources", () => {
    const manifest = json("reference/client/executioner-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 5, rarity: "Epic", sourceHitpoints: 760, sourceRange: 4.5,
      projectile: { damage: 100, speed: 550 / 60, radius: 1,
        range: 6.5, minDistance: 4.5, visualTime: 1.5,
        export: "executioner_projectile", shadowExport: "bowler_projectile_shadow",
        hitsAir: true, hitsGround: true },
    });
    expect(CARD_MAP.executioner).toMatchObject({ hp: 1224, damage: 161,
      cost: 5, interval: 2.4, range: 4.5, hitsAir: true, splash: 1 });
    const sprite = json("public/assets/animations/manifest.json").files.find((file: { id: string }) => file.id === "executioner");
    expect(sprite.clips).toBe(72);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_axe_man.bin"));
    expect(json("public/assets/effects/effects.json").clips.executioner_projectile.frames).toHaveLength(60);
    expect(json("public/assets/ui/cards/cards.json").portraits.executioner.row).toBe("AxeMan");
    expect(impactEffect("executioner")).toBe("hit:executioner");
    expect(destructionPlan("trail:executioner", 13).length).toBeGreaterThan(0);
    expect(destructionPlan("axe-die", 13).length).toBeGreaterThan(0);
  });

  it("hits ground and air once in each direction without steering mid-flight", () => {
    const battle = new Battle({ seed: 51, ai: false,
      deck: ["executioner", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "executioner";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const thrower = battle.entities.find((e) => e.card === "executioner")!;
    Object.assign(thrower, { x: 4, y: 21, deploy: 0, speed: 0 });
    const victims = [];
    for (const [card, y] of [["knight", 18], ["minions", 16.5]] as const) {
      battle.players.red.hand[0] = card;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const spawned = battle.entities.filter((e) => e.team === "red" && e.card === card);
      for (const [index, e] of spawned.entries())
        Object.assign(e, { x: index ? 14 : 4, y, deploy: 0,
          hp: 10000, maxHp: 10000, speed: 0, damage: 0, active: false });
      victims.push(spawned[0]);
    }
    for (let i = 0; i < 100 && !battle.projectiles.some((p) => p.style === "executioner"); i++) battle.step();
    const axe = battle.projectiles.find((p) => p.style === "executioner")!;
    expect(axe).toBeTruthy();
    expect(axe.homing).toBe(false);
    expect(axe.turn).toBeTruthy();
    expect(projectileArt(axe)).toBe("executioner_projectile");
    expect(executionerFlightSeconds(axe)).toBeGreaterThan(0.8);
    expect(executionerFlightPoint(axe, 0).z).toBeCloseTo(20.4 - 16);
    const guestAxe = perspective(snapshot(battle), "red").projectiles.find((p) => p.id === axe.id)!;
    expect(guestAxe.turn).toEqual({ x: 18 - axe.turn!.x, y: 32 - axe.turn!.y });
    for (let i = 0; i < 100 && battle.projectiles.some((p) => p.id === axe.id); i++) battle.step();
    expect(battle.projectiles.some((p) => p.id === axe.id)).toBe(false);
    expect(victims.map((e) => e.hp)).toEqual([9678, 9678]);
    expect(battle.events.filter((e) => e.type === "hit" && e.card === "executioner" && e.value === 161)).toHaveLength(4);
    expect(battle.events.some((e) => e.effect === "axe-die")).toBe(true);
  });
});
