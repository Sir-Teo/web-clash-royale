import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import { destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import rules from "../src/game/lumberjack-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("archived Lumberjack", () => {
  it("pins the death bottle, separate Rage area and native animation sources", () => {
    const manifest = json("reference/client/lumberjack-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ cost: 4, rarity: "Legendary",
      sourceHitpoints: 950, sourceDamage: 200,
      sourceHitSpeed: 0.7,
      deathBottle: { export: "rage_bottle_fall", duration: 7.5,
        radius: 5, hitInterval: 0.3, buffTime: 2,
        hitsGround: true, hitsAir: true, ownTroopsOnly: true,
        speedMultiplier: 1.35, hitSpeedMultiplier: 1.35 } });
    expect(CARD_MAP.lumberjack).toMatchObject({ hp: 1150, damage: 242,
      cost: 4, range: 0.7, interval: 0.7 });
    const model = json("public/assets/animations/manifest.json").files.find((file: {id:string}) => file.id === "lumberjack");
    expect(model.clips).toBe(58);
    expect(model.metadataSha256).toBe(hash("reference/sc/chr_rage_barbarian.bin"));
    expect(json("public/assets/effects/effects.json").clips.rage_bottle_fall.frames).toHaveLength(30);
    expect(json("public/assets/ui/cards/cards.json").portraits.lumberjack.row).toBe("RageBarbarian");
    expect(destructionPlan("bottle:lumberjack", 9).length).toBeGreaterThan(0);
    expect(combatAudioPlan("lumberjack", "death-impact", 9).length).toBeGreaterThan(0);
  });

  it("drops one bottle, then Rages friendly ground and flying troops only", () => {
    const battle = new Battle({ seed: 53, ai: false,
      deck: ["lumberjack", ...STARTER_DECK.filter((id) => id !== "arrows")],
    });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "lumberjack";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const lumberjack = battle.entities.find((e) => e.card === "lumberjack")!;
    Object.assign(lumberjack, { x: 4, y: 21, hp: 1, deploy: 0, speed: 0, active: false });
    battle.players.red.hand[0] = "fireball";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 21).ok).toBe(true);
    for (let i = 0; i < 100 && lumberjack.hp > 0; i++) battle.step();
    expect(lumberjack.hp).toBe(0);
    const bottle = battle.projectiles.find((p) => p.style === "rage-bottle")!;
    expect(bottle).toBeTruthy();
    expect(projectileArt(bottle)).toBe("rage_bottle_fall");
    expect(battle.audioEvents.some((e) => e.profile === "lumberjack" && e.phase === "death-spawn")).toBe(true);
    for (let i = 0; i < 20 && !battle.areas.some((a) => a.card === "rage"); i++) battle.step();
    const area = battle.areas.find((a) => a.card === "rage")!;
    expect(area).toMatchObject({ team: "blue", x: 4, y: 21,
      radius: 5, duration: 7.5 });
    expect(battle.events.some((e) => e.effect === "bottle:lumberjack")).toBe(true);
    battle.step();
    expect(battle.areas.filter((a) => a.card === "rage")).toHaveLength(1);
    expect(battle.events.filter((e) => e.effect === "bottle:lumberjack")).toHaveLength(1);
    expect(battle.audioEvents.some((e) => e.profile === "lumberjack" && e.phase === "death-impact")).toBe(true);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.areas?.find((a) => a.id === area.id)).toMatchObject({
      team: "red", x: 14, y: 11, radius: 5,
    });
    const spawn = (team: "blue" | "red", card: "knight" | "minions", x: number) => {
      battle.players[team].hand[0] = card;
      battle.players[team].elixir = 10;
      expect(battle.play(team, 0, team === "blue" ? 4 : 5, team === "blue" ? 22 : 10).ok).toBe(true);
      const entity = battle.entities.filter((e) => e.team === team && e.card === card).at(-1)!;
      Object.assign(entity, { x, y: 21.8, deploy: 0, speed: 0,
        damage: 0, active: false, hp: 10000, maxHp: 10000 });
      return entity;
    };
    const friend = spawn("blue", "knight", 4);
    const flying = spawn("blue", "minions", 4.5);
    const enemy = spawn("red", "knight", 5);
    for (let i = 0; i < 12; i++) battle.step();
    expect(friend.rage?.remaining).toBeGreaterThan(0);
    expect(flying.rage?.remaining).toBeGreaterThan(0);
    expect(enemy.rage).toBeUndefined();
    expect(battle.areas.find((a) => a.id === area.id)?.remaining).toBeGreaterThan(7);
  });
});
