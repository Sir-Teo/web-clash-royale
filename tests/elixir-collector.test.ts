import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/elixir-collector-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["elixir-collector", ...STARTER_DECK.filter((id) => id !== "arrows")];

function deployed() {
  const battle = new Battle({ seed: 13, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "elixir-collector";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const collector = battle.entities.find((e) => e.card === "elixir-collector")!;
  return { battle, collector };
}

describe("archived Elixir Collector", () => {
  it("pins its Rare rules, team pump animation, portrait, and collection sound", () => {
    const manifest = json("reference/client/elixir-collector-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Elixir Collector", rarity: "Rare", cost: 6,
      sourceHitpoints: 580, deployTime: 1, lifetime: 70,
      collectAmount: 1, generateInterval: 8.5,
      actionFrame: 29, fps: 30, frames: 35,
      collectSound: "sound_elixircollector_get",
    });
    expect(CARDS).toHaveLength(74);
    expect(CARD_MAP["elixir-collector"]).toMatchObject({
      kind: "building", rarity: "Rare", cost: 6,
      hp: 1485, damage: 0, range: 0, lifetime: 70,
    });
    const art = json("public/assets/buildings/elixir-collector.json");
    expect(Object.keys(art.clips)).toEqual(["blue", "red"]);
    expect(art.clips.blue.frames).toHaveLength(35);
    expect(art.clips.red.frames).toHaveLength(35);
    expect(art.clips.blue.labels.action_frame).toBe(29);
    expect(art.clips.red.labels.action_frame).toBe(29);
    expect(json("public/assets/ui/cards/cards.json").portraits["elixir-collector"].row)
      .toBe("Elixir Collector");
    expect(combatAudioPlan("elixir-collector", "collect", 7)[0].file)
      .toBe("get_elixir_02");
  });

  it("produces exactly one elixir after setup and each 8.5-second cycle", () => {
    const { battle, collector } = deployed();
    for (let i = 0; i < Math.floor(9 / STEP); i++) battle.step();
    expect(battle.audioEvents.some((event) => event.phase === "collect")).toBe(false);
    let before = battle.players.blue.elixir;
    while (!battle.audioEvents.some((event) => event.phase === "collect")) {
      before = battle.players.blue.elixir;
      battle.step();
    }
    expect(battle.time).toBeCloseTo(9.5, 1);
    expect(battle.players.blue.elixir - before).toBeCloseTo(1 + STEP / 2.8);
    expect(collector.attack).toBeGreaterThan(0);
    expect(collector.spawnTimer).toBeCloseTo(8.5, 1);
    battle.players.blue.elixir = 0;
    const first = battle.time;
    while (battle.audioEvents.filter((event) => event.phase === "collect").length < 2)
      battle.step();
    expect(battle.time - first).toBeCloseTo(8.5, 1);
    expect(battle.audioEvents.filter((event) => event.phase === "collect"))
      .toHaveLength(2);
  });

  it("honors the ten-elixir cap and stops when destroyed or expired", () => {
    const { battle, collector } = deployed();
    for (let i = 0; i < Math.floor(9.4 / STEP); i++) battle.step();
    battle.players.blue.elixir = 10;
    while (!battle.audioEvents.some((event) => event.phase === "collect")) battle.step();
    expect(battle.players.blue.elixir).toBe(10);
    collector.hp = 0;
    for (let i = 0; i < Math.ceil(10 / STEP); i++) battle.step();
    expect(battle.audioEvents.filter((event) => event.phase === "collect"))
      .toHaveLength(1);

    const natural = deployed();
    for (let i = 0; i < Math.ceil(72 / STEP); i++) natural.battle.step();
    expect(natural.battle.entities.some((e) => e.id === natural.collector.id)).toBe(false);
    expect(natural.battle.audioEvents.filter((event) => event.phase === "collect"))
      .toHaveLength(8);
  });

  it("replays production and carries both team and elixir totals to a guest", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("elixir-collector") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("elixir-collector");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 6 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 4, 22).ok).toBe(true);
    for (let i = 0; i < Math.ceil(11 / STEP); i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.players.blue.elixir).toBeCloseTo(battle.players.blue.elixir);
    expect(replay.entities.find((e) => e.card === "elixir-collector")?.spawnTimer)
      .toBeCloseTo(battle.entities.find((e) => e.card === "elixir-collector")!.spawnTimer);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.some((e) => e.card === "elixir-collector")).toBe(true);
    expect(guest.players.red.elixir).toBeCloseTo(battle.players.blue.elixir);
  });

  it("accepts a Collector command through the two-player host", () => {
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const peer = new PeerMatch(
      "1234567890abcdef12345678", "classic", { name: "Blue", deck }, 13,
      (team, message) => messages.push({ team, message: structuredClone(message) }),
    );
    expect(peer.join({ name: "Red", deck })).toBe(true);
    peer.receive("blue", { type: "ready", ready: true });
    peer.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 240; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    peer.battle!.players.blue.hand[0] = "elixir-collector";
    peer.receive("blue", { type: "play", seq: 1, card: "elixir-collector", x: 4, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(perspective(snapshot(peer.battle!), "red").entities.some(
      (entity) => entity.card === "elixir-collector",
    )).toBe(true);
    for (let i = 0; i < Math.ceil(9.6 / STEP); i++) peer.advance(STEP);
    const guest = perspective(snapshot(peer.battle!), "red");
    expect(guest.players.red.elixir).toBeCloseTo(peer.battle!.players.blue.elixir);
    expect(guest.lifecycleAudioEvents?.some((event) => event.phase === "collect"))
      .toBe(true);
  });
});
