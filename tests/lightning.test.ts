import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import lightning from "../src/game/lightning-data.json";
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
const deck = ["lightning", ...STARTER_DECK.filter((card) => card !== "arrows")];
function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "lightning";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Lightning spell", () => {
  it("pins its archived area, projectile, portrait, audio and nine-part strike", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/lightning-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(lightning).toMatchObject({
      cost: 6,
      radius: 3.5,
      duration: 1.5,
      strikeInterval: 0.46,
      targetPriority: "highestHp",
      sourceDamage: 650,
      stunDuration: 0.5,
      crownTowerDamageFraction: 0.4,
      hitsGround: true,
      hitsAir: true,
    });
    expect(CARD_MAP.lightning).toMatchObject({
      cost: 6,
      rarity: "Epic",
      kind: "spell",
      radius: 3.5,
      damage: Math.round((650 * 689) / 325),
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.lightning).toMatchObject({
      name: "lightning",
      table: "spells_other",
      row: "Lightning",
    });
    expect(audio.profiles.lightning.cast.sources).toContain(
      "sound:SpellCasting",
    );
    expect(audio.profiles.lightning.impact.sources).toContain(
      "Spell_lightning_effect",
    );
    expect(impactEffect("lightning")).toBe("lightning");
    expect(effects.impacts.lightning.source).toBe("Spell_lightning_effect");
    expect(effects.impacts.lightning.components).toHaveLength(9);
    expect(destructionPlan("lightning", 42)).toHaveLength(48);
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.lightning_bolt2.frames.length).toBeGreaterThan(0);
  });

  it("strikes the three strongest distinct enemies, including air, on separate pulses", () => {
    const match = battle();
    const tower = match.entities.find(
      (e) => e.kind === "tower" && e.team === "red" && e.lane === "left",
    )!;
    match.players.red.hand[0] = "tesla";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 9).ok).toBe(true);
    const tesla = match.entities.find(
      (e) => e.card === "tesla" && e.team === "red",
    )!;
    tesla.deploy = 0;
    tesla.lifetime = undefined;
    expect(tesla.burrow?.phase).toBe("hidden");
    match.players.red.hand[0] = "giant";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 8, 10).ok).toBe(true);
    const giant = match.entities.find(
      (e) => e.card === "giant" && e.team === "red",
    )!;
    giant.deploy = 0;
    giant.active = false;
    giant.x = 4;
    giant.y = 6;
    match.players.red.hand[0] = "minions";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 8, 10).ok).toBe(true);
    const minions = match.entities.filter(
      (e) => e.card === "minions" && e.team === "red",
    );
    for (const minion of minions) {
      minion.deploy = 0;
      minion.active = false;
      minion.x = 4;
      minion.y = 6;
    }
    const hp = tower.hp;
    expect(match.play("blue", 0, 4, 6).ok).toBe(true);
    expect(
      match.audioEvents
        .filter((event) => event.profile === "lightning")
        .map((event) => event.phase),
    ).toEqual(["cast"]);
    for (let i = 0; i < 14; i++) match.step();
    expect(giant.hp).toBe(giant.maxHp);
    match.step();
    expect(giant.hp).toBe(giant.maxHp - CARD_MAP.lightning.damage);
    expect(giant.stun).toBeGreaterThan(0);
    expect(tower.hp).toBe(hp);
    expect(match.areas[0].struck).toEqual([giant.id]);
    for (let i = 0; i < 14; i++) match.step();
    expect(tower.hp).toBeCloseTo(hp - CARD_MAP.lightning.damage * 0.4);
    expect(giant.hp).toBe(giant.maxHp - CARD_MAP.lightning.damage);
    for (let i = 0; i < 14; i++) match.step();
    expect(minions.some((e) => e.hp === 0)).toBe(true);
    expect(tesla.hp).toBe(tesla.maxHp);
    expect(
      match.events.filter(
        (event) => event.type === "hit" && event.card === "lightning",
      ),
    ).toHaveLength(3);
    expect(
      match.audioEvents
        .filter((event) => event.profile === "lightning")
        .map((event) => event.phase),
    ).toEqual(["cast", "impact", "impact", "impact"]);
    for (let i = 0; i < 4; i++) match.step();
    expect(match.areas).toHaveLength(0);
  });

  it("preserves target history and strike timing through guest snapshots and replays", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "lightning",
      ),
    )!;
    const match = new Battle({ seed, ai: false, deck });
    for (const tower of match.entities) tower.active = false;
    for (let i = 0; i < 100; i++) match.step();
    const slot = match.players.blue.hand.indexOf("lightning");
    expect(match.play("blue", slot, 4, 6).ok).toBe(true);
    for (let i = 0; i < 20; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({
      card: "lightning",
      team: "red",
      x: 14,
      y: 26,
      hitAt: lightning.strikeInterval * 2,
    });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.areas).toEqual(guest.areas);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.areas[0]).toMatchObject({
      card: "lightning",
      x: 4,
      y: 6,
      hitAt: lightning.strikeInterval * 2,
    });
  });

  it("accepts Lightning through direct peer commands and pauses its area", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "lightning",
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
    sendPeerCommand(host, "blue", {
      type: "play",
      seq: 1,
      card: "lightning",
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
      const state = states.findLast((entry) => entry.team === team)!
        .message as Extract<ServerMessage, { type: "state" }>;
      expect(state.state.areas?.[0]).toMatchObject({
        card: "lightning",
        team: "blue",
        x: 4,
        y: 22,
      });
    }
    host.availability("red", false);
    const remaining = host.battle!.areas[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.areas[0].remaining).toBe(remaining);
  });
});
