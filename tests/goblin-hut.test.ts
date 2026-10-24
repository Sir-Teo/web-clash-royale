import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/goblin-hut-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["goblin-hut", ...STARTER_DECK.filter((id) => id !== "arrows")];

function deployed() {
  const battle = new Battle({ seed: 13, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players.blue.hand[0] = "goblin-hut";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 9, 22).ok).toBe(true);
  const hut = battle.entities.find((e) => e.card === "goblin-hut")!;
  return { battle, hut };
}
const spearCount = (battle: Battle) => battle.entities.filter(
  (e) => e.card === "spear-goblins" && e.team === "blue",
).length;

describe("archived Goblin Hut", () => {
  it("pins its Rare rules, original two-team model and source portrait", () => {
    const manifest = json("reference/client/goblin-hut-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "GoblinHut", rarity: "Rare", cost: 5, sourceHitpoints: 700,
      deployTime: 1, lifetime: 60, spawnNumber: 1, spawnPause: 4.95,
      spawnCharacter: "SpearGoblin", spawnCharacterLevelIndex: 2,
      spawnRadius: 0.4, fps: 30, frames: 5245,
    });
    expect(CARDS).toHaveLength(73);
    expect(CARD_MAP["goblin-hut"]).toMatchObject({
      kind: "building", rarity: "Rare", cost: 5, hp: 1792,
      damage: 0, lifetime: 60,
    });
    const art = json("public/assets/buildings/goblin-hut.json");
    expect(Object.keys(art.clips).sort()).toEqual(["blue", "red"]);
    expect(art.clips.blue.frames).toHaveLength(5245);
    expect(art.clips.red.frames).toHaveLength(5245);
    expect(art.clips.blue.source).toBe("building_goblinHut_player");
    expect(art.clips.red.source).toBe("building_goblinHut_enemy");
    expect(json("public/assets/ui/cards/cards.json").portraits["goblin-hut"])
      .toMatchObject({ row: "GoblinHut", name: "fire_furnace" });
  });

  it("releases one Spear Goblin on each 4.95-second cycle after deploying", () => {
    const { battle, hut } = deployed();
    for (let i = 0; i < Math.floor(5.9 / STEP); i++) battle.step();
    expect(spearCount(battle)).toBe(0);
    while (spearCount(battle) === 0) battle.step();
    expect(battle.time).toBeCloseTo(5.95, 1);
    const spear = battle.entities.find((e) => e.card === "spear-goblins")!;
    expect(spear.team).toBe("blue");
    expect(spear.x).toBe(9);
    expect(spear.y).toBeCloseTo(21.6);
    expect(hut.spawnTimer).toBeCloseTo(4.95, 1);
    const first = battle.time;
    while (spearCount(battle) < 2) battle.step();
    expect(battle.time - first).toBeCloseTo(4.95, 1);
  });

  it("stops spawning when destroyed or expired", () => {
    const destroyed = deployed();
    destroyed.hut.hp = 0;
    for (let i = 0; i < Math.ceil(12 / STEP); i++) destroyed.battle.step();
    expect(spearCount(destroyed.battle)).toBe(0);
    const expired = deployed();
    for (let i = 0; i < Math.ceil(62 / STEP); i++) expired.battle.step();
    expect(expired.battle.entities.some((e) => e.id === expired.hut.id)).toBe(false);
    expect(spearCount(expired.battle)).toBeGreaterThan(0);
    const count = expired.battle.audioEvents.filter((event) =>
      event.phase === "spawn" && event.profile === "spear-goblins"
    ).length;
    for (let i = 0; i < Math.ceil(10 / STEP); i++) expired.battle.step();
    expect(expired.battle.audioEvents.filter((event) =>
      event.phase === "spawn" && event.profile === "spear-goblins"
    )).toHaveLength(count);
  });

  it("replays its spawn cycle and mirrors the hut and Spear Goblins to a guest", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("goblin-hut") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("goblin-hut");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 5 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 9, 22).ok).toBe(true);
    for (let i = 0; i < Math.ceil(7 / STEP); i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(spearCount(replay)).toBe(spearCount(battle));
    expect(replay.entities.find((e) => e.card === "goblin-hut")?.spawnTimer)
      .toBeCloseTo(battle.entities.find((e) => e.card === "goblin-hut")!.spawnTimer);
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.some((e) => e.card === "goblin-hut")).toBe(true);
    expect(guest.entities.some((e) => e.card === "spear-goblins")).toBe(true);
  });

  it("accepts a Goblin Hut play command through the browser peer host", () => {
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
    peer.battle!.players.blue.hand[0] = "goblin-hut";
    peer.receive("blue", { type: "play", seq: 1, card: "goblin-hut", x: 9, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    for (let i = 0; i < Math.ceil(6.1 / STEP); i++) peer.advance(STEP);
    const guest = perspective(snapshot(peer.battle!), "red");
    expect(guest.entities.some((e) => e.card === "goblin-hut")).toBe(true);
    expect(guest.entities.some((e) => e.card === "spear-goblins")).toBe(true);
  });
});
