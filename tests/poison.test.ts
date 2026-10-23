import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import poison from "../src/game/poison-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { destructionPlan } from "../src/render/destruction";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["poison", ...STARTER_DECK.filter((card) => card !== "arrows")];

function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "poison";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Poison card", () => {
  it("pins its archived cost, area, buff and Crown Tower multiplier", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/poison-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(poison).toMatchObject({
      cost: 4,
      radius: 3.5,
      duration: 8,
      areaHitInterval: 0.25,
      buffDuration: 1,
      damagePerSecond: 57,
      damageInterval: 1,
      crownTowerDamageFraction: 0.4,
      affectsHidden: false,
    });
    expect(CARD_MAP.poison).toMatchObject({
      kind: "spell",
      rarity: "Epic",
      cost: 4,
      radius: 3.5,
    });
    const cards = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"));
    expect(cards.portraits.poison).toMatchObject({
      name: "poison", table: "spells_other", row: "Poison",
    });
    expect(audio.profiles.poison.impact.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ sound: "sound_poison_spell" })]),
    );
    expect(effects.impacts.poison.source).toBe("Spell_poison_effect");
    expect(effects.impacts["poison-loop"].source).toBe("Spell_poison_loop");
    expect(destructionPlan("poison", 12).length).toBeGreaterThan(0);
    expect(destructionPlan("poison-loop", 12).length).toBeGreaterThan(0);
    const clips = JSON.parse(readFileSync("public/assets/effects/effects.json", "utf8")).clips;
    expect(clips.Poison_radius.frames).toHaveLength(509);
    expect(clips.spell_poison_radius_blue.frames).toHaveLength(390);
    expect(clips.spell_poison_radius_red.frames).toHaveLength(390);
  });

  it("damages later entrants and lets the last application linger after exit", () => {
    const match = battle();
    match.players.red.hand[0] = "knight";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 9, 10).ok).toBe(true);
    const enemy = match.entities.find((entity) => entity.card === "knight" && entity.team === "red")!;
    enemy.deploy = 0;
    enemy.active = false;
    const hp = enemy.hp;
    expect(match.play("blue", 0, 9, 10).ok).toBe(true);
    expect(match.audioEvents.filter((event) => event.profile === "poison")
      .map((event) => event.phase)).toEqual(["cast", "impact"]);
    for (let i = 0; i < 20; i++) match.step();
    expect(enemy.hp).toBe(hp);
    enemy.x = 15;
    for (let i = 0; i < 10; i++) match.step();
    expect(enemy.hp).toBe(hp - CARD_MAP.poison.damage);
    for (let i = 0; i < 31; i++) match.step();
    expect(enemy.poison).toBeUndefined();
    for (let i = 0; i < 30; i++) match.step();
    expect(enemy.hp).toBe(hp - CARD_MAP.poison.damage);
    match.players.red.hand[0] = "giant";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 9, 10).ok).toBe(true);
    const late = match.entities.find((entity) => entity.card === "giant" && entity.team === "red")!;
    late.deploy = 0;
    late.active = false;
    for (let i = 0; i < 37; i++) match.step();
    expect(late.hp).toBeLessThan(late.maxHp);
  });

  it("reduces Crown Tower damage, skips hidden Tesla and preserves peer and replay state", () => {
    const match = battle();
    const tower = match.entities.find((entity) => entity.kind === "tower" && entity.team === "red" && entity.x === 4)!;
    match.players.red.hand[0] = "tesla";
    match.players.red.elixir = 10;
    expect(match.play("red", 0, 4, 9).ok).toBe(true);
    const tesla = match.entities.find((entity) => entity.card === "tesla" && entity.team === "red")!;
    tesla.deploy = 0;
    tesla.lifetime = undefined;
    expect(tesla.burrow?.phase).toBe("hidden");
    const hp = tower.hp;
    expect(match.play("blue", 0, 4, 6).ok).toBe(true);
    for (let i = 0; i < 30; i++) match.step();
    expect(tower.hp).toBeCloseTo(hp - CARD_MAP.poison.damage * 0.4);
    expect(tesla.hp).toBe(tesla.maxHp);
    expect(tesla.poison).toBeUndefined();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.areas?.[0]).toMatchObject({ card: "poison", team: "red", x: 14, y: 26 });
    const guestBattle = new Battle({ seed: 9, ai: false });
    applySnapshot(guestBattle, host, "red");
    expect(guestBattle.areas).toEqual(guest.areas);
    expect(guestBattle.entities.find((entity) => entity.kind === "tower" && entity.team === "blue" && entity.x === 14)?.hp).toBeCloseTo(tower.hp);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.areas[0]).toMatchObject({
      card: "poison",
      x: match.areas[0].x,
      y: match.areas[0].y,
      remaining: match.areas[0].remaining,
      hitAt: match.areas[0].hitAt,
    });
    expect(replay.entities.find((entity) => entity.kind === "tower" && entity.team === "red" && entity.x === 4)?.hp).toBeCloseTo(tower.hp);
    expect(match.time).toBeCloseTo(30 * STEP);
  });

  it("accepts Poison through the browser peer host and shares its area with both players", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes("poison"),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678", "classic", { name: "Blue", deck }, seed,
      (team, message) => messages.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    host.receive("blue", { type: "ready", ready: true });
    host.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) host.advance(STEP);
    expect(host.room.phase).toBe("playing");
    host.receive("blue", { type: "play", seq: 1, card: "poison", x: 4, y: 22 });
    expect(messages.findLast(({ team, message }) => team === "blue" && message.type === "ack")?.message)
      .toMatchObject({ ok: true });
    const states = messages.filter(({ message }) => message.type === "state");
    for (const team of ["blue", "red"] as const) {
      const latest = states.findLast((entry) => entry.team === team)!.message as Extract<ServerMessage, { type: "state" }>;
      expect(latest.state.areas?.[0]).toMatchObject({
        card: "poison", team: "blue", x: 4, y: 22,
      });
    }
    const guest = states.findLast(({ team }) => team === "red")!.message as Extract<ServerMessage, { type: "state" }>;
    expect(perspective(guest.state, "red").areas?.[0]).toMatchObject({
      card: "poison", team: "red", x: 14, y: 10,
    });
    host.availability("red", false);
    const remaining = host.battle!.areas[0].remaining;
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(host.battle!.areas[0].remaining).toBe(remaining);
  });
});
