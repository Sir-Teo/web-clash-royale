import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/swarm-cards-data.json";
import audio from "../src/game/combat-audio-data.json";
import { deploymentPositions } from "../src/game/deployment";
import { applySnapshot, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["minion-horde", "three-musketeers", ...STARTER_DECK.slice(0, 6)];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("native Minion Horde and Three Musketeers cards", () => {
  it("pins source counts, portraits and distinct card cast profiles", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/swarm-cards-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules.MinionHorde).toMatchObject({
      base: "Minions",
      character: "Minion",
      cost: 5,
      count: 6,
    });
    expect(rules.ThreeMusketeers).toMatchObject({
      base: "Musketeer",
      character: "Musketeer",
      cost: 9,
      count: 3,
    });
    const portraits = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits;
    expect(portraits["minion-horde"].row).toBe("MinionHorde");
    expect(portraits["three-musketeers"].row).toBe("ThreeMusketeers");
    expect(audio.profiles["minion-horde"].cardSource.row).toBe("MinionHorde");
    expect(audio.profiles["three-musketeers"].cardSource.row).toBe(
      "ThreeMusketeers",
    );
  });

  it("uses existing unit combat while charging each card's own elixir cost", () => {
    const battle = new Battle({ seed: 12, ai: false, deck });
    const p = battle.players.blue;
    p.hand[0] = "minion-horde";
    p.hand[1] = "three-musketeers";
    p.elixir = 10;
    const minion = CARD_MAP.minions;
    const musketeer = CARD_MAP.musketeer;
    expect(CARD_MAP["minion-horde"]).toMatchObject({
      cost: 5,
      count: 6,
      hp: minion.hp,
      damage: minion.damage,
      air: true,
      hitsAir: true,
    });
    expect(CARD_MAP["three-musketeers"]).toMatchObject({
      cost: 9,
      count: 3,
      hp: musketeer.hp,
      damage: musketeer.damage,
      hitsAir: true,
    });
    expect(deploymentPositions("minion-horde", { x: 4, y: 22 })).toHaveLength(
      6,
    );
    expect(
      deploymentPositions("three-musketeers", { x: 9, y: 22 }),
    ).toHaveLength(3);
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(p.elixir).toBe(5);
    expect(
      battle.entities.filter((e) => e.card === "minions" && e.team === "blue"),
    ).toHaveLength(6);
    expect(battle.actions.at(-1)?.card).toBe("minion-horde");
    expect(battle.play("blue", 1, 9, 22)).toMatchObject({
      ok: false,
      reason: "You need 9 elixir.",
    });
    p.elixir = 10;
    expect(battle.play("blue", 1, 9, 22).ok).toBe(true);
    expect(p.elixir).toBe(1);
    expect(
      battle.entities.filter(
        (e) => e.card === "musketeer" && e.team === "blue",
      ),
    ).toHaveLength(3);
    expect(battle.actions.map((a) => a.card)).toEqual([
      "minion-horde",
      "three-musketeers",
    ]);
    const replica = new Battle({ seed: 12, ai: false, deck });
    applySnapshot(replica, snapshot(battle), "blue");
    expect(
      replica.entities.filter(
        (e) => e.card === "musketeer" && e.team === "blue",
      ),
    ).toHaveLength(3);
  });

  it("replays the six-Minions deployment from the selected card", () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "minion-horde",
      ),
    )!;
    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("minion-horde"),
        4,
        22,
      ).ok,
    ).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(
      replay.entities.filter((e) => e.card === "minions" && e.team === "blue"),
    ).toHaveLength(6);
  });

  it("accepts the Horde through the direct browser peer path", () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "minion-horde",
      ),
    )!;
    const messages: { team: "blue" | "red"; message: ServerMessage }[] = [];
    const peer = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) =>
        messages.push({ team, message: structuredClone(message) }),
    );
    expect(peer.join({ name: "Red", deck })).toBe(true);
    peer.receive("blue", { type: "ready", ready: true });
    peer.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) peer.advance(STEP);
    peer.receive("blue", {
      type: "play",
      seq: 1,
      card: "minion-horde",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.filter(
        (e) => e.card === "minions" && e.team === "blue",
      ),
    ).toHaveLength(6);
    expect(peer.battle!.actions.at(-1)?.card).toBe("minion-horde");
  });
});
