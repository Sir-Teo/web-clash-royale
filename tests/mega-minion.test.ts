import { sendPeerCommand } from "./helpers/peer-command";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import rules from "../src/game/mega-minion-data.json";
import audio from "../src/game/combat-audio-data.json";
import effects from "../src/render/destruction-data.json";
import { impactEffect, destructionPlan } from "../src/render/destruction";
import { projectileArt } from "../src/render/projectiles";
import { perspective, snapshot } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";

const deck = ["mega-minion", ...STARTER_DECK.filter((id) => id !== "arrows")];
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((value) =>
  new Battle({ seed: value, ai: false, deck }).players.blue.hand.includes(
    "mega-minion",
  ),
)!;

describe("native Mega Minion card", () => {
  it("pins card, projectile, 54 direction clips, portrait and audio", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/mega-minion-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({
      card: "MegaMinion",
      rarity: "Rare",
      cost: 3,
      sourceHitpoints: 395,
      sourceDamage: 147,
      sourceRange: 2000,
      flyingHeight: 1500,
      hitsAir: true,
      projectileExport: "projectile_cannonball_small",
      projectileHitEffect: "mega_minion_hit",
    });
    const sprites = JSON.parse(
      readFileSync("public/assets/animations/manifest.json", "utf8"),
    );
    const entry = sprites.files.find((file: any) => file.id === "mega-minion");
    expect(entry.metadataSha256).toBe(hash("reference/sc/chr_mega_minion.bin"));
    expect(entry.clips).toBe(54);
    expect(entry.textures[0].originalSha256).toBe(
      "48b4d8bb8a2aa3d938a88fba77f7e8b240f221377bd6e2aebcc23a6eec1afc18",
    );
    expect(
      JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
        .portraits["mega-minion"].row,
    ).toBe("MegaMinion");
    expect(audio.profiles["mega-minion"].attack.sources).toContain(
      "royal_minion_attack_start",
    );
  });

  it("flies and fires its native homing shot at an airborne enemy", () => {
    expect(CARD_MAP["mega-minion"]).toMatchObject({
      kind: "troop",
      cost: 3,
      hp: 836,
      damage: 320,
      speed: 1,
      range: 2,
      interval: 1.5,
      rarity: "Rare",
      air: true,
      hitsAir: true,
    });
    expect(combatTraits({ card: "mega-minion" }).projectile).toMatchObject({
      source: "MegaMinionSpit",
      speed: 1000 / 60,
      homing: true,
    });
    expect(impactEffect("mega-minion")).toBe("hit:mega-minion");
    expect(
      effects.impacts["hit:mega-minion"].components.map((part) => part.emitter),
    ).toEqual(["mega_minion_hit_sparks", "Mega_minion_hit_puff"]);
    expect(destructionPlan("hit:mega-minion", 7).length).toBeGreaterThan(0);

    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("mega-minion"),
        4,
        22,
      ).ok,
    ).toBe(true);
    expect(battle.players.blue.elixir).toBe(2);
    const attacker = battle.entities.find((e) => e.card === "mega-minion")!;
    Object.assign(attacker, { deploy: 0, cooldown: 0 });
    battle.players.red.hand[0] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const target = battle.entities.find((e) => e.card === "minions")!;
    Object.assign(target, {
      x: 4,
      y: 20.5,
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
      style: "mega-minion",
      damage: 320,
      target: target.id,
    });
    expect(projectileArt(shot!)).toBe("projectile_cannonball_small");
  });

  it("preserves the airborne card in replay, guest snapshots and direct peer commands", () => {
    const battle = new Battle({ seed, ai: false, deck });
    expect(
      battle.play(
        "blue",
        battle.players.blue.hand.indexOf("mega-minion"),
        4,
        22,
      ).ok,
    ).toBe(true);
    const replay = new Battle({ replay: battle.exportReplay() });
    replay.step();
    expect(replay.actions).toEqual(battle.actions);
    expect(replay.entities.find((e) => e.card === "mega-minion")?.air).toBe(
      true,
    );
    expect(
      perspective(snapshot(battle), "red").entities.some(
        (e) => e.card === "mega-minion" && e.team === "red" && e.air,
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
      card: "mega-minion",
      x: 4,
      y: 22,
    });
    const ack = messages.findLast(
      ({ team, message }) => team === "blue" && message.type === "ack",
    )?.message as Extract<ServerMessage, { type: "ack" }>;
    expect(ack.ok).toBe(true);
    expect(
      peer.battle!.entities.some(
        (e) => e.card === "mega-minion" && e.team === "blue" && e.air,
      ),
    ).toBe(true);
  });
});
