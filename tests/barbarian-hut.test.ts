import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Entity } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/barbarian-hut-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["barbarian-hut", ...STARTER_DECK.filter((id) => id !== "arrows")];
const barbarians = (battle: Battle, team = "blue") => battle.entities.filter(
  (e) => e.card === "barbarians" && e.team === team,
);
const spawned = (battle: Battle) => battle.audioEvents.filter(
  (event) => event.phase === "spawn" && event.profile === "barbarians",
).length;

function deployed(team: "blue" | "red" = "blue") {
  const battle = new Battle({ seed: 13, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players[team].hand[0] = "barbarian-hut";
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 9, team === "blue" ? 22 : 10).ok).toBe(true);
  const hut = battle.entities.find((e) => e.card === "barbarian-hut")!;
  return { battle, hut };
}
function destroy(battle: Battle, hut: Entity) {
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void })
    .hurt(hut, hut.hp);
}

describe("archived Barbarian Hut", () => {
  it("pins its seven-elixir rules, native two-team model and portrait", () => {
    const manifest = json("reference/client/barbarian-hut-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      sourceCard: "BarbarianHut", rarity: "Rare", cost: 7,
      sourceHitpoints: 1100, deployTime: 1, lifetime: 60,
      spawnNumber: 2, spawnInterval: 0.5, spawnPause: 13.5,
      spawnCharacter: "Barbarian", spawnCharacterLevelIndex: 2,
      unitDeployTime: 1, unitDeployDelay: 0.4,
      spawnRadius: 0.4, fps: 30, blueFrames: 1, redFrames: 1,
    });
    expect(CARDS).toHaveLength(74);
    expect(CARD_MAP["barbarian-hut"]).toMatchObject({
      kind: "building", rarity: "Rare", cost: 7, hp: 2816,
      damage: 0, lifetime: 60,
    });
    const art = json("public/assets/buildings/barbarian-hut.json");
    expect(Object.keys(art.clips).sort()).toEqual(["blue", "red"]);
    expect(art.clips.blue.frames).toHaveLength(1);
    expect(art.clips.red.frames).toHaveLength(1);
    expect(art.clips.blue.source).toBe("building_barbarian_hut_blue");
    expect(art.clips.red.source).toBe("building_barbarian_hut_red");
    expect(json("public/assets/ui/cards/cards.json").portraits["barbarian-hut"])
      .toMatchObject({ row: "BarbarianHut", name: "barbarian_hut" });
  });

  it.each(["blue", "red"] as const)("releases a staggered %s pair and waits 13.5 seconds for the next wave", (team) => {
    const { battle, hut } = deployed(team);
    for (let i = 0; i < Math.floor(14.4 / STEP); i++) battle.step();
    expect(barbarians(battle, team)).toHaveLength(0);
    while (spawned(battle) < 1) battle.step();
    expect(battle.time).toBeCloseTo(14.5, 1);
    expect(barbarians(battle, team)[0].deploy).toBeCloseTo(1.4, 1);
    expect(hut.spawnBurst).toBeCloseTo(0.5);
    expect(hut.spawnTimer).toBeCloseTo(14, 1);
    const first = battle.time;
    while (spawned(battle) < 2) battle.step();
    expect(battle.time - first).toBeCloseTo(0.5, 1);
    expect(barbarians(battle, team).map((e) => e.x)).toEqual([8.78, 9.22]);
    const second = battle.time;
    while (spawned(battle) < 3) battle.step();
    expect(battle.time - second).toBeCloseTo(13.5, 1);
  });

  it("stops an unfinished wave when destroyed", () => {
    const { battle, hut } = deployed();
    while (spawned(battle) < 1) battle.step();
    destroy(battle, hut);
    for (let i = 0; i < Math.ceil(16 / STEP); i++) battle.step();
    expect(spawned(battle)).toBe(1);
    expect(battle.entities.some((e) => e.id === hut.id)).toBe(false);
  });

  it("replays waves and carries pending spawns to a peer guest", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("barbarian-hut") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("barbarian-hut");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 7 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 9, 22).ok).toBe(true);
    for (let i = 0; i < Math.ceil(16 / STEP); i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(spawned(replay)).toBe(spawned(battle));
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.some((e) => e.card === "barbarian-hut")).toBe(true);
    expect(guest.entities.some((e) => e.card === "barbarians")).toBe(true);

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
    peer.battle!.players.blue.hand[0] = "barbarian-hut";
    peer.receive("blue", { type: "play", seq: 1, card: "barbarian-hut", x: 9, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    for (let i = 0; i < Math.ceil(15 / STEP) &&
      !peer.battle!.entities.some((e) => e.card === "barbarians"); i++)
      peer.advance(STEP);
    const view = perspective(snapshot(peer.battle!), "red");
    expect(view.entities.find((e) => e.card === "barbarian-hut")?.spawnBurst)
      .toBeCloseTo(0.5);
    expect(view.entities.filter((e) => e.card === "barbarians")).toHaveLength(1);
  });
});
