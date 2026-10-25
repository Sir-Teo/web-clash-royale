import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import rules from "../src/game/goblin-barrel-data.json";
import effects from "../src/render/destruction-data.json";
import audio from "../src/game/combat-audio-data.json";
import { destructionPlan, impactEffect } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const deck = [
  "goblin-barrel",
  ...STARTER_DECK.filter((card) => card !== "arrows"),
];
function battle() {
  const match = new Battle({ seed: 4, ai: false, deck });
  for (const tower of match.entities) tower.active = false;
  match.players.blue.hand[0] = "goblin-barrel";
  match.players.blue.elixir = 10;
  return match;
}

describe("native Goblin Barrel spell", () => {
  it("pins archived projectile, portrait, impact, audio and three-Goblin spawn", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/goblin-barrel-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      cost: 3,
      rarity: "Epic",
      speed: 400 / 60,
      gravity: 40,
      landingRadius: 1.5,
      spawnCard: "goblins",
      spawnCount: 3,
      spawnDeployTime: 1.2,
      spawnLevelIndex: 5,
    });
    expect(CARD_MAP["goblin-barrel"]).toMatchObject({
      kind: "spell",
      rarity: "Epic",
      cost: 3,
      radius: 1.5,
      damage: 0,
    });
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(cards.portraits["goblin-barrel"]).toMatchObject({
      row: "GoblinBarrel",
    });
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    expect(clips.spell_goblin_barrel_projectile.frames).toHaveLength(194);
    expect(clips.Barrel_shadow.frames).toHaveLength(1);
    expect(projectileArt({ style: "goblin-barrel" } as any)).toBe(
      "spell_goblin_barrel_projectile",
    );
    expect(audio.profiles["goblin-barrel"].cast.sources).toContain(
      "goblin_barrel_spawn",
    );
    expect(audio.profiles["goblin-barrel"].impact.sources).toContain(
      "goblin_barrel_explosion",
    );
    expect(impactEffect("goblin-barrel")).toBe("goblin-barrel");
    expect(effects.impacts["goblin-barrel"].components).toHaveLength(5);
    expect(destructionPlan("goblin-barrel", 3).length).toBeGreaterThan(40);
  });

  it("flies at source speed and releases exactly three delayed Goblins without landing damage", () => {
    const match = battle();
    const tower = match.entities.find(
      (e) => e.team === "red" && e.kind === "tower" && e.x === 4,
    )!;
    const hp = tower.hp;
    expect(match.play("blue", 0, 4, 6).ok).toBe(true);
    const projectile = match.projectiles[0];
    expect(projectile.style).toBe("goblin-barrel");
    expect(projectile.speed).toBeCloseTo(rules.speed);
    expect(projectile.duration).toBeGreaterThan(3);
    for (let i = 0; i < 30; i++) match.step();
    expect(
      match.entities.filter((e) => e.card === "goblins" && e.team === "blue"),
    ).toHaveLength(0);
    while (match.projectiles.length) match.step();
    const goblins = match.entities.filter(
      (e) => e.card === "goblins" && e.team === "blue",
    );
    expect(goblins).toHaveLength(3);
    expect(goblins.every((e) => e.deploy === 1.2)).toBe(true);
    expect(goblins.every((e) => Math.hypot(e.x - 4, e.y - 6) <= 1.5)).toBe(
      true,
    );
    expect(tower.hp).toBe(hp);
    expect(
      match.events.some(
        (event) => event.type === "hit" && event.card === "goblin-barrel",
      ),
    ).toBe(true);
    expect(
      match.audioEvents.some(
        (event) =>
          event.profile === "goblin-barrel" && event.phase === "impact",
      ),
    ).toBe(true);
  });

  it("rotates its flight for guests and keeps the landing in replays and direct peer commands", () => {
    const match = battle();
    expect(match.play("blue", 0, 14, 6).ok).toBe(true);
    for (let i = 0; i < 30; i++) match.step();
    const host = snapshot(match);
    const guest = perspective(host, "red");
    expect(guest.projectiles[0]).toMatchObject({
      style: "goblin-barrel",
      team: "red",
      tx: 4,
      ty: 26,
    });
    const replica = battle();
    applySnapshot(replica, host, "red");
    expect(replica.projectiles).toEqual(guest.projectiles);
    const replay = new Battle({ replay: match.exportReplay() });
    while (replay.tick < match.tick) replay.step();
    expect(replay.projectiles[0]).toMatchObject({
      style: "goblin-barrel",
      tx: 14,
      ty: 6,
    });

    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
      new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
        "goblin-barrel",
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
    sendPeerCommand(peer, "blue", { type: "ready", ready: true });
    sendPeerCommand(peer, "red", { type: "ready", ready: true });
    for (let i = 0; i < 180; i++) peer.advance(STEP);
    peer.battle!.players.blue.elixir = 10;
    sendPeerCommand(peer, "blue", {
      type: "play",
      seq: 1,
      card: "goblin-barrel",
      x: 4,
      y: 6,
    });
    expect(
      messages.findLast(
        ({ team, message }) => team === "blue" && message.type === "ack",
      )?.message,
    ).toMatchObject({ ok: true });
    expect(peer.battle!.projectiles[0].style).toBe("goblin-barrel");
  });
});
