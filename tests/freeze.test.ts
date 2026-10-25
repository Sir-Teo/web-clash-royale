import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARDS, STARTER_DECK } from "../src/game/cards";
import freeze from "../src/game/freeze-data.json";
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

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function freezeDeck() {
  return ["freeze", ...STARTER_DECK.filter((id) => id !== "arrows")];
}

describe("native Freeze card", () => {
  it("pins its source rules, portrait, sound and snow compositions", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/freeze-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(sha256(input.path)).toBe(input.sha256);
    expect(sha256(manifest.output.path)).toBe(manifest.output.sha256);
    expect(freeze).toMatchObject({
      card: "Freeze",
      cost: 4,
      rarity: "Epic",
      radius: 3,
      duration: 4,
      buffDuration: 4,
      affectsHidden: true,
    });
    expect(CARDS.find((card) => card.id === "freeze")).toMatchObject({
      cost: 4,
      kind: "spell",
      rarity: "Epic",
      radius: 3,
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.freeze).toMatchObject({
      name: "freeze",
      table: "spells_other",
      row: "Freeze",
    });
    expect(
      audio.profiles.freeze.cast.components.some(
        (component) => component.sound === "sound_freeze_deploy",
      ),
    ).toBe(true);
    expect(
      audio.sounds.sound_freeze_deploy.some((variant) =>
        variant.file.includes("freeze_04"),
      ),
    ).toBe(true);
    expect(impactEffect("freeze")).toBe("freeze");
    expect(effects.impacts.freeze.source).toBe("Spell_freeze_ground");
    expect(effects.impacts["freeze-loop"].source).toBe("Spell_freeze_loop");
    expect(destructionPlan("freeze", 12)).toHaveLength(40);
    expect(destructionPlan("freeze-loop", 12)).toHaveLength(70);
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    for (const name of [
      "freeze_effect_ground",
      "freeze_effect_ground_red",
      "spell_freeze_radius_blue",
      "spell_freeze_radius_red",
    ])
      expect(clips[name].frames).toHaveLength(390);
  });

  it("freezes enemies already inside and those entering later, then releases them", () => {
    const battle = new Battle({ seed: 7, ai: false, deck: freezeDeck() });
    for (const tower of battle.entities) tower.active = false;
    battle.players.red.hand[0] = "knight";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 9, 10).ok).toBe(true);
    const enemy = battle.entities.find(
      (entity) => entity.team === "red" && entity.card === "knight",
    )!;
    enemy.deploy = 0;
    battle.players.red.hand[0] = "tesla";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 9, 10).ok).toBe(true);
    const hidden = battle.entities.find(
      (entity) => entity.team === "red" && entity.card === "tesla",
    )!;
    hidden.deploy = 0;
    expect(hidden.burrow?.phase).toBe("hidden");
    battle.players.blue.hand[0] = "freeze";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 9, 10).ok).toBe(true);
    expect(battle.areas).toEqual([
      expect.objectContaining({
        team: "blue",
        card: "freeze",
        x: 9,
        y: 10,
        radius: 3,
        remaining: 4,
      }),
    ]);
    for (let i = 0; i < 60; i++) battle.step();
    expect(enemy.y).toBe(10);
    expect(enemy.stun).toBeGreaterThan(0);
    expect(hidden.burrow?.phase).toBe("hidden");
    expect(hidden.stun).toBeGreaterThan(0);
    // A unit entering halfway through the area must freeze too.
    battle.players.red.hand[0] = "goblins";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 11.5, 10).ok).toBe(true);
    const late = battle.entities.find(
      (entity) => entity.team === "red" && entity.card === "goblins",
    )!;
    late.deploy = 0;
    battle.step();
    expect(late.stun).toBeGreaterThan(0);
    while (battle.areas.length) battle.step();
    expect(battle.time).toBeCloseTo(4);
    battle.step();
    expect(enemy.stun).toBe(0);
    expect(late.stun).toBe(0);
  });

  it("rotates active areas for the guest and replays their lifetime", () => {
    const deck = freezeDeck();
    let battle: Battle | undefined;
    for (let seed = 1; seed < 100 && !battle; seed++) {
      const candidate = new Battle({ seed, ai: false, deck });
      if (candidate.players.blue.hand.includes("freeze")) battle = candidate;
    }
    expect(battle).toBeDefined();
    const slot = battle!.players.blue.hand.indexOf("freeze");
    battle!.players.blue.elixir = 10;
    expect(battle!.play("blue", slot, 4, 22).ok).toBe(true);
    for (let i = 0; i < 60; i++) battle!.step();
    const host = snapshot(battle!);
    expect(host.areas).toHaveLength(1);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({
      team: "red",
      x: 14,
      y: 10,
    });
    expect(guest.areas?.[0].remaining).toBeCloseTo(2);
    const guestBattle = new Battle({ seed: 99, ai: false });
    applySnapshot(guestBattle, host, "red");
    expect(guestBattle.areas).toEqual(guest.areas);
    const replay = new Battle({ replay: battle!.exportReplay() });
    while (replay.tick < battle!.tick) replay.step();
    expect(replay.areas).toEqual(battle!.areas);
    expect(replay.events.filter((event) => event.card === "freeze")).toEqual(
      battle!.events.filter((event) => event.card === "freeze"),
    );
    expect(battle!.time).toBeCloseTo(60 * STEP);
  });

  it("accepts Freeze through the direct peer host and sends its area to both players", () => {
    const deck = freezeDeck();
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "freeze",
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
    for (let i = 0; i < 120; i++) host.advance(STEP);
    expect(host.room.phase).toBe("playing");
    sendPeerCommand(host, "blue", {
      type: "play",
      seq: 1,
      card: "freeze",
      x: 4,
      y: 22,
    });
    expect(
      messages.findLast(
        ({ team, message }) => team === "blue" && message.type === "ack",
      )?.message,
    ).toMatchObject({ ok: true });
    const states = messages.filter(({ message }) => message.type === "state");
    for (const team of ["blue", "red"] as const) {
      const latest = states.findLast((entry) => entry.team === team)!
        .message as Extract<ServerMessage, { type: "state" }>;
      expect(latest.state.areas).toHaveLength(1);
      expect(latest.state.areas?.[0]).toMatchObject({
        card: "freeze",
        team: "blue",
        x: 4,
        y: 22,
      });
    }
    const guestState = states.findLast((entry) => entry.team === "red")!
      .message as Extract<ServerMessage, { type: "state" }>;
    expect(perspective(guestState.state, "red").areas?.[0]).toMatchObject({
      team: "red",
      x: 14,
      y: 10,
    });
    host.availability("red", false);
    const remaining = host.battle!.areas[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.areas[0].remaining).toBe(remaining);
  });
});
