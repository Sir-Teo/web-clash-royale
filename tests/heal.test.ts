import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import { destructionPlan } from "../src/render/destruction";
import rules from "../src/game/heal-data.json" with { type: "json" };
import audio from "../src/game/combat-audio-data.json" with { type: "json" };
import effects from "../src/render/destruction-data.json" with { type: "json" };

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["heal", ...STARTER_DECK.filter((card) => card !== "arrows")];

function battle() {
  const match = new Battle({ seed: 9, ai: false, deck, enemyDeck: deck });
  for (const tower of match.entities) tower.active = false;
  for (const team of ["blue", "red"] as const) {
    match.players[team].elixir = 10;
    match.players[team].hand[0] = "heal";
  }
  return match;
}

describe("archived Heal card", () => {
  it("pins the source spell, buff, original portrait, sound and both ring colors", () => {
    const manifest = JSON.parse(readFileSync("reference/client/heal-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 3, rarity: "Rare", radius: 3, duration: 3.05,
      areaHitInterval: 0.05, buffDuration: 0.5,
      healInterval: 0.5, sourceHealPerSecond: 100,
      target: "own-troops", ignoresBuildings: true,
      visual: "Healing",
    });
    expect(CARD_MAP.heal).toMatchObject({ kind: "spell", rarity: "Rare", cost: 3, radius: 3 });
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits.heal).toMatchObject({ table: "spells_other", row: "Heal", name: "heal" });
    expect(audio.profiles.heal.cast.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ sound: "sound_heal_spell" })]),
    );
    expect(effects.impacts.heal.source).toBe("Healing");
    expect(effects.impacts.heal.components.map((c) => c.emitter)).toContain("heal_ground_ring");
    expect(effects.impacts.heal.enemyComponents.map((c) => c.emitter)).toContain("heal_ground_ring_enemy");
    expect(destructionPlan("heal", 12).some((p) => p.ground && p.clip === "spell_heal_radius_blue")).toBe(true);
    expect(destructionPlan("heal", 12, "red").some((p) => p.ground && p.clip === "spell_heal_radius_red")).toBe(true);
  });

  it("heals friendly ground and air troops at source cadence, never enemy troops or structures", () => {
    const match = battle();
    const blueTower = match.entities.find((e) => e.kind === "tower" && e.team === "blue" && e.x === 4)!;
    blueTower.hp -= 500;
    for (const [team, card, x, y] of [
      ["blue", "knight", 4, 22],
      ["blue", "baby-dragon", 5, 22],
      ["red", "knight", 4, 22],
      ["blue", "cannon", 4, 22],
    ] as const) {
      match.players[team].hand[0] = card;
      expect(match.play(team, 0, x, team === "blue" ? y : 10).ok).toBe(true);
    }
    const entities = match.entities.filter((e) => ["knight", "baby-dragon", "cannon"].includes(e.card));
    for (const entity of entities) {
      entity.deploy = 0;
      entity.active = false;
      entity.y = 22;
      entity.hp -= 400;
    }
    match.players.blue.hand[0] = "heal";
    match.players.blue.elixir = 10;
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    for (let i = 0; i < 14; i++) match.step();
    expect(entities.every((e) => !e.heal || e.heal.elapsed < 0.5)).toBe(true);
    const before = entities.map((e) => e.hp);
    match.step();
    const gain = Math.round(rules.sourceHealPerSecond * 1152 / 450 * rules.healInterval);
    expect(entities.slice(0, 3).map((e) => e.hp)).toEqual([before[0] + gain, before[1] + gain, before[2]]);
    expect(entities[3].hp).toBeLessThan(before[3]);
    expect(blueTower.hp).toBe(blueTower.maxHp - 500);
    expect(entities[2].heal).toBeUndefined();
    expect(entities[3].heal).toBeUndefined();
    expect(match.audioEvents.some((e) => e.profile === "heal" && e.phase === "cast")).toBe(true);
  });

  it("caps health, refreshes later entrants, lingers briefly after exit, and replays identically", () => {
    const match = battle();
    match.players.blue.hand[0] = "knight";
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    const troop = match.entities.find((e) => e.card === "knight")!;
    troop.deploy = 0;
    troop.active = false;
    troop.hp = troop.maxHp - 40;
    match.players.blue.hand[0] = "heal";
    expect(match.play("blue", 0, 4, 22).ok).toBe(true);
    for (let i = 0; i < 25; i++) match.step();
    expect(troop.hp).toBe(troop.maxHp);
    troop.hp -= 300;
    troop.x = 12;
    for (let i = 0; i < 5; i++) match.step();
    expect(troop.hp).toBeGreaterThan(troop.maxHp - 300);
    for (let i = 0; i < 15; i++) match.step();
    expect(troop.heal).toBeUndefined();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({ card: "heal", team: "red", x: 14, y: 10 });
    const guestBattle = new Battle({ seed: 1, ai: false });
    applySnapshot(guestBattle, host, "red");
    expect(guestBattle.areas).toEqual(guest.areas);
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("heal"),
    )!;
    const recorded = new Battle({ seed, ai: false, deck });
    expect(recorded.play("blue", recorded.players.blue.hand.indexOf("heal"), 4, 22).ok).toBe(true);
    for (let i = 0; i < 30; i++) recorded.step();
    const replay = new Battle({ replay: recorded.exportReplay() });
    while (replay.tick < recorded.tick) replay.step();
    expect(replay.areas).toEqual(recorded.areas);
  });

  it("accepts the card through a browser peer host and shares its mirrored area", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("heal"),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const host = new PeerMatch("1234567890abcdef12345678", "classic", { name: "Blue", deck }, seed,
      (team, message) => messages.push({ team, message: structuredClone(message) }));
    expect(host.join({ name: "Red", deck })).toBe(true);
    sendPeerCommand(host, "blue", { type: "ready", ready: true });
    sendPeerCommand(host, "red", { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) host.advance(STEP);
    sendPeerCommand(host, "blue", { type: "play", seq: 1, card: "heal", x: 4, y: 22 });
    expect(messages.findLast(({ team, message }) => team === "blue" && message.type === "ack")?.message)
      .toMatchObject({ ok: true });
    for (const team of ["blue", "red"] as const) {
      const state = messages.findLast(({ team: receiver, message }) => receiver === team && message.type === "state")!.message as Extract<ServerMessage, { type: "state" }>;
      expect(state.state.areas?.[0]).toMatchObject({ card: "heal", team: "blue", x: 4, y: 22 });
    }
    host.availability("red", false);
    const remaining = host.battle!.areas[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.areas[0].remaining).toBe(remaining);
  });
});
