import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { deploymentPositions } from "../src/game/deployment";
import { combatTraits } from "../src/game/combat";
import rules from "../src/game/barbarians-data.json";
import audio from "../src/game/combat-audio-data.json";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["barbarians", ...STARTER_DECK.filter((id) => id !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
    "barbarians",
  ),
)!;

describe("native Barbarians card", () => {
  it("pins source rules, 54 direction clips, portrait and distinct sounds", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/barbarians-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Barbarians",
      character: "Barbarian",
      rarity: "Common",
      cost: 5,
      count: 4,
      sourceHitpoints: 300,
      sourceDamage: 75,
      sourceRange: 700,
      sourceHitSpeed: 1500,
    });
    const sprites = JSON.parse(
      readFileSync("public/assets/animations/manifest.json", "utf8"),
    );
    const entry = sprites.files.find((file: any) => file.id === "barbarians");
    expect(entry.metadataSha256).toBe(hash("reference/sc/chr_barbarian.bin"));
    expect(entry.clips).toBe(54);
    const animation = JSON.parse(
      readFileSync("public/assets/animations/barbarians.json", "utf8"),
    );
    expect(Object.keys(animation.clips)).toHaveLength(54);
    expect(animation.clips["blue-attack-1"]).toBeDefined();
    expect(animation.clips["red-run-9"]).toBeDefined();
    const portraits = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits;
    expect(portraits.barbarians.row).toBe("Barbarians");
    expect(audio.profiles.barbarians.attack.sources).toContain(
      "barbarian_attack_start",
    );
    expect(audio.profiles.barbarians.spawn.sources).toContain(
      "barbarian_deploy",
    );
  });

  it("spends five elixir to place four level-normalized melee fighters", () => {
    const battle = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    const card = CARD_MAP.barbarians;
    expect(card).toMatchObject({
      kind: "troop",
      cost: 5,
      count: 4,
      hp: 757,
      damage: 202,
      speed: 1,
      range: 0.7,
      interval: 1.5,
    });
    expect(combatTraits({ card: "barbarians" })).toMatchObject({
      source: "Barbarian",
      windup: 0.5,
      sight: expect.any(Number),
    });
    expect(deploymentPositions("barbarians", { x: 4, y: 22 })).toEqual([
      { x: 3.501, y: 22.499 },
      { x: 3.501, y: 21.501 },
      { x: 4.499, y: 21.501 },
      { x: 4.499, y: 22.499 },
    ]);
    expect(
      deploymentPositions("barbarians", { x: 4, y: 10 }, "red")[0],
    ).toEqual({
      x: 3.501,
      y: 9.501,
    });
    for (const team of ["blue", "red"] as const) {
      const p = battle.players[team];
      p.hand[0] = "barbarians";
      const y = team === "blue" ? 22 : 10;
      expect(battle.play(team, 0, 4, y).ok).toBe(true);
      expect(p.elixir).toBe(0);
      expect(
        battle.entities.filter(
          (e) => e.team === team && e.card === "barbarians",
        ),
      ).toHaveLength(4);
      expect(battle.actions.at(-1)?.card).toBe("barbarians");
      expect(p.queue.at(-1)).toBe("barbarians");
    }
  });

  it("replays all four original unit positions and rotates the guest view", () => {
    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play("blue", battle.players.blue.hand.indexOf("barbarians"), 4, 22)
        .ok,
    ).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    const positions = (match: Battle) =>
      match.entities
        .filter((e) => e.card === "barbarians")
        .map(({ card, team, x, y, hp }) => ({ card, team, x, y, hp }));
    expect(positions(replay)).toEqual(positions(battle));
    expect(
      perspective(snapshot(battle), "red").entities.filter(
        (e) => e.card === "barbarians" && e.team === "red",
      ),
    ).toHaveLength(4);
  });

  it("accepts Barbarians through the direct browser peer path", () => {
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
    sendPeerCommand(peer, "blue", { type: "ready", ready: true });
    sendPeerCommand(peer, "red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) peer.advance(STEP);
    sendPeerCommand(peer, "blue", {
      type: "play",
      seq: 1,
      card: "barbarians",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.filter(
        (e) => e.card === "barbarians" && e.team === "blue",
      ),
    ).toHaveLength(4);
  });
});
