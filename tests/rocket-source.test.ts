import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rocket from "../src/game/rocket-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { destructionPlan, impactEffect } from "../src/render/destruction";
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
const deck = ["rocket", ...STARTER_DECK.filter((card) => card !== "arrows")];
function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "rocket";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Rocket spell", () => {
  it("pins its archived rules, artwork, sound and eight-part explosion", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/rocket-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rocket).toMatchObject({
      cost: 6,
      radius: 2,
      sourceDamage: 700,
      knockback: 1.8,
      crownTowerDamageFraction: 0.4,
      hitsAir: true,
    });
    expect(CARD_MAP.rocket).toMatchObject({
      kind: "spell",
      rarity: "Rare",
      cost: 6,
      radius: 2,
      damage: Math.round((700 * 689) / 325),
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.rocket).toMatchObject({
      name: "rocket",
      table: "spells_other",
      row: "Rocket",
    });
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.projectile_rocket.frames).toHaveLength(60);
    expect(clips.projectile_shadow_rocket.frames).toHaveLength(1);
    expect(projectileArt({ style: "rocket" } as any)).toBe("projectile_rocket");
    expect(audio.profiles.rocket.cast.sources).toContain(
      "sound:sound_rocket_spawn",
    );
    expect(audio.profiles.rocket.impact.sources).toContain("Rocket_explosion");
    expect(impactEffect("rocket")).toBe("rocket");
    expect(effects.impacts.rocket.source).toBe("Rocket_explosion");
    expect(effects.impacts.rocket.components).toHaveLength(8);
    expect(destructionPlan("rocket", 8).length).toBeGreaterThan(100);
  });

  it("flies at source speed, hits ground and air, knocks troops back, and uses 40% tower damage", () => {
    const match = battle();
    const tower = match.entities.find(
      (e) => e.kind === "tower" && e.team === "red" && e.x === 4,
    )!;
    match.players.red.hand[0] = "tesla";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 9).ok).toBe(true);
    const tesla = match.entities.find(
      (e) => e.card === "tesla" && e.team === "red",
    )!;
    tesla.deploy = 0;
    tesla.lifetime = undefined;
    match.players.red.hand[0] = "knight";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 8, 10).ok).toBe(true);
    const knight = match.entities.find(
      (e) => e.card === "knight" && e.team === "red",
    )!;
    knight.deploy = 0;
    knight.active = false;
    knight.x = 4;
    knight.y = 6;
    match.players.red.hand[0] = "minions";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 8, 10).ok).toBe(true);
    const minion = match.entities.find(
      (e) => e.card === "minions" && e.team === "red",
    )!;
    minion.deploy = 0;
    minion.active = false;
    minion.x = 4;
    minion.y = 6;
    const hp = tower.hp;
    expect(match.play("blue", 0, 4, 6).ok).toBe(true);
    const shot = match.projectiles[0];
    expect(shot.speed).toBeCloseTo(rocket.speed);
    expect(shot.knockback).toBe(1.8);
    expect(shot.towerDamageFraction).toBe(0.4);
    expect(shot.duration).toBeGreaterThan(3);
    for (let i = 0; i < 30; i++) match.step();
    expect(tower.hp).toBe(hp);
    while (match.projectiles.length) match.step();
    expect(tower.hp).toBeCloseTo(hp - CARD_MAP.rocket.damage * 0.4);
    expect(knight.hp).toBeLessThan(knight.maxHp);
    expect(minion.hp).toBeLessThan(minion.maxHp);
    expect(knight.y).not.toBe(6);
    expect(tesla.hp).toBe(tesla.maxHp);
    expect(
      match.events.some(
        (event) => event.type === "hit" && event.card === "rocket",
      ),
    ).toBe(true);
  });

  it("preserves in-flight art and damage rules through guest snapshots and replays", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "rocket",
      ),
    )!;
    const match = new Battle({ seed, ai: false, deck });
    for (const tower of match.entities) tower.active = false;
    for (let i = 0; i < 100; i++) match.step();
    const slot = match.players.blue.hand.indexOf("rocket");
    expect(match.play("blue", slot, 4, 6).ok).toBe(true);
    for (let i = 0; i < 15; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.projectiles[0]).toMatchObject({
      style: "rocket",
      team: "red",
      tx: 14,
      ty: 26,
      towerDamageFraction: 0.4,
    });
    const replica = new Battle({ seed: 8, ai: false });
    applySnapshot(replica, host, "red");
    expect(replica.projectiles).toEqual(guest.projectiles);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.projectiles[0]).toMatchObject({
      style: "rocket",
      towerDamageFraction: 0.4,
    });
  });

  it("accepts Rocket through the direct browser peer host", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "rocket",
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
    expect(host.room.phase).toBe("playing");
    host.battle!.players.blue.elixir = 10;
    sendPeerCommand(host, "blue", { type: "play", seq: 1, card: "rocket", x: 4, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message;
    if (ack?.type === "ack" && !ack.ok) throw new Error(JSON.stringify(ack));
    expect(ack).toMatchObject({ ok: true });
    const states = messages.filter(({ message }) => message.type === "state");
    for (const team of ["blue", "red"] as const) {
      const state = states.findLast((entry) => entry.team === team)!
        .message as Extract<ServerMessage, { type: "state" }>;
      expect(state.state.projectiles[0]).toMatchObject({
        style: "rocket",
        team: "blue",
        towerDamageFraction: 0.4,
      });
    }
    host.availability("red", false);
    const remaining = host.battle!.projectiles[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.projectiles[0].remaining).toBe(remaining);
  });
});
