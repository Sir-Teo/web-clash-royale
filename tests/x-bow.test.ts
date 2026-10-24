import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { projectileArt } from "../src/render/projectiles";
import { impactEffect, launchEffect } from "../src/render/destruction";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/x-bow-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["x-bow", ...STARTER_DECK.filter((id) => id !== "arrows")];

describe("archived X-Bow siege building", () => {
  it("pins its 19-frame team art, Epic rules, portrait, arrow and sounds", () => {
    const manifest = json("reference/client/x-bow-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Xbow", rarity: "Epic", cost: 6, sourceHitpoints: 1000,
      sourceDamage: 20, deployTime: 4, hitSpeed: 0.3, range: 11.5,
      lifetime: 40, hitsAir: false, projectileSpeed: 1400 / 60,
      projectileStartRadius: 1, projectileStartHeight: 2.4,
      projectileArt: "projectile_arrow_basic", projectileShadow: "projectile_arrow_shadow",
      launchEffect: "XbowAttack", hitEffect: "ArrowHit",
    });
    expect(CARDS).toHaveLength(74);
    expect(CARD_MAP["x-bow"]).toMatchObject({
      kind: "building", rarity: "Epic", cost: 6, hp: 1611,
      damage: 32, range: 11.5, interval: 0.3, lifetime: 40,
    });
    expect(combatTraits({ card: "x-bow" })).toMatchObject({
      source: "Xbow", windup: 0.3, sight: 11.5,
      projectile: { source: "xbow_projectile", homing: true, gravity: 0 },
    });
    const asset = json("public/assets/buildings/x-bow.json");
    expect(Object.keys(asset.clips)).toEqual(["blue", "red"]);
    expect(asset.clips.blue.frames).toHaveLength(19);
    expect(asset.clips.red.frames).toHaveLength(19);
    expect(asset.clips.blue.source).toBe("building_xbow_attack1_1");
    expect(asset.clips.red.source).toBe("building_xbow_red_attack1");
    expect(json("public/assets/ui/cards/cards.json").portraits["x-bow"].row)
      .toBe("Xbow");
    expect(projectileArt({ style: "x-bow", team: "blue" } as any))
      .toBe("projectile_arrow_basic");
    expect(projectileArt({ style: "x-bow", team: "red" } as any))
      .toBe("projectile_arrow_basic_enemy");
    expect(launchEffect("x-bow")).toBe("launch:x-bow");
    expect(impactEffect("x-bow")).toBe("hit:x-bow");
    const audio = json("src/game/combat-audio-data.json").profiles["x-bow"];
    expect(audio.launch.components[0].sound).toBe("sound_xbow_fire_1");
    expect(audio.spawn.components[0].sound).toBe("sound_xbow_deploy");
  });

  it("waits four seconds, ignores air, and shoots a distant Crown Tower from its muzzle", () => {
    const battle = new Battle({ seed: 31, ai: false, deck, enemyDeck: deck });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "x-bow";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 18.5).ok).toBe(true);
    const xBow = battle.entities.find((e) => e.card === "x-bow")!;
    const redPrincess = battle.entities.find((e) => e.team === "red" && e.lane === "left")!;
    battle.players.red.hand[0] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const minions = battle.entities.filter((e) => e.team === "red" && e.card === "minions");
    for (const minion of minions)
      Object.assign(minion, { x: 4, y: 17.8, deploy: 0, active: false, hp: 10000, maxHp: 10000 });
    for (let i = 0; i < Math.floor(3.5 / STEP); i++) battle.step();
    expect(battle.projectiles.some((p) => p.source === xBow.id)).toBe(false);
    let shot = battle.projectiles.find((p) => p.source === xBow.id);
    for (let i = 0; !shot && i < 100; i++) {
      battle.step();
      shot = battle.projectiles.find((p) => p.source === xBow.id);
    }
    expect(shot).toMatchObject({
      style: "x-bow", target: redPrincess.id, damage: 32,
      air: false, homing: true, fromHeight: 2.4,
    });
    expect(shot!.y).toBeCloseTo(17.5);
    expect(shot!.speed).toBeCloseTo(1400 / 60);
    for (let i = 0; i < 45; i++) battle.step();
    expect(redPrincess.hp).toBeLessThan(redPrincess.maxHp);
    expect(minions.every((e) => e.hp === 10000)).toBe(true);
    expect(perspective(snapshot(battle), "red").entities.some((e) => e.card === "x-bow"))
      .toBe(true);
  });

  it("replays its four-second setup and tower damage deterministically", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("x-bow") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("x-bow");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 6 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 4, 18.5).ok).toBe(true);
    for (let i = 0; i < 240; i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.find((e) => e.card === "x-bow")?.deploy)
      .toBe(battle.entities.find((e) => e.card === "x-bow")?.deploy);
    expect(replay.entities.find((e) => e.team === "red" && e.lane === "left")?.hp)
      .toBe(battle.entities.find((e) => e.team === "red" && e.lane === "left")?.hp);
  });

  it("accepts an X-Bow command through the two-player host and sends its state to the guest", () => {
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const peer = new PeerMatch(
      "1234567890abcdef12345678", "classic", { name: "Blue", deck }, 31,
      (team, message) => messages.push({ team, message: structuredClone(message) }),
    );
    expect(peer.join({ name: "Red", deck })).toBe(true);
    peer.receive("blue", { type: "ready", ready: true });
    peer.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 240; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    peer.battle!.players.blue.hand[0] = "x-bow";
    peer.receive("blue", { type: "play", seq: 1, card: "x-bow", x: 4, y: 18.5 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(perspective(snapshot(peer.battle!), "red").entities.some(
      (entity) => entity.card === "x-bow",
    )).toBe(true);
  });
});
