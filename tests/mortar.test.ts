import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { projectileArt } from "../src/render/projectiles";
import {
  impactEffect,
  launchEffect,
  destructionPlan,
} from "../src/render/destruction";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/mortar-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["mortar", ...STARTER_DECK.filter((id) => id !== "arrows")];
function game() {
  const battle = new Battle({ seed: 17, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "mortar";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 21).ok).toBe(true);
  const mortar = battle.entities.find((e) => e.card === "mortar")!;
  Object.assign(mortar, { deploy: 0, cooldown: 0 });
  return { battle, mortar };
}
function enemy(battle: Battle, x: number, y: number) {
  battle.players.red.hand[0] = "knight";
  battle.players.red.elixir = 10;
  expect(battle.play("red", 0, 4, 10).ok).toBe(true);
  const knight = battle.entities
    .filter((e) => e.team === "red" && e.card === "knight")
    .at(-1)!;
  Object.assign(knight, {
    x,
    y,
    deploy: 0,
    speed: 0,
    damage: 0,
    range: 0,
    cooldown: 999,
    hp: 10000,
    maxHp: 10000,
  });
  return knight;
}

describe("archived Mortar siege building", () => {
  it("pins the original card, 20 building directions, portrait and shell", () => {
    const manifest = json("reference/client/mortar-manifest.json");
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Mortar",
      rarity: "Common",
      cost: 4,
      sourceHitpoints: 600,
      sourceDamage: 108,
      deployTime: 4,
      range: 11.5,
      minimumRange: 4.5,
      hitSpeed: 5,
      loadTime: 4,
      splash: 2,
      projectileSpeed: 5,
      gravity: 60,
      projectileArt: "catapult_projectile1",
    });
    expect(CARDS).toHaveLength(72);
    expect(CARD_MAP.mortar).toMatchObject({
      kind: "building",
      cost: 4,
      hp: 1515,
      damage: 291,
      range: 11.5,
      interval: 5,
      lifetime: 30,
      splash: 2,
    });
    expect(combatTraits({ card: "mortar" })).toMatchObject({
      source: "Mortar",
      windup: 1,
      sight: 11.5,
      projectile: {
        source: "MortarProjectile",
        speed: 5,
        homing: false,
        gravity: 60,
      },
    });
    const asset = json("public/assets/buildings/mortar.json");
    expect(Object.keys(asset.clips)).toHaveLength(20);
    expect(asset.clips["red-attack-5"].source).toBe(
      "building_mortar1_enemy_attack1_5",
    );
    expect(asset.clips["blue-idle-1"].frames).toHaveLength(3);
    expect(json("public/assets/ui/cards/cards.json").portraits.mortar.row).toBe(
      "Mortar",
    );
    expect(
      json("public/assets/effects/effects.json").clips.catapult_projectile1
        .frames,
    ).toHaveLength(5);
    expect(projectileArt({ style: "mortar", team: "blue" } as any)).toBe(
      "catapult_projectile1",
    );
    expect(launchEffect("mortar")).toBe("launch:mortar");
    expect(impactEffect("mortar")).toBe("hit:mortar");
    expect(destructionPlan("launch:mortar", 7).length).toBeGreaterThan(0);
    expect(destructionPlan("hit:mortar", 7).length).toBeGreaterThan(0);
  });

  it("ignores enemies in the blind spot and splashes only ground enemies", () => {
    const { battle, mortar } = game();
    const close = enemy(battle, 4, 19);
    const distant = enemy(battle, 4, 13);
    const adjacent = enemy(battle, 5, 13);
    const air = {
      ...distant,
      id: 99999,
      card: "minions" as const,
      x: 4.5,
      air: true,
      hp: 10000,
      maxHp: 10000,
    };
    const ally = {
      ...distant,
      id: 99998,
      team: "blue" as const,
      x: 4.6,
      hp: 10000,
      maxHp: 10000,
    };
    battle.entities.push(air, ally);
    let shot = battle.projectiles.find((p) => p.source === mortar.id);
    for (let i = 0; !shot && i < 100; i++) {
      battle.step();
      shot = battle.projectiles.find((p) => p.source === mortar.id);
    }
    expect(shot).toMatchObject({
      style: "mortar",
      damage: 291,
      splash: 2,
      air: false,
      homing: false,
      arc: 0.6,
    });
    expect(shot?.target).toBe(distant.id);
    expect(mortar.target).not.toBe(close.id);
    for (
      let i = 0;
      i < 120 && battle.projectiles.some((p) => p.id === shot?.id);
      i++
    )
      battle.step();
    expect(distant.hp).toBeLessThan(10000);
    expect(adjacent.hp).toBeLessThan(10000);
    expect(close.hp).toBe(10000);
    expect(air.hp).toBe(10000);
    expect(ally.hp).toBe(10000);
  });

  it("keeps Mortar commands and state in a portable replay and guest view", () => {
    const { battle } = game();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i <= battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.some((e) => e.card === "mortar")).toBe(true);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.some((e) => e.card === "mortar")).toBe(true);
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const peer = new PeerMatch(
      "1234567890abcdef12345678", "classic", { name: "Blue", deck }, 17,
      (team, message) => messages.push({ team, message: structuredClone(message) }),
    );
    expect(peer.join({ name: "Red", deck })).toBe(true);
    peer.receive("blue", { type: "ready", ready: true });
    peer.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 240; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    peer.receive("blue", { type: "play", seq: 1, card: "mortar", x: 4, y: 18.5 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(peer.battle!.entities.some((e) => e.card === "mortar" && e.team === "blue"))
      .toBe(true);
    expect(STEP).toBeGreaterThan(0);
  });
});
