import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import rules from "../src/game/dart-goblin-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { impactEffect, destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["dart-goblin", ...STARTER_DECK.filter((id) => id !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
    "dart-goblin",
  ),
)!;

describe("native Dart Goblin card", () => {
  it("pins the archived card, projectile, 54 clips, portrait and audio", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/dart-goblin-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "BlowdartGoblin",
      rarity: "Rare",
      cost: 3,
      sourceHitpoints: 123,
      sourceDamage: 53,
      sourceRange: 6500,
      sourceHitSpeed: 700,
      hitsAir: true,
      projectileExport: "projectile_arrow_basic",
      projectileHitEffect: "BlowdartArrowHit",
      projectileTrailEffect: "BlowdartProjectileEmitter",
    });
    const sprites = JSON.parse(
      readFileSync("public/assets/animations/manifest.json", "utf8"),
    );
    const entry = sprites.files.find((file: any) => file.id === "dart-goblin");
    expect(entry.metadataSha256).toBe(
      hash("reference/sc/chr_goblin_blowdart.bin"),
    );
    expect(entry.clips).toBe(54);
    expect(entry.textures[0].originalSha256).toBe(
      "6f8bef845487def195f26dfa8f4ebea1879d6b213164593cdeb66655781fc12f",
    );
    expect(
      JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
        .portraits["dart-goblin"].row,
    ).toBe("BlowdartGoblin");
    expect(audio.profiles["dart-goblin"].attack.sources).toContain(
      "blowdart_goblin_atk_start",
    );
  });

  it("rapidly fires native darts at air targets with source hit and trail particles", () => {
    expect(CARD_MAP["dart-goblin"]).toMatchObject({
      kind: "troop",
      cost: 3,
      hp: 260,
      damage: 116,
      speed: 2,
      range: 6.5,
      interval: 0.7,
      rarity: "Rare",
      hitsAir: true,
    });
    expect(combatTraits({ card: "dart-goblin" }).projectile).toMatchObject({
      source: "BlowdartGoblinProjectile",
      speed: 800 / 60,
      homing: true,
      gravity: 120,
    });
    expect(impactEffect("dart-goblin")).toBe("hit:dart-goblin");
    expect(
      effects.impacts["hit:dart-goblin"].components.map((part) => part.emitter),
    ).toEqual(["blowdart_goblin_attack_puff", "blowdart_hit_sparks"]);
    expect(effects.trails["dart-goblin"].source).toBe(
      "BlowdartProjectileEmitter",
    );
    const trail = destructionPlan("trail:dart-goblin", 7);
    expect(trail).toHaveLength(15);
    expect(trail.at(-1)!.delay).toBeCloseTo(0.35);

    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("dart-goblin"),
        4,
        22,
      ).ok,
    ).toBe(true);
    expect(battle.players.blue.elixir).toBe(2);
    const attacker = battle.entities.find((e) => e.card === "dart-goblin")!;
    Object.assign(attacker, { deploy: 0, cooldown: 0 });
    battle.players.red.hand[0] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const target = battle.entities.find((e) => e.card === "minions")!;
    Object.assign(target, {
      x: 4,
      y: 19,
      deploy: 0,
      active: false,
      hp: 10000,
      maxHp: 10000,
    });
    let shot = battle.projectiles.find((p) => p.source === attacker.id);
    for (let i = 0; !shot && i < 120; i++) {
      battle.step();
      shot = battle.projectiles.find((p) => p.source === attacker.id);
    }
    expect(attacker.target).toBe(target.id);
    expect(shot).toMatchObject({
      style: "dart-goblin",
      damage: 116,
      target: target.id,
    });
    expect(projectileArt(shot!)).toBe("projectile_arrow_basic");
  });

  it("preserves Dart Goblin in replay, guest snapshots and direct peer commands", () => {
    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("dart-goblin"),
        4,
        22,
      ).ok,
    ).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.some((e) => e.card === "dart-goblin")).toBe(true);
    expect(
      perspective(snapshot(battle), "red").entities.some(
        (e) => e.card === "dart-goblin" && e.team === "red",
      ),
    ).toBe(true);

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
      card: "dart-goblin",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.some(
        (e) => e.card === "dart-goblin" && e.team === "blue",
      ),
    ).toBe(true);
  });
});
