import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/graveyard-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
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
const deck = ["graveyard", ...STARTER_DECK.filter((id) => id !== "arrows")];
function battle() {
  const match = new Battle({ seed: 42, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "graveyard";
  match.players.blue.elixir = 10;
  return match;
}
const births = (match: Battle) =>
  match.events.filter(
    (event) => event.type === "deploy" && event.effect === "graveyard-appear",
  );

describe("native Graveyard spell", () => {
  it("pins source cadence, portrait, ground art, particles and sound", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/graveyard-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 5,
      rarity: "Legendary",
      radius: 5,
      duration: 10,
      spawnCharacter: "Skeleton",
      spawnInterval: 0.5,
      spawnInitialDelay: 1.5,
      spawnDeployTime: 0.4,
      spawnCharacterLevelIndex: 8,
    });
    expect(CARD_MAP.graveyard).toMatchObject({
      cost: 5,
      rarity: "Legendary",
      kind: "spell",
      radius: 5,
      damage: 0,
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.graveyard.row).toBe("Graveyard");
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.Graveyard_ground_area_blue.frames).toHaveLength(509);
    expect(clips.Graveyard_ground_area_red.frames).toHaveLength(509);
    expect(clips.spell_graveyard_radius_blue.frames).toHaveLength(390);
    expect(clips.spell_graveyard_radius_red.frames).toHaveLength(390);
    expect(impactEffect("graveyard")).toBe("graveyard");
    expect(impactEffect("graveyard-appear")).toBe("graveyard-appear");
    expect(effects.impacts.graveyard.components).toHaveLength(6);
    expect(effects.impacts["graveyard-appear"].components).toHaveLength(3);
    expect(destructionPlan("graveyard-appear", 4).length).toBeGreaterThan(30);
    expect(audio.profiles.graveyard.cast.sources).toContain(
      "Spell_graveyard_ground",
    );
    expect(audio.profiles.graveyard.summon.sources).toContain(
      "Graveyard_appear",
    );
  });

  it("releases 17 Skeletons from 1.5 through 9.5 seconds and then expires", () => {
    const match = battle();
    expect(match.play("blue", 0, 9, 16).ok).toBe(true);
    for (let i = 0; i < 45; i++) match.step();
    expect(births(match)).toHaveLength(0);
    match.step();
    expect(births(match)).toHaveLength(1);
    const first = match.entities.find((e) => e.card === "skeletons")!;
    expect(first.team).toBe("blue");
    expect(first.deploy).toBeCloseTo(0.4 - STEP);
    expect(Math.hypot(first.x - 9, first.y - 16)).toBeLessThanOrEqual(5);
    for (let i = 0; i < 255; i++) match.step();
    expect(births(match)).toHaveLength(17);
    expect(match.areas).toHaveLength(0);
    expect(
      match.audioEvents.filter(
        (event) => event.profile === "graveyard" && event.phase === "summon",
      ),
    ).toHaveLength(17);
  });

  it("keeps its spawn clock and positions in guest snapshots and replays", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "graveyard",
      ),
    )!;
    const match = new Battle({ seed, ai: false, deck });
    match.players.blue.elixir = 10;
    expect(
      match.play("blue", match.players.blue.hand.indexOf("graveyard"), 4, 9).ok,
    ).toBe(true);
    for (let i = 0; i < 63; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.areas[0]).toMatchObject({
      card: "graveyard",
      team: "red",
      x: 14,
      y: 23,
      hitAt: 2.5,
    });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.areas).toEqual(guest.areas);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.areas[0].hitAt).toBe(match.areas[0].hitAt);
    expect(
      replay.entities
        .filter((e) => e.card === "skeletons")
        .map((e) => [e.x, e.y]),
    ).toEqual(
      match.entities
        .filter((e) => e.card === "skeletons")
        .map((e) => [e.x, e.y]),
    );
  });

  it("accepts direct-peer commands and broadcasts timed births", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "graveyard",
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
    peer.receive("blue", { type: "ready", ready: true });
    peer.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    peer.receive("blue", {
      type: "play",
      seq: 1,
      card: "graveyard",
      x: 4,
      y: 10,
    });
    expect(
      messages.findLast(
        ({ team, message }) => team === "blue" && message.type === "ack",
      )?.message,
    ).toMatchObject({ ok: true });
    expect(peer.battle!.areas[0].card).toBe("graveyard");
    for (let i = 0; i < 60; i++) peer.advance(STEP);
    expect(births(peer.battle!)).toHaveLength(1);
    const guestState = messages.findLast(
      ({ team, message }) => team === "red" && message.type === "state",
    )?.message as Extract<ServerMessage, { type: "state" }>;
    expect(perspective(guestState.state, "red").areas[0]).toMatchObject({
      card: "graveyard",
      team: "red",
      x: 14,
      y: 22,
    });
  });
});
