import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Team } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK, type CardId } from "../src/game/cards";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import rage from "../src/game/rage-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck: CardId[] = [
  "rage",
  "witch",
  "freeze",
  "tesla",
  "knight",
  "minions",
  "cannon",
  "giant",
];
const advance = (b: Battle, n: number) => {
  for (let i = 0; i < n; i++) b.step();
};
function battle() {
  const b = new Battle({ seed: 4, ai: false, deck, enemyDeck: deck });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(b: Battle, id: CardId, team: Team, x: number, y: number) {
  b.players[team].hand[0] = id;
  b.players[team].elixir = 10;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
function unit(b: Battle, id: CardId, team: Team, x: number, y: number) {
  const old = new Set(b.entities.map((e) => e.id));
  cast(
    b,
    id,
    team,
    CARD_MAP[id].kind === "building" ? 14 : x,
    team === "blue" ? 22 : 10,
  );
  const e = b.entities.find((e) => !old.has(e.id))!;
  e.x = x;
  e.y = y;
  e.deploy = 0;
  return e;
}

describe("archived Rage", () => {
  it("pins rules, portraits, sound and native particle bindings", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/rage-manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rage).toMatchObject({
      cost: 2,
      radius: 5,
      duration: 6,
      buffDuration: 2,
      capBuffTimeToAreaEffectTime: true,
      areaHitInterval: 0.3,
      hitSpeedMultiplier: 1.35,
      speedMultiplier: 1.35,
      spawnSpeedMultiplier: 1.35,
      audioPitchMultiplier: 1.25,
    });
    expect(CARD_MAP.rage).toMatchObject({
      kind: "spell",
      rarity: "Epic",
      damage: 0,
      cost: 2,
    });
    const portraits = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits;
    expect(portraits.rage).toMatchObject({
      table: "spells_other",
      row: "Rage",
    });
    expect(audio.profiles.rage.impact.components[0].sound).toBe(
      "sound_rage_effect",
    );
    expect(effects.impacts.rage.source).toBe("Spell_rage_effect");
    expect(effects.impacts["rage-loop"].source).toBe("Spell_rage_loop");
  });

  it("boosts only living friends, including air, buildings and crowns, and skips hidden Tesla", () => {
    const b = battle();
    const friend = unit(b, "knight", "blue", 4, 23);
    const air = unit(b, "minions", "blue", 4, 22);
    const cannon = unit(b, "cannon", "blue", 5, 23);
    const hidden = unit(b, "tesla", "blue", 6, 23);
    const foe = unit(b, "giant", "red", 4, 23);
    const outside = unit(b, "witch", "blue", 15, 23);
    for (const e of b.entities) e.active = false;
    const hp = friend.hp;
    cast(b, "rage", "blue", 4, 24);
    b.step();
    for (const e of [
      friend,
      air,
      cannon,
      b.entities.find(
        (e) => e.kind === "tower" && e.team === "blue" && !e.king && e.x === 4,
      )!,
    ])
      expect(e.rage?.remaining).toBeCloseTo(2 - STEP);
    expect(hidden.rage).toBeUndefined();
    expect(foe.rage).toBeUndefined();
    expect(outside.rage).toBeUndefined();
    expect(friend.hp).toBe(hp);
    expect(
      b.audioEvents.filter((e) => e.profile === "rage").map((e) => e.phase),
    ).toEqual(["cast", "impact"]);
  });

  it("refreshes late entrants, lingers for two seconds on exit and caps every buff to area expiry", () => {
    const b = battle();
    const e = unit(b, "knight", "blue", 15, 22);
    e.active = false;
    cast(b, "rage", "blue", 4, 22);
    advance(b, 30);
    expect(e.rage).toBeUndefined();
    e.x = 4;
    advance(b, 10);
    expect(e.rage).toBeDefined();
    e.x = 15;
    advance(b, 60);
    expect(e.rage).toBeUndefined();
    e.x = 4;
    advance(b, 71);
    expect(e.rage?.remaining).toBeLessThan(0.5);
    advance(b, 9);
    expect(b.tick).toBe(180);
    expect(b.areas).toEqual([]);
    expect(e.rage).toBeUndefined();
  });

  it("does not stack or shorten a longer overlapping application", () => {
    const b = battle();
    const e = unit(b, "knight", "blue", 4, 22);
    e.active = false;
    cast(b, "rage", "blue", 4, 22);
    advance(b, 150);
    cast(b, "rage", "blue", 4, 22);
    b.step();
    expect(e.rage?.remaining).toBeCloseTo(2 - STEP);
    advance(b, 30);
    expect(b.areas).toHaveLength(1);
    expect(e.rage?.remaining).toBeGreaterThan(1.8);
    e.active = true;
    e.cooldown = 1;
    e.speed = 0;
    const before = e.cooldown;
    b.step();
    expect(before - e.cooldown).toBeCloseTo(STEP * 1.35);
  });

  it("accelerates walking, attack cooldown and windup while leaving damage and age unchanged", () => {
    const normal = battle(),
      boosted = battle();
    const n = unit(normal, "knight", "blue", 4, 24),
      r = unit(boosted, "knight", "blue", 4, 24);
    cast(boosted, "rage", "blue", 4, 24);
    for (const e of [n, r]) e.cooldown = 1;
    const start = { x: n.x, y: n.y };
    normal.step();
    boosted.step();
    expect(
      Math.hypot(r.x - start.x, r.y - start.y) /
        Math.hypot(n.x - start.x, n.y - start.y),
    ).toBeCloseTo(1.35);
    expect(r.age).toBe(n.age);
    expect(r.damage).toBe(n.damage);
    expect(1 - r.cooldown).toBeCloseTo((1 - n.cooldown) * 1.35);
    const target = unit(boosted, "giant", "red", r.x, r.y - 0.8);
    target.active = false;
    r.cooldown = 0;
    boosted.step();
    const pending = r.pendingAttack!.remaining;
    boosted.step();
    expect(pending - r.pendingAttack!.remaining).toBeCloseTo(STEP * 1.35);
    expect(
      boosted.audioEvents.findLast(
        (e) => e.phase === "attack" && e.actor === r.id,
      ),
    ).toMatchObject({ pitch: 1.25, rate: 1.35 });
  });

  it("accelerates Witch summons, preserves building decay and keeps Freeze authoritative", () => {
    const b = battle();
    const witch = unit(b, "witch", "blue", 4, 23);
    const cannon = unit(b, "cannon", "blue", 6, 23);
    const hidden = unit(b, "tesla", "blue", 7, 23);
    witch.spawnTimer = 0.1;
    const hp = cannon.hp;
    cast(b, "rage", "blue", 4, 23);
    advance(b, 3);
    expect(b.audioEvents.filter((e) => e.phase === "summon")).toHaveLength(1);
    expect(cannon.hp).toBeCloseTo(
      hp - (cannon.maxHp / cannon.lifetime!) * STEP * 3,
    );
    expect(hidden.burrow?.phase).toBe("hidden");
    cast(b, "freeze", "red", witch.x, witch.y);
    const point = { x: witch.x, y: witch.y },
      timer = witch.spawnTimer;
    advance(b, 30);
    expect({ x: witch.x, y: witch.y }).toEqual(point);
    expect(witch.spawnTimer).toBe(timer);
    expect(witch.rage).toBeDefined();
    expect(witch.stun).toBeGreaterThan(0);
  });

  it("replays an entire recorded match without changing outcomes and projects buff clocks for guests", () => {
    const b = new Battle({
      seed: 9,
      ai: false,
      deck,
      enemyDeck: ["rage", ...STARTER_DECK.slice(0, 7)],
    });
    while (!b.winner) {
      if (b.tick % 45 === 0)
        for (const team of ["blue", "red"] as const) {
          const player = b.players[team];
          const slot = player.hand.findIndex(
            (id) => CARD_MAP[id].cost <= player.elixir,
          );
          if (slot >= 0) b.play(team, slot, 4, team === "blue" ? 22 : 10);
        }
      b.step();
    }
    expect(b.actions.some((a) => a.card === "rage")).toBe(true);
    const replay = new Battle({ replay: b.exportReplay() });
    while (replay.tick < b.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(b));
    expect(replay.audioEvents).toEqual(b.audioEvents);
    const current = battle();
    const e = unit(current, "knight", "blue", 4, 22);
    cast(current, "rage", "blue", 4, 22);
    current.step();
    const wire = snapshot(current),
      guest = perspective(wire, "red"),
      view = battle();
    applySnapshot(view, wire, "red");
    expect(view.areas).toEqual(guest.areas);
    expect(view.areas[0]).toMatchObject({
      card: "rage",
      team: "red",
      x: 14,
      y: 10,
    });
    expect(view.entities.find((v) => v.id === e.id)).toMatchObject({
      team: "red",
      rage: e.rage,
      animationTime: e.animationTime,
    });
  });

  it("accepts Rage through the direct host and freezes its clocks during a peer interruption", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((seed) =>
      new Battle({ seed, deck, ai: false }).players.blue.hand.includes("rage"),
    )!;
    const sent: { team: Team; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) => sent.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    for (const team of ["blue", "red"] as const)
      sendPeerCommand(host, team, { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) host.advance(STEP);
    sendPeerCommand(host, "blue", {
      type: "play",
      seq: 1,
      card: "rage",
      x: 4,
      y: 22,
    });
    expect(
      sent.findLast((e) => e.team === "blue" && e.message.type === "ack")
        ?.message,
    ).toMatchObject({ ok: true });
    for (let i = 0; i < 5; i++) host.advance(STEP);
    const before = structuredClone(snapshot(host.battle!));
    host.availability("red", false);
    for (let i = 0; i < 30; i++) host.advance(STEP);
    expect(snapshot(host.battle!)).toEqual(before);
  });

  it("aims the AI's Rage at its friendly push", () => {
    const b = battle();
    const friend = unit(b, "giant", "red", 4, 12);
    friend.active = false;
    unit(b, "knight", "blue", 14, 9).active = false;
    b.players.red.hand = ["rage", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 2;
    // Trigger one decision without changing the existing AI RNG stream.
    (b as unknown as { think: () => void }).think();
    expect(b.actions.at(-1)).toMatchObject({
      card: "rage",
      team: "red",
      x: friend.x,
      y: friend.y,
    });
    b.step();
    expect(friend.rage).toBeDefined();
  });
});
