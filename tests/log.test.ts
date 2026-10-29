import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/log-data.json";
import effects from "../src/render/destruction-data.json";
import audio from "../src/game/combat-audio-data.json";
import { impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["log", ...STARTER_DECK.filter((card) => card !== "arrows")];
function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "log";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Log spell", () => {
  it("pins both projectile stages, portrait, sounds and authored effects", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/log-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 2,
      rarity: "Legendary",
      launchSpeed: 6,
      launchMinimumDistance: 3,
      rollingRange: 11.1,
      collisionRadius: 1.95,
      collisionHalfWidth: 0.6,
      sourceDamage: 240,
      crownTowerDamageFraction: 0.4,
      knockback: 1,
      hitsGround: true,
      hitsAir: false,
    });
    expect(CARD_MAP.log).toMatchObject({
      kind: "spell",
      rarity: "Legendary",
      cost: 2,
      damage: Math.round((240 * 689) / 325),
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.log).toMatchObject({ row: "Log" });
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.log_projectile.frames).toHaveLength(60);
    expect(clips.log_roll_projectile.frames).toHaveLength(408);
    expect(clips.log_roll_projectile_red.frames).toHaveLength(408);
    expect(projectileArt({ style: "log", team: "red" } as any)).toBe(
      "log_roll_projectile_red",
    );
    expect(audio.profiles.log.launch.sources).toContain("log_emitter");
    expect(audio.profiles.log["impact-special"].sources).toContain("log_die");
    expect(impactEffect("log")).toBe("log");
    expect(impactEffect("log-die")).toBe("log-die");
    expect(effects.trails.log.source).toBe("log_emitter");
  });

  it("launches then rolls once through ground enemies with knockback and reduced tower damage", () => {
    const match = battle();
    const tower = match.entities.find(
      (e) => e.team === "red" && e.kind === "tower" && e.lane === "left",
    )!;
    match.players.red.hand[0] = "knight";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 10).ok).toBe(true);
    const knight = match.entities.find(
      (e) => e.card === "knight" && e.team === "red",
    )!;
    knight.deploy = 0;
    knight.active = false;
    knight.y = 12;
    match.players.red.hand[0] = "minions";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 10).ok).toBe(true);
    const minion = match.entities.find(
      (e) => e.card === "minions" && e.team === "red",
    )!;
    minion.deploy = 0;
    minion.active = false;
    minion.x = 4;
    minion.y = 12;
    expect(match.canPlace("blue", "log", 4, 10).ok).toBe(false);
    const towerHp = tower.hp;
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    expect(match.projectiles[0].style).toBe("log-launch");
    expect(match.projectiles[0].duration).toBeCloseTo(0.5);
    for (let i = 0; i < 15; i++) match.step();
    expect(match.projectiles[0]).toMatchObject({
      style: "log",
      speed: rules.rollingSpeed,
      knockback: 1,
      towerDamageFraction: 0.4,
    });
    expect(knight.hp).toBe(knight.maxHp);
    for (let i = 0; i < 110; i++) match.step();
    expect(match.projectiles).toHaveLength(0);
    expect(knight.hp).toBe(knight.maxHp - CARD_MAP.log.damage);
    expect(knight.y).toBeLessThan(12);
    expect(minion.hp).toBe(minion.maxHp);
    expect(tower.hp).toBeCloseTo(towerHp - Math.ceil(CARD_MAP.log.damage * 40 / 100));
    expect(match.events.some((event) => event.effect === "log-die")).toBe(true);
  });

  it("keeps its rolling collision history in guest snapshots and replays", () => {
    const match = battle();
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    for (let i = 0; i < 30; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.projectiles?.[0]).toMatchObject({
      style: "log",
      team: "red",
      x: 14,
    });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.projectiles).toEqual(guest.projectiles);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.projectiles[0]).toMatchObject({
      style: "log",
      x: 4,
      rollHits: [],
    });
  });

  it("rolls toward the blue tower for red without hitting off-lane or hidden targets", () => {
    const match = battle();
    match.players.red.hand[0] = "log";
    match.players.red.elixir = 10;
    const blueTower = match.entities.find(
      (e) => e.team === "blue" && e.kind === "tower" && e.lane === "right",
    )!;
    match.players.blue.hand[0] = "knight";
    expect(match.play("blue", 0, 14, 22).ok).toBe(true);
    const knight = match.entities.find(
      (e) => e.team === "blue" && e.card === "knight",
    )!;
    knight.deploy = 0;
    knight.active = false;
    knight.x = 16;
    match.players.blue.hand[0] = "tesla";
    match.players.blue.elixir = 10;
    expect(match.play("blue", 0, 14, 21).ok).toBe(true);
    const tesla = match.entities.find(
      (e) => e.team === "blue" && e.card === "tesla",
    )!;
    tesla.deploy = 0;
    tesla.active = false;
    tesla.lifetime = undefined;
    expect(tesla.burrow?.phase).toBe("hidden");
    const hp = blueTower.hp;
    expect(match.play("red", 0, 14, 10).ok).toBe(true);
    for (let i = 0; i < 120; i++) match.step();
    expect(knight.hp).toBe(knight.maxHp);
    expect(tesla.hp).toBe(tesla.maxHp);
    expect(blueTower.hp).toBeCloseTo(hp - Math.ceil(CARD_MAP.log.damage * 40 / 100));
  });

  it("accepts a Log cast through direct browser peer commands", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "log",
      ),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) =>
        messages.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    sendPeerCommand(host, "blue", { type: "ready", ready: true });
    sendPeerCommand(host, "red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) host.advance(STEP);
    host.battle!.players.blue.elixir = 10;
    sendPeerCommand(host, "blue", { type: "play", seq: 1, card: "log", x: 4, y: 22 });
    expect(
      messages.findLast(
        ({ team, message }) => team === "blue" && message.type === "ack",
      )?.message,
    ).toMatchObject({ ok: true });
    expect(host.battle!.projectiles[0].style).toBe("log-launch");
    for (let i = 0; i < 15; i++) host.advance(STEP);
    expect(host.battle!.projectiles[0].style).toBe("log");
  });
});
