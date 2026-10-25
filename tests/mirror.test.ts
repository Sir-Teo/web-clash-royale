import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/mirror-data.json";
import audio from "../src/game/combat-audio-data.json";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["mirror", "skeletons", ...STARTER_DECK.slice(0, 6)];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 300 }, (_, i) => i + 1).find((value) => {
  const hand = new Battle({ seed: value, ai: false, deck }).players.blue.hand;
  return hand.includes("mirror") && hand.includes("skeletons");
})!;

describe("native Mirror card", () => {
  it("pins the archived surcharge, portrait and cast sound", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/mirror-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "Mirror",
      rarity: "Epic",
      surcharge: 1,
      repeatsPreviousCard: true,
    });
    expect(CARD_MAP.mirror).toMatchObject({ kind: "spell", cost: 1 });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits.mirror.row).toBe("Mirror");
    expect(audio.profiles.mirror.cast.sources).toContain("sound:SpellCasting");
  });

  it("requires a previous card, spends the copied cost plus one and cycles Mirror", () => {
    const battle = new Battle({ seed, ai: false, deck });
    const p = battle.players.blue;
    const mirror = p.hand.indexOf("mirror");
    const skeletons = p.hand.indexOf("skeletons");
    expect(battle.cardCost("blue", "mirror")).toBeNull();
    expect(battle.play("blue", mirror, 4, 22)).toMatchObject({ ok: false });
    expect(battle.actions).toHaveLength(0);
    expect(battle.play("blue", skeletons, 4, 22).ok).toBe(true);
    expect(p.lastPlayed).toBe("skeletons");
    expect(battle.cardCost("blue", "mirror")).toBe(2);
    const previous = p.elixir;
    expect(battle.play("blue", p.hand.indexOf("mirror"), 5, 22).ok).toBe(true);
    expect(p.elixir).toBeCloseTo(previous - 2);
    expect(p.lastPlayed).toBe("skeletons");
    expect(battle.entities.filter((e) => e.card === "skeletons")).toHaveLength(
      8,
    );
    expect(battle.actions.at(-1)?.card).toBe("mirror");
    expect(p.queue.at(-1)).toBe("mirror");
    expect(battle.events.findLast((e) => e.type === "deploy")?.value).toBe(2);
  });

  it("copies placement restrictions and spell effects", () => {
    const battle = new Battle({ seed: 34, ai: false, deck });
    const p = battle.players.blue;
    p.hand[0] = "log";
    p.hand[1] = "mirror";
    p.elixir = 10;
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.canPlace("blue", "mirror", 4, 10).ok).toBe(false);
    expect(battle.play("blue", 1, 4, 10).ok).toBe(false);
    expect(battle.play("blue", 1, 4, 22).ok).toBe(true);
    expect(
      battle.projectiles.filter((p) => p.style === "log-launch"),
    ).toHaveLength(2);
    expect(p.elixir).toBeCloseTo(5);
  });

  it("replays the selected Mirror card and projects its changing cost to its owner", () => {
    const battle = new Battle({ seed, ai: false, deck });
    const p = battle.players.blue;
    expect(battle.play("blue", p.hand.indexOf("skeletons"), 4, 22).ok).toBe(
      true,
    );
    expect(battle.play("blue", p.hand.indexOf("mirror"), 5, 22).ok).toBe(true);
    const state = snapshot(battle);
    const owner = perspective(state, "blue");
    expect(owner.players.blue.lastPlayed).toBe("skeletons");
    const guest = new Battle({ seed, ai: false, deck });
    applySnapshot(guest, owner, "blue");
    expect(guest.players.blue.lastPlayed).toBe("skeletons");
    expect(guest.cardCost("blue", "mirror")).toBe(2);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.players.blue.lastPlayed).toBe("skeletons");
    expect(replay.entities.filter((e) => e.card === "skeletons")).toHaveLength(
      8,
    );
  });

  it("accepts Mirror through a direct peer command", () => {
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
    sendPeerCommand(peer, "blue", { type: "play", seq: 1, card: "mirror", x: 4, y: 22 });
    sendPeerCommand(peer, "blue", {
      type: "play",
      seq: 2,
      card: "skeletons",
      x: 4,
      y: 22,
    });
    sendPeerCommand(peer, "blue", { type: "play", seq: 3, card: "mirror", x: 5, y: 22 });
    const acks = messages.filter(
      ({ team, message }) => team === "blue" && message.type === "ack",
    );
    expect(
      acks.map(
        ({ message }) =>
          (message as Extract<ServerMessage, { type: "ack" }>).ok,
      ),
    ).toEqual([false, true, true]);
    expect(
      peer.battle!.entities.filter((e) => e.card === "skeletons"),
    ).toHaveLength(8);
    expect(peer.battle!.actions.map((a) => a.card)).toEqual([
      "skeletons",
      "mirror",
    ]);
    const last = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "state",
    )?.message as Extract<ServerMessage, { type: "state" }>;
    expect(last.state.players.blue.lastPlayed).toBe("skeletons");
  });
});
