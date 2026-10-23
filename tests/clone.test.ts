import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/clone-data.json";
import colors from "../src/render/clone-filter-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { cloneFilterPose } from "../src/render/clone-filter";
import { impactEffect } from "../src/render/destruction";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["clone", ...STARTER_DECK.filter((id) => id !== "arrows")];
function battle() {
  const match = new Battle({ seed: 12, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "clone";
  match.players.blue.elixir = 10;
  return match;
}
function troop(
  match: Battle,
  card: "knight" | "minions" | "cannon",
  team: "blue" | "red",
  x: number,
  y: number,
) {
  match.players[team].hand[0] = card;
  match.players[team].elixir = 10;
  expect(match.play(team, 0, x, team === "blue" ? 22 : 10).ok).toBe(true);
  const created = match.entities.filter(
    (e) => e.card === card && e.team === team,
  );
  for (const entity of created) {
    entity.x = x;
    entity.y = y;
    entity.deploy = 0;
    entity.active = false;
  }
  return created;
}

describe("native Clone spell", () => {
  it("pins archived area, buff, portrait, hologram frames and sound", () => {
    for (const path of [
      "reference/client/clone-manifest.json",
      "reference/client/clone-filter-manifest.json",
    ]) {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      for (const input of manifest.inputs)
        expect(hash(input.path)).toBe(input.sha256);
      expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    }
    expect(rules).toMatchObject({
      cost: 3,
      rarity: "Epic",
      radius: 3,
      duration: 1,
      buffDuration: 0.8,
      target: "own-troops",
      hitsGround: true,
      hitsAir: true,
      ignoresBuildings: true,
    });
    expect(CARD_MAP.clone).toMatchObject({
      kind: "spell",
      cost: 3,
      radius: 3,
      damage: 0,
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.clone.row).toBe("Clone");
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.clone_effect_ground.frames).toHaveLength(181);
    expect(clips.spell_clone_radius_blue.frames).toHaveLength(120);
    expect(clips.spell_clone_radius_red.frames).toHaveLength(120);
    expect(colors.deploy).toHaveLength(41);
    expect(colors.character).toHaveLength(60);
    expect(cloneFilterPose(0)).toMatchObject({ phase: "deploy", frame: 0 });
    expect(cloneFilterPose(1)).toMatchObject({ phase: "character" });
    expect(impactEffect("clone")).toBe("clone");
    expect(effects.impacts.clone.components).toHaveLength(1);
    expect(audio.profiles.clone.cast.sources).toContain("spell_clone_ground");
  });

  it("duplicates friendly ground and air troops once, with one hitpoint, ignoring enemies and buildings", () => {
    const match = battle();
    const knight = troop(match, "knight", "blue", 4, 22)[0];
    const minions = troop(match, "minions", "blue", 6, 22);
    troop(match, "cannon", "blue", 5, 22);
    troop(match, "knight", "red", 5, 22);
    match.players.blue.hand[0] = "clone";
    match.players.blue.elixir = 10;
    expect(match.play("blue", 0, 5, 22).ok).toBe(true);
    match.step();
    const copies = match.entities.filter((e) => e.clone);
    expect(copies).toHaveLength(1 + minions.length);
    expect(
      copies.every((e) => e.team === "blue" && e.hp === 1 && e.maxHp === 1),
    ).toBe(true);
    expect(copies.find((e) => e.card === "knight")?.damage).toBe(knight.damage);
    expect(copies.some((e) => e.card === "cannon")).toBe(false);
    for (let i = 0; i < 20; i++) match.step();
    expect(match.entities.filter((e) => e.clone)).toHaveLength(copies.length);
    expect(match.areas[0].struck).toHaveLength(copies.length);
  });

  it("copies a late entrant only once and preserves clone flags for guest snapshots", () => {
    const match = battle();
    troop(match, "knight", "blue", 4, 22);
    match.players.blue.hand[0] = "clone";
    match.players.blue.elixir = 10;
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    match.step();
    expect(match.entities.filter((e) => e.clone)).toHaveLength(1);
    troop(match, "minions", "blue", 5, 22);
    match.step();
    expect(match.entities.filter((e) => e.clone)).toHaveLength(4);
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.entities.filter((e) => e.clone)).toHaveLength(4);
    expect(guest.areas[0]).toMatchObject({ card: "clone", team: "red" });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.entities.filter((e) => e.clone)).toEqual(
      guest.entities.filter((e) => e.clone),
    );
    for (let i = 0; i < 32; i++) match.step();
    expect(match.areas).toHaveLength(0);
  });

  it("accepts the Clone command in a direct peer match", () => {
    const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((value) => {
      const hand = new Battle({ seed: value, ai: false, deck }).players.blue
        .hand;
      return hand.includes("clone") && hand.includes("goblins");
    })!;
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
    peer.receive("blue", {
      type: "play",
      seq: 1,
      card: "goblins",
      x: 4,
      y: 22,
    });
    peer.receive("blue", {
      type: "play",
      seq: 2,
      card: "clone",
      x: 4,
      y: 22,
    });
    for (let i = 0; i < 2; i++) peer.advance(STEP);
    const acks = messages.filter(
      ({ team, message }) => team === "blue" && message.type === "ack",
    );
    expect(acks.slice(-2).map(({ message }) => (message as any).ok)).toEqual([
      true,
      true,
    ]);
    expect(peer.battle!.entities.filter((e) => e.clone)).toHaveLength(4);
    const latest = messages.findLast(
      ({ team, message }) => team === "red" && message.type === "state",
    )?.message as Extract<ServerMessage, { type: "state" }>;
    expect(
      perspective(latest.state, "red").entities.filter((e) => e.clone),
    ).toHaveLength(4);
  });
});
