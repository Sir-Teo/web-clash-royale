import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/tornado-data.json";
import effects from "../src/render/destruction-data.json";
import audio from "../src/game/combat-audio-data.json";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["tornado", ...STARTER_DECK.filter((card) => card !== "arrows")];
function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "tornado";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Tornado spell", () => {
  it("pins archived area, buff, portrait, whirl, particles and cast sound", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/tornado-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 3,
      rarity: "Epic",
      radius: 5.5,
      duration: 3.05,
      areaHitInterval: 0.05,
      buffDuration: 0.5,
      damagePerSecond: 44,
      damageInterval: 0.5,
      attractPercentage: 2.2,
      crownTowerDamageFraction: 0,
      hitsGround: true,
      hitsAir: true,
      affectsBuildings: false,
    });
    expect(CARD_MAP.tornado).toMatchObject({
      cost: 3,
      kind: "spell",
      rarity: "Epic",
      radius: 5.5,
      damage: Math.round((44 * 0.5 * 689) / 325),
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.tornado).toMatchObject({ row: "Tornado" });
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.whirl_animation_fx.frames).toHaveLength(27);
    expect(clips.whirl_animation_fx.bounds.every(Number.isFinite)).toBe(true);
    expect(clips.spell_tornado_radius_blue.frames).toHaveLength(390);
    expect(clips.spell_tornado_radius_red.frames).toHaveLength(390);
    expect(audio.profiles.tornado.cast.sources).toContain(
      "Spell_tornado_deploy",
    );
    expect(impactEffect("tornado")).toBe("tornado");
    expect(effects.impacts.tornado.components).toHaveLength(7);
    expect(destructionPlan("tornado", 4)).toHaveLength(257);
  });

  it("pulls enemy troops on ground and in air, damages on half-second beats, and ignores buildings", () => {
    const match = battle();
    const tower = match.entities.find(
      (e) => e.team === "red" && e.kind === "tower" && e.lane === "left",
    )!;
    match.players.red.hand[0] = "giant";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 10).ok).toBe(true);
    const giant = match.entities.find(
      (e) => e.team === "red" && e.card === "giant",
    )!;
    giant.deploy = 0;
    giant.active = false;
    giant.y = 12;
    match.players.red.hand[0] = "minions";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 10).ok).toBe(true);
    const minion = match.entities.find(
      (e) => e.team === "red" && e.card === "minions",
    )!;
    minion.deploy = 0;
    minion.active = false;
    minion.y = 12;
    match.players.red.hand[0] = "cannon";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 10).ok).toBe(true);
    const cannon = match.entities.find(
      (e) => e.team === "red" && e.card === "cannon",
    )!;
    cannon.deploy = 0;
    cannon.active = false;
    cannon.lifetime = undefined;
    cannon.y = 12;
    const towerHp = tower.hp;
    expect(match.play("blue", 0, 4, 14).ok).toBe(true);
    expect(match.areas[0]).toMatchObject({
      card: "tornado",
      radius: 5.5,
      duration: 3.05,
    });
    for (let i = 0; i < 15; i++) match.step();
    expect(giant.y).toBeGreaterThan(12);
    expect(minion.y).toBeGreaterThan(12);
    expect(giant.hp).toBe(giant.maxHp);
    match.step();
    expect(giant.hp).toBe(giant.maxHp - CARD_MAP.tornado.damage);
    expect(cannon.hp).toBe(cannon.maxHp);
    expect(tower.hp).toBe(towerHp);
    for (let i = 0; i < 85; i++) match.step();
    expect(match.areas).toHaveLength(0);
  });

  it("retains timing and center in guest snapshots, replays and direct peer commands", () => {
    const match = battle();
    expect(match.play("blue", 0, 4, 14).ok).toBe(true);
    for (let i = 0; i < 10; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({
      card: "tornado",
      team: "red",
      x: 14,
      y: 18,
    });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.areas).toEqual(guest.areas);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.areas[0]).toMatchObject({ card: "tornado", x: 4, y: 14 });

    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "tornado",
      ),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const peer = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) =>
        messages.push({ team, message: structuredClone(message) }),
    );
    expect(peer.join({ name: "Red", deck })).toBe(true);
    sendPeerCommand(peer, "blue", { type: "ready", ready: true });
    sendPeerCommand(peer, "red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    sendPeerCommand(peer, "blue", {
      type: "play",
      seq: 1,
      card: "tornado",
      x: 4,
      y: 14,
    });
    expect(
      messages.findLast(
        ({ team, message }) => team === "blue" && message.type === "ack",
      )?.message,
    ).toMatchObject({ ok: true });
    expect(peer.battle!.areas[0].card).toBe("tornado");
  });
});
