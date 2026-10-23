import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/goblin-gang-data.json";
import audio from "../src/game/combat-audio-data.json";
import { deploymentPositions } from "../src/game/deployment";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["goblin-gang", ...STARTER_DECK.filter((id) => id !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
    "goblin-gang",
  ),
)!;

describe("native Goblin Gang card", () => {
  it("pins the archived mixed summons, portrait and card cast profile", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/goblin-gang-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "GoblinGang",
      rarity: "Common",
      cost: 3,
      count: 6,
      radius: 0.7,
      characters: ["Goblin", "SpearGoblin"],
    });
    expect(CARD_MAP["goblin-gang"]).toMatchObject({
      kind: "troop",
      cost: 3,
      count: 6,
      radius: 0.7,
    });
    const portraits = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits;
    expect(portraits["goblin-gang"].row).toBe("GoblinGang");
    expect(audio.profiles["goblin-gang"].cardSource.row).toBe("GoblinGang");
  });

  it("places three melee Goblins ahead of three Spear Goblins for both teams", () => {
    for (const team of ["blue", "red"] as const) {
      const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
      const p = battle.players[team];
      p.hand[0] = "goblin-gang";
      p.elixir = 10;
      const y = team === "blue" ? 22 : 10;
      const positions = deploymentPositions("goblin-gang", { x: 9, y }, team);
      expect(positions).toHaveLength(6);
      expect(
        positions.every((pos) => Math.hypot(pos.x - 9, pos.y - y) <= 0.701),
      ).toBe(true);
      expect(battle.play(team, 0, 9, y).ok).toBe(true);
      expect(p.elixir).toBe(7);
      const melee = battle.entities.filter(
        (e) => e.team === team && e.card === "goblins",
      );
      const ranged = battle.entities.filter(
        (e) => e.team === team && e.card === "spear-goblins",
      );
      expect(melee).toHaveLength(3);
      expect(ranged).toHaveLength(3);
      expect(melee.every((e) => e.hp === CARD_MAP.goblins.hp)).toBe(true);
      expect(
        ranged.every(
          (e) =>
            e.hp === CARD_MAP["spear-goblins"].hp &&
            e.range === CARD_MAP["spear-goblins"].range,
        ),
      ).toBe(true);
      expect(
        team === "blue" ? melee[0].y < ranged[0].y : melee[0].y > ranged[0].y,
      ).toBe(true);
      expect(battle.actions.at(-1)?.card).toBe("goblin-gang");
      expect(p.queue.at(-1)).toBe("goblin-gang");
    }
  });

  it("replays the selected Gang card and rotates all six units for its opponent", () => {
    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("goblin-gang"),
        4,
        22,
      ).ok,
    ).toBe(true);
    const red = perspective(snapshot(battle), "red");
    const replica = new Battle({ seed, ai: false, deck });
    applySnapshot(replica, red, "blue");
    expect(
      replica.entities.filter(
        (e) =>
          e.team === "red" &&
          (e.card === "goblins" || e.card === "spear-goblins"),
      ),
    ).toHaveLength(6);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(
      replay.entities.filter(
        (e) =>
          e.team === "blue" &&
          (e.card === "goblins" || e.card === "spear-goblins"),
      ),
    ).toHaveLength(6);
  });

  it("accepts Gang through the direct browser peer path", () => {
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
      card: "goblin-gang",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.filter(
        (e) =>
          e.team === "blue" &&
          (e.card === "goblins" || e.card === "spear-goblins"),
      ),
    ).toHaveLength(6);
    const latest = messages.findLast(
      ({ team, message }) => team === "red" && message.type === "state",
    )?.message as Extract<ServerMessage, { type: "state" }>;
    expect(
      perspective(latest.state, "red").entities.filter(
        (e) =>
          e.team === "red" &&
          (e.card === "goblins" || e.card === "spear-goblins"),
      ),
    ).toHaveLength(6);
  });
});
