import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rage from "../src/game/rage-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import filter from "../src/render/rage-filter-data.json";
import { destructionPlan } from "../src/render/destruction";
import { rageFilterFrame } from "../src/render/rage-filter";
import { combatAudioPlan, NativeCombatAudio } from "../src/game/combat-audio";

const deck = ["rage", ...STARTER_DECK.filter((card) => card !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function match() {
  const battle = new Battle({ seed: 4, ai: false, deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.elixir = 10;
  battle.players.red.elixir = 10;
  return battle;
}

describe("native Rage rules", () => {
  it("pins the archived area and three speed multipliers", () => {
    const manifest = JSON.parse(readFileSync("reference/client/rage-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rage).toMatchObject({
      cost: 2, radius: 5, duration: 6, areaHitInterval: 0.3,
      buffDuration: 2, capBuffToAreaTime: true, targets: "friendlyTroops",
      hitSpeedMultiplier: 1.35, speedMultiplier: 1.35,
      spawnSpeedMultiplier: 1.35, audioPitchMultiplier: 1.25,
    });
    expect(CARD_MAP.rage).toMatchObject({ cost: 2, rarity: "Epic", kind: "spell", radius: 5 });
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits.rage).toMatchObject({
      name: "rage", table: "spells_other", row: "Rage",
    });
    expect(audio.profiles.rage.impact.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ sound: "sound_rage_effect" })]),
    );
    expect(effects.impacts.rage.source).toBe("Spell_rage_effect");
    expect(effects.impacts["rage-loop"].source).toBe("Spell_rage_loop");
    expect(destructionPlan("rage", 12).length).toBeGreaterThan(0);
    const clips = JSON.parse(readFileSync("public/assets/effects/effects.json", "utf8")).clips;
    for (const name of ["rage_effect_ground", "spell_rage_radius_blue", "spell_rage_radius_red"])
      expect(clips[name].frames).toHaveLength(390);
    const filterManifest = JSON.parse(readFileSync("reference/client/rage-filter-manifest.json", "utf8"));
    for (const input of filterManifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(filterManifest.output.path)).toBe(filterManifest.output.sha256);
    expect(filter.colors).toHaveLength(50);
    expect(rageFilterFrame(50 / 30)).toBe(0);
  });

  it("speeds only friendly troops, including later entrants, and expires with the area", () => {
    const battle = match();
    battle.players.blue.hand[0] = "knight";
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "blue")!;
    knight.deploy = 0;
    knight.cooldown = 1;
    battle.players.red.hand[0] = "knight";
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const enemy = battle.entities.find((e) => e.card === "knight" && e.team === "red")!;
    enemy.deploy = 0;
    enemy.x = 4;
    enemy.y = 10;
    battle.players.blue.hand[0] = "rage";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.audioEvents.filter((event) => event.profile === "rage")
      .map((event) => event.phase)).toEqual(["cast", "impact"]);
    const y = knight.y;
    battle.step();
    expect(knight.rage?.remaining).toBeCloseTo(rage.buffDuration - STEP);
    expect(knight.cooldown).toBeCloseTo(1 - STEP * rage.hitSpeedMultiplier);
    expect(knight.y).toBeLessThan(y);
    expect(enemy.rage).toBeUndefined();
    expect(battle.entities.some((e) => e.kind === "tower" && e.rage)).toBe(false);
    enemy.active = false;
    enemy.y = knight.y - 0.5;
    knight.cooldown = 0;
    battle.step();
    const attack = battle.audioEvents.findLast((event) =>
      event.phase === "attack" && event.actor === knight.id)!;
    expect(attack.pitchMultiplier).toBe(rage.audioPitchMultiplier);
    const baseCue = combatAudioPlan("knight", "attack", battle.seed ^ attack.id)[0];
    const played: number[] = [];
    const cues = new NativeCombatAudio({
      enabled: true,
      play: (_name, _volume, options) => {
        played.push(options?.pitch ?? 1);
        return () => {};
      },
    });
    cues.consume([attack], battle.seed, attack.time);
    cues.update(attack.time + baseCue.delay, false, new Set([knight.id]));
    expect(played[0]).toBeCloseTo(baseCue.pitch * rage.audioPitchMultiplier);
    knight.x = 12;
    for (let i = 0; i < 59; i++) battle.step();
    expect(knight.rage).toBeUndefined();
    battle.players.blue.hand[0] = "skeletons";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const entrant = battle.entities.find((e) => e.card === "skeletons" && e.team === "blue")!;
    entrant.deploy = 0;
    entrant.active = false;
    for (let i = 0; i < 10; i++) battle.step();
    expect(entrant.rage).toBeDefined();
    for (let i = 0; i < 180; i++) battle.step();
    expect(battle.areas).toHaveLength(0);
    expect(entrant.rage).toBeUndefined();
  });

  it("preserves its area and buff in guest snapshots and replays", () => {
    const battle = match();
    battle.players.blue.hand[0] = "knight";
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight" && e.team === "blue")!;
    knight.deploy = 0;
    battle.players.blue.hand[0] = "rage";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    battle.step();
    const host = snapshot(battle);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({ card: "rage", team: "red", x: 14, y: 10 });
    expect(guest.entities.find((e) => e.id === knight.id)?.rage).toBeDefined();
    const replica = match();
    applySnapshot(replica, host, "red");
    expect(replica.areas).toEqual(guest.areas);
    const replay = new Battle({ replay: battle.exportReplay() });
    while (replay.tick < battle.tick) replay.step();
    expect(replay.areas[0]).toMatchObject({ card: "rage", x: 4, y: 22 });
  });

  it("accepts Rage through the direct browser peer host for both players", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("rage"),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678", "classic", { name: "Blue", deck }, seed,
      (team, message) => messages.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    sendPeerCommand(host, "blue", { type: "ready", ready: true });
    sendPeerCommand(host, "red", { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) host.advance(STEP);
    expect(host.room.phase).toBe("playing");
    sendPeerCommand(host, "blue", { type: "play", seq: 1, card: "rage", x: 4, y: 22 });
    expect(messages.findLast(({ team, message }) => team === "blue" && message.type === "ack")?.message)
      .toMatchObject({ ok: true });
    const states = messages.filter(({ message }) => message.type === "state");
    for (const team of ["blue", "red"] as const) {
      const state = states.findLast((entry) => entry.team === team)!.message as Extract<ServerMessage, { type: "state" }>;
      expect(state.state.areas?.[0]).toMatchObject({ card: "rage", team: "blue", x: 4, y: 22 });
    }
    const guest = states.findLast(({ team }) => team === "red")!.message as Extract<ServerMessage, { type: "state" }>;
    expect(perspective(guest.state, "red").areas?.[0]).toMatchObject({
      card: "rage", team: "red", x: 14, y: 10,
    });
    host.availability("red", false);
    const remaining = host.battle!.areas[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.areas[0].remaining).toBe(remaining);
  });
});
