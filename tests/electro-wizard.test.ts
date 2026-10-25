import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { impactEffect } from "../src/render/destruction";
import rules from "../src/game/electro-wizard-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Electro Wizard", () => {
  it("pins the 46th card, native two-target beam and 54 animation clips", () => {
    const manifest = json("reference/client/electro-wizard-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 4, rarity: "Legendary", sourceHitpoints: 600,
      sourceDamage: 100, targets: 2, stun: 0.5,
      beam: "electro_wizard_beam", hitEffect: "electro_wizard_hit",
      deployZap: { sourceDamage: 75, radius: 2.5, levelIndex: 8, stun: 0.5 },
    });
    expect(CARD_MAP["electro-wizard"]).toMatchObject({
      hp: 726, damage: 121, cost: 4, range: 5, interval: 1.7, hitsAir: true,
    });
    const files = json("public/assets/animations/manifest.json").files;
    const sprite = files.find((file: { id: string }) => file.id === "electro-wizard");
    expect(sprite.clips).toBe(54);
    expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_electro_wizard.bin"));
    expect(json("public/assets/ui/cards/cards.json").portraits["electro-wizard"].row).toBe("ElectroWizard");
    expect(json("public/assets/effects/effects.json").clips.electro_wiz_beam.frames).toHaveLength(23);
    expect(impactEffect("electro-wizard")).toBe("hit:electro-wizard");
  });

  it("Zaps nearby enemies on arrival, then strikes and stuns two at once", () => {
    const battle = new Battle({ seed: 17, ai: false,
      deck: ["electro-wizard", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "electro-wizard";
    battle.players.red.hand[0] = "knight";
    battle.players.blue.elixir = battle.players.red.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    for (let i = 0; i < 2; i++) {
      battle.players.red.hand[0] = "knight";
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    }
    const wizard = battle.entities.find((e) => e.card === "electro-wizard")!;
    const targets = battle.entities.filter((e) => e.card === "knight" && e.team === "red");
    Object.assign(wizard, { x: 4, y: 21 });
    for (const [i, target] of targets.entries())
      Object.assign(target, { x: 4 + i, y: 19.3, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < Math.ceil(1 / STEP) + 1; i++) battle.step();
    expect(battle.events.some((e) => e.type === "hit" && e.card === "zap")).toBe(true);
    for (const target of targets) {
      expect(target.hp).toBe(9839);
      expect(target.stun).toBeGreaterThan(0);
    }
    for (let i = 0; i < 35 && battle.events.filter((e) => e.card === "electro-wizard").length < 2; i++) battle.step();
    const hits = battle.events.filter((e) => e.type === "hit" && e.card === "electro-wizard");
    expect(hits).toHaveLength(2);
    expect(hits[0].time).toBe(hits[1].time);
    expect(hits.map((e) => e.value)).toEqual([121, 121]);
    expect(hits.every((e) => e.origin?.x === 4 && e.origin.height === 1.5)).toBe(true);
    for (const target of targets) expect(target.hp).toBe(9718);
  });
});
