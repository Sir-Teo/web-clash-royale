import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { destructionPlan } from "../src/render/destruction";
import { healthSelection } from "../src/ui/health-data";
import { combatAudioPlan } from "../src/game/combat-audio";
import rules from "../src/game/dark-prince-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const makeBattle = () => {
  const battle = new Battle({ seed: 37, ai: false,
    deck: ["dark-prince", ...STARTER_DECK.filter((id) => id !== "arrows")],
  });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "dark-prince";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const prince = battle.entities.find((e) => e.card === "dark-prince")!;
  Object.assign(prince, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { battle, prince };
};

describe("archived Dark Prince", () => {
  it("pins both native sprite forms, shield HUD and charge sources", () => {
    const manifest = json("reference/client/dark-prince-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 4, rarity: "Epic", sourceHitpoints: 735,
      sourceShieldHitpoints: 200, sourceDamage: 145,
      sourceChargeDamage: 290, splash: 1, chargeRange: 2.5,
      chargeSpeedMultiplier: 2, shieldBreakEffect: "GuardShieldDown",
    });
    expect(CARD_MAP["dark-prince"]).toMatchObject({
      cost: 4, hp: 1184, damage: 234, range: 1.05, interval: 1.5, splash: 1,
    });
    const files = json("public/assets/animations/manifest.json").files;
    for (const id of ["dark-prince", "dark-prince-shield"]) {
      const sprite = files.find((file: { id: string }) => file.id === id);
      expect(sprite.clips).toBe(72);
      expect(sprite.metadataSha256).toBe(hash("reference/sc/chr_black_knight.bin"));
    }
    expect(json("public/assets/ui/cards/cards.json").portraits["dark-prince"].row).toBe("DarkPrince");
    const health = json("public/assets/ui/health/health.json");
    expect(health.clips.hp_shield_player_medium_bar.frames).toHaveLength(100);
    expect(health.clips.hp_shield_enemy_medium_bar.frames).toHaveLength(100);
    expect(destructionPlan("shield:dark-prince", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("charge:dark-prince", 7).length).toBeGreaterThan(0);
    expect(combatAudioPlan("dark-prince", "charge", 7).length).toBeGreaterThan(0);
  });

  it("absorbs one full hit with its shield and then exposes body health", () => {
    const { battle, prince } = makeBattle();
    const health = json("public/assets/ui/health/health.json");
    expect(prince.shield).toBe(322);
    expect(healthSelection(health, prince).name).toBe("hp_shield_player_number");
    battle.players.red.hand[0] = "fireball";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 150 && prince.shield; i++) battle.step();
    expect(prince.shield).toBe(0);
    expect(prince.hp).toBe(prince.maxHp);
    expect(healthSelection(health, prince).name).toBe("hp_player_number");
    expect(battle.events.some((event) => event.effect === "shield:dark-prince")).toBe(true);
    battle.players.red.hand[0] = "fireball";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 150 && prince.hp === prince.maxHp; i++) battle.step();
    expect(prince.hp).toBeLessThan(prince.maxHp);
    expect(healthSelection(health, prince).name).toBe("hp_player_medium");
  });

  it("charges for special damage and splashes nearby ground enemies", () => {
    const { battle, prince } = makeBattle();
    Object.assign(prince, { move: 2.6, chargeDistance: 2.5, speed: 0 });
    const victims = [];
    for (const [x, y, card] of [[4, 19.9, "knight"], [4.8, 19.9, "knight"], [4.4, 19.8, "minions"]] as [number, number, "knight" | "minions"][]) {
      battle.players.red.hand[0] = card;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const victim = battle.entities.filter((e) => e.team === "red" && e.card === card).at(-1)!;
      Object.assign(victim, { x, y, deploy: 0, hp: 10000, maxHp: 10000, speed: 0, damage: 0 });
      victims.push(victim);
    }
    for (let i = 0; i < 90 && battle.events.filter((event) => event.type === "hit" && event.card === "dark-prince").length < 2; i++) battle.step();
    const hits = battle.events.filter((event) => event.type === "hit" && event.card === "dark-prince");
    expect(hits).toHaveLength(2);
    expect(hits.map((event) => event.value)).toEqual([467, 467]);
    expect(victims[0].hp).toBe(9533);
    expect(victims[1].hp).toBe(9533);
    expect(victims[2].hp).toBe(10000);
  });
});
