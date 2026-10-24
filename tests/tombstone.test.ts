import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Entity } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/tombstone-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["tombstone", ...STARTER_DECK.filter((id) => id !== "arrows")];
const skeletons = (battle: Battle, team = "blue") => battle.entities.filter(
  (e) => e.card === "skeletons" && e.team === team,
);
const spawned = (battle: Battle) => battle.audioEvents.filter(
  (event) => event.phase === "spawn" && event.profile === "skeletons",
).length;

function deployed(team: "blue" | "red" = "blue") {
  const battle = new Battle({ seed: 13, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players[team].hand[0] = "tombstone";
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 9, team === "blue" ? 22 : 10).ok).toBe(true);
  const stone = battle.entities.find((e) => e.card === "tombstone")!;
  return { battle, stone };
}
function destroy(battle: Battle, stone: Entity) {
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void })
    .hurt(stone, stone.hp);
}

describe("archived Tombstone", () => {
  it("pins its native team animations, portrait, spawn and death rules", () => {
    const manifest = json("reference/client/tombstone-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Tombstone", rarity: "Rare", cost: 3, sourceHitpoints: 240,
      deployTime: 1, lifetime: 40, spawnNumber: 1, spawnPause: 2.95,
      spawnCharacter: "Skeleton", spawnCharacterLevelIndex: 2,
      deathSpawnCount: 4, deathSpawnCharacter: "Skeleton", spawnRadius: 0.4,
      fps: 30, blueFrames: 60, redFrames: 70,
    });
    expect(CARDS).toHaveLength(73);
    expect(CARD_MAP.tombstone).toMatchObject({
      kind: "building", rarity: "Rare", cost: 3, hp: 614,
      damage: 0, lifetime: 40,
    });
    const art = json("public/assets/buildings/tombstone.json");
    expect(Object.keys(art.clips).sort()).toEqual(["blue", "red"]);
    expect(art.clips.blue.frames).toHaveLength(60);
    expect(art.clips.red.frames).toHaveLength(70);
    expect(art.clips.blue.labels).toEqual({ deploy_start: 0, deploy_end: 20 });
    expect(art.clips.red.labels).toEqual({ deploy_start: 0, deploy_end: 20 });
    expect(json("public/assets/ui/cards/cards.json").portraits.tombstone)
      .toMatchObject({ row: "Tombstone", name: "tombstone" });
  });

  it.each(["blue", "red"] as const)("spawns one %s Skeleton on each 2.95-second cycle", (team) => {
    const { battle, stone } = deployed(team);
    for (let i = 0; i < Math.floor(3.9 / STEP); i++) battle.step();
    expect(skeletons(battle, team)).toHaveLength(0);
    while (!skeletons(battle, team).length) battle.step();
    expect(battle.time).toBeCloseTo(3.95, 1);
    expect(skeletons(battle, team)[0].x).toBe(9);
    expect(skeletons(battle, team)[0].y).toBeCloseTo(
      (team === "blue" ? 22 : 10) + (team === "blue" ? -0.4 : 0.4),
    );
    expect(stone.spawnTimer).toBeCloseTo(2.95, 1);
    const first = battle.time;
    while (spawned(battle) < 2) battle.step();
    expect(battle.time - first).toBeCloseTo(2.95, 1);
  });

  it("releases exactly four extra Skeletons once on destruction", () => {
    const { battle, stone } = deployed();
    destroy(battle, stone);
    expect(skeletons(battle)).toHaveLength(4);
    expect(spawned(battle)).toBe(4);
    const points = skeletons(battle).map((e) => [e.x, e.y]);
    expect(points).toEqual([[9.4, 22], [9, 22.4], [8.6, 22], [9, 21.6]]);
    destroy(battle, stone);
    expect(spawned(battle)).toBe(4);
  });

  it("releases four on natural expiry and stops its periodic cycle", () => {
    const { battle, stone } = deployed();
    for (let i = 0; i < Math.ceil(42 / STEP); i++) battle.step();
    expect(battle.entities.some((e) => e.id === stone.id)).toBe(false);
    const death = battle.events.findLast((event) =>
      event.type === "death" && event.card === "tombstone"
    )!;
    const spawnTimes = battle.audioEvents.filter((event) =>
      event.phase === "spawn" && event.profile === "skeletons"
    ).map((event) => event.time);
    expect(spawnTimes.filter((time) => time === death.time)).toHaveLength(4);
    const last = Math.max(...spawnTimes);
    for (let i = 0; i < Math.ceil(8 / STEP); i++) battle.step();
    expect(Math.max(...battle.audioEvents.filter((event) =>
      event.phase === "spawn" && event.profile === "skeletons"
    ).map((event) => event.time))).toBe(last);
  });

  it("replays periodic spawns and sends the death burst to peer guests", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("tombstone") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("tombstone");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 3 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 9, 22).ok).toBe(true);
    for (let i = 0; i < Math.ceil(5 / STEP); i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(spawned(replay)).toBe(spawned(battle));

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
    peer.battle!.players.blue.hand[0] = "tombstone";
    peer.receive("blue", { type: "play", seq: 1, card: "tombstone", x: 9, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    const stone = peer.battle!.entities.find((e) => e.card === "tombstone")!;
    destroy(peer.battle!, stone);
    const guest = perspective(snapshot(peer.battle!), "red");
    expect(guest.entities.filter((e) => e.card === "skeletons")).toHaveLength(4);
    expect(guest.entities.some((e) => e.card === "tombstone" && e.hp > 0)).toBe(false);
  });
});
