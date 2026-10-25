import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import rules from "../src/game/royal-giant-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { impactEffect, destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["royal-giant", ...STARTER_DECK.filter((id) => id !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
    "royal-giant",
  ),
)!;

describe("native Royal Giant card", () => {
  it("pins card, projectile, 54 direction clips, portrait and audio", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/royal-giant-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "RoyalGiant",
      cost: 6,
      sourceHitpoints: 1200,
      sourceDamage: 75,
      sourceRange: 6500,
      projectileSpeed: 1000,
      projectileExport: "projectile_cannonball_large",
      buildingsOnly: true,
    });
    const sprites = JSON.parse(
      readFileSync("public/assets/animations/manifest.json", "utf8"),
    );
    const entry = sprites.files.find((file: any) => file.id === "royal-giant");
    expect(entry.metadataSha256).toBe(hash("reference/sc/chr_royal_giant.bin"));
    expect(entry.clips).toBe(54);
    expect(entry.textures[0].originalSha256).toBe(
      "252446a18961f99c936f6b48cdacfe871df43e32fc0c8a0dcb6d2ce82bf2d584",
    );
    expect(
      JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
        .portraits["royal-giant"].row,
    ).toBe("RoyalGiant");
    expect(audio.profiles["royal-giant"].launch.sources).toContain(
      "royal_giant_projectile_fx",
    );
  });

  it("fires its native large cannonball only at buildings, with the rock impact", () => {
    const card = CARD_MAP["royal-giant"];
    expect(card).toMatchObject({
      kind: "troop",
      cost: 6,
      hp: 3029,
      damage: 202,
      speed: 0.75,
      range: 6.5,
      interval: 1.7,
      buildingsOnly: true,
    });
    expect(combatTraits({ card: "royal-giant" }).projectile).toMatchObject({
      source: "RoyalGiantProjectile",
      speed: 1000 / 60,
      homing: true,
    });
    expect(impactEffect("royal-giant")).toBe("hit:royal-giant");
    expect(
      effects.impacts["hit:royal-giant"].components.map((part) => part.emitter),
    ).toEqual(["cannon_hit_rock_emiter", "cannon_hit_smokePuff"]);
    expect(destructionPlan("hit:royal-giant", 7).length).toBeGreaterThan(0);
    const battle = new Battle({ seed, ai: false, deck });
    battle.players.blue.elixir = 10;
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("royal-giant"),
        4,
        22,
      ).ok,
    ).toBe(true);
    expect(battle.players.blue.elixir).toBe(4);
    const giant = battle.entities.find((e) => e.card === "royal-giant")!;
    Object.assign(giant, { y: 12.5, deploy: 0, cooldown: 0 });
    battle.players.red.hand[0] = "knight";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const knight = battle.entities.find((e) => e.card === "knight")!;
    Object.assign(knight, { y: 13, deploy: 0, active: false });
    let shot = battle.projectiles.find((p) => p.source === giant.id);
    for (let i = 0; !shot && i < 120; i++) {
      battle.step();
      shot = battle.projectiles.find((p) => p.source === giant.id);
    }
    expect(giant.target).not.toBe(knight.id);
    expect(battle.entities.find((e) => e.id === giant.target)?.kind).toBe(
      "tower",
    );
    expect(shot).toMatchObject({ style: "royal-giant", damage: 202 });
    expect(projectileArt(shot!)).toBe("projectile_cannonball_large");
  });

  it("preserves the card in replay, guest snapshots and direct peer commands", () => {
    const battle = new Battle({ seed, ai: false, deck });
    for (let i = 0; battle.players.blue.elixir < 6 && i < 240; i++)
      battle.step();
    expect(battle.players.blue.elixir).toBeGreaterThanOrEqual(6);
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("royal-giant"),
        4,
        22,
      ).ok,
    ).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    for (let i = 0; i <= battle.tick; i++) replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.some((e) => e.card === "royal-giant")).toBe(true);
    expect(
      perspective(snapshot(battle), "red").entities.some(
        (e) => e.card === "royal-giant" && e.team === "red",
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
    for (let i = 0; i < 240; i++) peer.advance(STEP);
    sendPeerCommand(peer, "blue", {
      type: "play",
      seq: 1,
      card: "royal-giant",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.some(
        (e) => e.card === "royal-giant" && e.team === "blue",
      ),
    ).toBe(true);
  });
});
