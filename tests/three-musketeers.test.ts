import { impactEffect, destructionPlan } from "../src/render/destruction";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { csvRows } from "../scripts/lib/csv.mjs";
import { Battle, STEP, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { deploymentPositions } from "../src/game/deployment";
import { projectileArt } from "../src/render/projectiles";
import { snapshot, perspective } from "../src/network/perspective";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import { sendPeerCommand } from "./helpers/peer-command";
import { encodeDeckCode, decodeDeckCode } from "../src/game/deck-code";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";
import combatAudio from "../src/game/combat-audio-data.json";
import deathAudio from "../src/game/death-audio-data.json";
import destruction from "../src/render/destruction-data.json";
import filter from "../src/render/deploy-filter-data.json";
const card = "three-musketeers" as const;
const deck: CardId[] = [
  card,
  "musketeer",
  "knight",
  "archers",
  "skeletons",
  "goblins",
  "arrows",
  "fireball",
];
function battle() {
  const b = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
  for (const e of b.entities) e.active = false;
  return b;
}
function play(b: Battle, team: Team, id: CardId, x: number, y: number) {
  b.players[team].hand[0] = id;
  b.players[team].elixir = 10;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
function step(b: Battle, n: number) {
  for (let i = 0; i < n; i++) b.step();
}
function seed() {
  for (let seed = 1; seed < 100; seed++) {
    const b = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    if (b.players.blue.hand.includes(card) && b.players.red.hand.includes(card))
      return seed;
  }
  throw Error("no opening hands");
}
describe("Three Musketeers", () => {
  it("lets Musketeer Marshal save for a legal nine-elixir opening through the ordinary AI timer", () => {
    const opponent = SOLO_OPPONENTS.find(
      (o) => o.name === "Musketeer Marshal",
    )!;
    let chosen: Battle | undefined;
    for (let seed = 1; seed <= 1000; seed++) {
      const b = new Battle({
        seed,
        mode: "double",
        enemyDeck: [...opponent.deck],
      });
      if (
        b.players.red.hand.includes(card) &&
        b.players.red.hand.every((id) =>
          [card, "fireball", "zap", "tesla"].includes(id),
        )
      ) {
        chosen = b;
        break;
      }
    }
    expect(chosen).toBeDefined();
    const b = chosen!;
    step(b, 8 / STEP);
    expect(b.actions[0]).toMatchObject({ team: "red", card });
    expect(
      b.entities.filter((e) => e.team === "red" && e.card === "musketeer"),
    ).toHaveLength(3);
    expect(b.players.red.elixir).toBeGreaterThanOrEqual(0);
  });

  it("pins the nine-elixir three-body Rare card and the distinct native portrait", () => {
    const evidence = JSON.parse(
      readFileSync(
        "reference/client/three-musketeers-reconstruction.json",
        "utf8",
      ),
    );
    for (const input of evidence.inputs)
      expect(
        createHash("sha256").update(readFileSync(input.path)).digest("hex"),
      ).toBe(input.sha256);
    const row = csvRows(
      readFileSync("reference/logic/spells_characters.csv", "utf8"),
    ).find((r: any) => r.Name === "ThreeMusketeers");
    expect(row).toMatchObject({
      ManaCost: "9",
      SummonNumber: "3",
      SummonCharacter: "Musketeer",
      Rarity: "Rare",
      IconFile: "three_musketeers",
    });
    expect(CARD_MAP[card]).toMatchObject({
      cost: 9,
      count: 3,
      rarity: "Rare",
      hitsAir: true,
      kind: "troop",
    });
    for (const field of [
      "hp",
      "damage",
      "speed",
      "range",
      "interval",
      "hitsAir",
    ])
      expect(CARD_MAP[card][field]).toBe(CARD_MAP.musketeer[field]);
    expect(combatTraits({ card })).toEqual(combatTraits({ card: "musketeer" }));
    expect(filter.cards).toContain(card);
    const art = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(art.portraits[card]).toMatchObject({
      name: "three_musketeers",
      table: "spells_characters",
      row: "ThreeMusketeers",
    });
    expect(art.portraits[card].shape).not.toBe(art.portraits.musketeer.shape);
  });
  it("shares all native Musketeer lifecycle profiles and medium health bars", () => {
    for (const phase of [
      "attack",
      "launch",
      "impact",
      "cast",
      "spawn",
      "summon",
      "appear",
      "hide",
    ])
      expect(combatAudio.profiles[card][phase]).toEqual(
        combatAudio.profiles.musketeer[phase],
      );
    expect(combatAudio.profiles[card].cardSource).toEqual({
      table: "spells_characters",
      row: "ThreeMusketeers",
    });
    expect(deathAudio.effects[card]).toEqual(deathAudio.effects.musketeer);
    expect(destruction.effects[card]).toEqual(destruction.effects.musketeer);
    expect(destruction.deployments[card]).toEqual(
      destruction.deployments.musketeer,
    );
    expect(impactEffect(card)).toBe("hit:musketeer");
    expect(destructionPlan(impactEffect(card)!, 42)).toEqual(
      destructionPlan(impactEffect("musketeer")!, 42),
    );
    const health = JSON.parse(
      readFileSync("public/assets/ui/health/health.json", "utf8"),
    );
    expect(health.profiles[card]).toEqual(health.profiles.musketeer);
  });
  it("rejects insufficient elixir without spending or cycling and buys exactly three separate bodies at nine", () => {
    const b = battle();
    b.players.blue.hand[0] = card;
    b.players.blue.elixir = 8.99;
    const before = structuredClone(b.players.blue);
    expect(b.play("blue", 0, 4, 23).ok).toBe(false);
    expect(b.players.blue).toEqual(before);
    expect(b.actions).toHaveLength(0);
    b.players.blue.elixir = 9;
    expect(b.play("blue", 0, 4, 23).ok).toBe(true);
    const troops = b.entities.filter((e) => e.card === "musketeer");
    expect(troops).toHaveLength(3);
    expect(troops.map(({ x, y }) => ({ x, y }))).toEqual(
      deploymentPositions(card, { x: 4, y: 23 }, "blue", undefined, b.rulesVersion),
    );
    expect(new Set(troops.map((e) => e.id)).size).toBe(3);
    expect(
      troops.every((e) => e.hp === 720 && e.damage === 218 && !e.air),
    ).toBe(true);
    expect(b.players.blue.elixir).toBe(0);
    expect(b.actions).toHaveLength(1);
    expect(
      b.audioEvents.filter((e) => e.profile === card && e.phase === "cast"),
    ).toHaveLength(1);
    expect(
      b.audioEvents.filter((e) => e.profile === "musketeer" && e.phase === "spawn"),
    ).toHaveLength(3);
  });
  it.each(["knight", "minions"] as const)(
    "all three fire native Musketeer projectiles at %s",
    (target) => {
      const b = battle();
      play(b, "blue", card, 4, 23);
      play(b, "red", target, 4, 10);
      for (const e of b.entities.filter((e) => e.kind === "troop")) {
        e.x = 4;
        e.y = e.team === "blue" ? 23 : 22;
        e.deploy = 0;
        e.cooldown = 0;
        e.speed = 0;
        e.active = true;
      }
      const enemies = b.entities.filter(
          (e) => e.team === "red" && e.card === target,
        ),
        before = enemies.reduce((sum, e) => sum + e.hp, 0);
      step(b, 16);
      const shots = b.projectiles.filter((p) => p.style === "musketeer");
      expect(shots).toHaveLength(3);
      expect(
        shots.every((p) => projectileArt(p) === "projectile_cannonball_small"),
      ).toBe(true);
      expect(
        b.audioEvents.filter((e) => e.profile === "musketeer" && e.phase === "launch"),
      ).toHaveLength(3);
      step(b, 25);
      expect(
        enemies.reduce((sum, e) => sum + Math.max(0, e.hp), 0),
      ).toBeLessThan(before);
    },
  );
  it("survives Fireball with ordinary Musketeer health, then emits one native death per body", () => {
    const b = battle();
    play(b, "blue", card, 4, 23);
    for (const e of b.entities.filter((e) => e.card === "musketeer")) e.speed = 0;
    play(b, "red", "fireball", 4, 23);
    step(b, 100);
    const troops = b.entities.filter((e) => e.card === "musketeer");
    expect(troops).toHaveLength(3);
    expect(troops.every((e) => e.hp === 31)).toBe(true);
    play(b, "red", "arrows", 4, 23);
    step(b, 100);
    expect(b.entities.filter((e) => e.card === "musketeer")).toHaveLength(0);
    expect(
      b.audioEvents.filter((e) => e.profile === "musketeer" && e.phase === "death"),
    ).toHaveLength(3);
  });
  it("validates nine-elixir deployments from both direct peers without leaking the enemy hand", () => {
    const events: { team: Team; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "invite",
      "classic",
      { name: "Blue", deck },
      seed(),
      (team, message) =>
        events.push({ team, message: structuredClone(message) }),
    );
    host.join({ name: "Red", deck });
    for (const team of ["blue", "red"] as const)
      sendPeerCommand(host, team, { type: "ready", ready: true });
    for (let i = 0; i < 14 / STEP; i++) host.advance(STEP);
    const before = host.battle!.players.blue.elixir;
    sendPeerCommand(host, "blue", { type: "play", seq: 1, card, x: 4, y: 22 });
    expect(host.battle!.actions).toHaveLength(0);
    expect(host.battle!.players.blue.elixir).toBe(before);
    for (let i = 0; i < 3 / STEP; i++) host.advance(STEP);
    for (const team of ["blue", "red"] as const) {
      const command = {
        type: "play" as const,
        seq: 2,
        card,
        x: team === "blue" ? 4 : 14,
        y: team === "blue" ? 22 : 10,
      };
      sendPeerCommand(host, team, command);
      sendPeerCommand(host, team, command);
    }
    expect(host.battle!.actions).toHaveLength(2);
    expect(host.battle!.entities.filter((e) => e.card === "musketeer")).toHaveLength(
      6,
    );
    const packet = events.findLast(
      (e) => e.team === "red" && e.message.type === "state",
    )!.message;
    if (packet.type !== "state") throw Error("missing state");
    const view = perspective(packet.state, "red");
    expect(
      view.entities.filter((e) => e.card === "musketeer" && e.team === "blue"),
    ).toHaveLength(3);
    expect(view.players.red.elixir).toBe(0);
    expect(view.players.blue.hand).toEqual(host.battle!.players.red.hand);
  });
  it("round-trips deck codes, shared replay files and exact red-side playback", () => {
    const b = new Battle({ seed: seed(), ai: false, deck, enemyDeck: deck });
    step(b, 12 / STEP);
    for (const team of ["blue", "red"] as const)
      expect(
        b.play(
          team,
          b.players[team].hand.indexOf(card),
          team === "blue" ? 4 : 14,
          team === "blue" ? 22 : 10,
        ).ok,
      ).toBe(true);
    step(b, 120);
    const replay = { ...b.exportReplay(), perspective: "red" as const };
    const clone = new Battle({ replay });
    while (clone.tick < replay.duration) clone.step();
    expect(snapshot(clone)).toEqual(snapshot(b));
    expect(decodeDeckCode(encodeDeckCode(deck))).toEqual(deck);
    const imported = importReplayFile(
      exportReplayFile(
        {
          id: 42,
          date: "2026-10-24T12:00:00.000Z",
          mode: b.mode,
          winner: "blue",
          crowns: [0, 0],
          replay,
        },
        "Red King",
      ),
    );
    expect(imported.record.replay.deck).toContain(card);
    expect(imported.record.replay.perspective).toBe("red");
  });
});
