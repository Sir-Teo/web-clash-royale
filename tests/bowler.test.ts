import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/bowler-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Bowler", () => {
  it("pins the epic card, native boulder and particle sources", () => {
    const manifest = json("reference/client/bowler-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 5, rarity: "Epic", sourceHitpoints: 1200,
      projectile: { damage: 180, speed: 170 / 60, range: 6, radius: 1.8, knockback: 1,
        export: "bowler_projectile", shadowExport: "bowler_projectile_shadow" },
    });
    expect(CARD_MAP.bowler).toMatchObject({ hp: 1933, damage: 290, cost: 5,
      range: 5, interval: 2.5 });
    const sprite = json("public/assets/animations/manifest.json").files.find((file: { id: string }) => file.id === "bowler");
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_bowler.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits.bowler.row).toBe("Bowler");
    const effects = json("public/assets/effects/effects.json").clips;
    expect(effects.bowler_projectile.frames.length).toBeGreaterThan(0);
    expect(effects.bowler_projectile_shadow.frames.length).toBeGreaterThan(0);
    expect(impactEffect("bowler")).toBe("hit:bowler");
    expect(destructionPlan("trail:bowler", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("hit:bowler", 7).length).toBeGreaterThan(0);
    expect(projectileArt({ style: "bowler", team: "blue" } as any)).toBe("bowler_projectile");
  });

  it("rolls through several ground enemies once each, pushing them but ignoring air", () => {
    const battle = new Battle({ seed: 29, ai: false,
      deck: ["bowler", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "bowler";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const bowler = battle.entities.find((e) => e.card === "bowler")!;
    Object.assign(bowler, { x: 4, y: 21, deploy: 0, speed: 0 });
    const victims = [];
    for (const [i, card] of ["knight", "knight", "minions"].entries()) {
      battle.players.red.hand[0] = card as any;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const spawned = battle.entities.filter((e) => e.card === card && e.team === "red");
      const victim = spawned.at(-1)!;
      Object.assign(victim, { x: 4, y: [18, 16.2, 17][i], deploy: 0,
        speed: 0, hp: 10000, maxHp: 10000, damage: 0, active: false });
      victims.push(victim);
    }
    for (let i = 0; i < 100 && !battle.projectiles.some((p) => p.style === "bowler"); i++) battle.step();
    const boulder = battle.projectiles.find((p) => p.style === "bowler")!;
    expect(boulder).toBeTruthy();
    expect(boulder.target).toBeNull();
    expect(Math.hypot(boulder.tx - boulder.x, boulder.ty - boulder.y)).toBeCloseTo(6, 3);
    for (let i = 0; i < 90 && battle.projectiles.some((p) => p.id === boulder.id); i++) battle.step();
    expect(battle.projectiles.some((p) => p.id === boulder.id)).toBe(false);
    expect(victims[0].hp).toBe(9710);
    expect(victims[1].hp).toBe(9710);
    expect(victims[0].y).toBeLessThan(18);
    expect(victims[1].y).toBeLessThan(16.2);
    expect(victims[2].hp).toBe(10000);
    expect(boulder.rollHits).toContain(victims[0].id);
    expect(boulder.rollHits).toContain(victims[1].id);
    expect(boulder.rollHits).not.toContain(victims[2].id);
  });
});
