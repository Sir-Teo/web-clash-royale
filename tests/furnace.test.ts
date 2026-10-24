import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Entity } from "../src/game/engine";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import rules from "../src/game/furnace-data.json" with { type: "json" };

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = ["furnace", ...STARTER_DECK.filter((id) => id !== "arrows")];
const spirits = (battle: Battle, team = "blue") => battle.entities.filter(
  (e) => e.card === "fire-spirits" && e.team === team,
);
const spawned = (battle: Battle) => battle.audioEvents.filter(
  (event) => event.phase === "spawn" && event.profile === "fire-spirits",
).length;

function deployed(team: "blue" | "red" = "blue") {
  const battle = new Battle({ seed: 13, ai: false, deck, enemyDeck: deck });
  for (const tower of battle.entities) tower.active = false;
  battle.players[team].hand[0] = "furnace";
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 9, team === "blue" ? 22 : 10).ok).toBe(true);
  const furnace = battle.entities.find((e) => e.card === "furnace")!;
  return { battle, furnace };
}
function destroy(battle: Battle, furnace: Entity) {
  (battle as unknown as { hurt: (entity: Entity, amount: number) => void })
    .hurt(furnace, furnace.hp);
}

describe("archived Furnace", () => {
  it("pins its Rare wave rules, two native 300-frame models and portrait", () => {
    const manifest = json("reference/client/furnace-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      sourceCard: "FirespiritHut", rarity: "Rare", cost: 4,
      sourceHitpoints: 600, deployTime: 1, lifetime: 50,
      spawnNumber: 2, spawnInterval: 0.5, spawnPause: 9.4,
      spawnCharacter: "FireSpirits", spawnCharacterLevelIndex: 2,
      spiritDeployTime: 1, spiritDeployDelay: 0.4,
      spawnRadius: 0.4, actionFrame: 13, fps: 30, frames: 300,
    });
    expect(CARDS).toHaveLength(74);
    expect(CARD_MAP.furnace).toMatchObject({
      kind: "building", rarity: "Rare", cost: 4, hp: 1536,
      damage: 0, lifetime: 50,
    });
    const art = json("public/assets/buildings/furnace.json");
    expect(Object.keys(art.clips).sort()).toEqual(["blue", "red"]);
    expect(art.clips.blue.frames).toHaveLength(300);
    expect(art.clips.red.frames).toHaveLength(300);
    expect(art.clips.blue.labels.action_frame).toBe(13);
    expect(art.clips.red.labels.action_frame).toBe(13);
    expect(json("public/assets/ui/cards/cards.json").portraits.furnace)
      .toMatchObject({ row: "FirespiritHut", name: "firespirit_hut" });
  });

  it.each(["blue", "red"] as const)("releases a staggered %s pair and pauses before the next wave", (team) => {
    const { battle, furnace } = deployed(team);
    for (let i = 0; i < Math.floor(10.3 / STEP); i++) battle.step();
    expect(spirits(battle, team)).toHaveLength(0);
    while (spawned(battle) < 1) battle.step();
    expect(battle.time).toBeCloseTo(10.4, 1);
    expect(spirits(battle, team)[0].deploy).toBeCloseTo(1.4, 1);
    expect(furnace.spawnBurst).toBeCloseTo(0.5);
    expect(furnace.spawnTimer).toBeCloseTo(9.9, 1);
    const first = battle.time;
    while (spawned(battle) < 2) battle.step();
    expect(battle.time - first).toBeCloseTo(0.5, 1);
    expect(spirits(battle, team).map((e) => e.x)).toEqual([8.78, 9.22]);
    const second = battle.time;
    while (spawned(battle) < 3) battle.step();
    expect(battle.time - second).toBeCloseTo(9.4, 1);
  });

  it("cancels the pending second spirit when the Furnace is destroyed", () => {
    const { battle, furnace } = deployed();
    while (spawned(battle) < 1) battle.step();
    destroy(battle, furnace);
    for (let i = 0; i < Math.ceil(12 / STEP); i++) battle.step();
    expect(spawned(battle)).toBe(1);
    expect(battle.entities.some((e) => e.id === furnace.id)).toBe(false);
  });

  it("replays its half-second pending wave and carries it to a peer guest", () => {
    let battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (let seed = 2; !battle.players.blue.hand.includes("furnace") && seed < 100; seed++)
      battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const slot = battle.players.blue.hand.indexOf("furnace");
    expect(slot).toBeGreaterThanOrEqual(0);
    for (let i = 0; battle.players.blue.elixir < 4 && i < 180; i++) battle.step();
    expect(battle.play("blue", slot, 9, 22).ok).toBe(true);
    for (let i = 0; i < Math.ceil(11.5 / STEP); i++) battle.step();
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i < battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(spawned(replay)).toBe(spawned(battle));
    const guest = perspective(snapshot(battle), "red");
    expect(guest.entities.some((e) => e.card === "furnace")).toBe(true);
    expect(guest.entities.some((e) => e.card === "fire-spirits")).toBe(true);

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
    peer.battle!.players.blue.hand[0] = "furnace";
    peer.receive("blue", { type: "play", seq: 1, card: "furnace", x: 9, y: 22 });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    while (!peer.battle!.entities.some((e) => e.card === "fire-spirits"))
      peer.advance(STEP);
    const view = perspective(snapshot(peer.battle!), "red");
    expect(view.entities.find((e) => e.card === "furnace")?.spawnBurst)
      .toBeCloseTo(0.5);
    expect(view.entities.filter((e) => e.card === "fire-spirits")).toHaveLength(1);
  });
});
