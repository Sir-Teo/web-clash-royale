import { sendPeerCommand } from "./helpers/peer-command";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { csvRows } from "../scripts/lib/csv.mjs";
import { Battle, STEP, type Team } from "../src/game/engine";
import { PeerMatch } from "../src/network/peer-match";
import type { ServerMessage } from "../src/network/protocol";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { deploymentPositions } from "../src/game/deployment";
import { projectileArt } from "../src/render/projectiles";
import { snapshot, perspective } from "../src/network/perspective";
import { encodeDeckCode, decodeDeckCode } from "../src/game/deck-code";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";
import combatAudio from "../src/game/combat-audio-data.json";
import deathAudio from "../src/game/death-audio-data.json";
import destruction from "../src/render/destruction-data.json";
import filter from "../src/render/deploy-filter-data.json";

const deck: CardId[] = [
  "minion-horde",
  "minions",
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
function play(b: Battle, team: Team, card: CardId, x: number, y: number) {
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
const step = (b: Battle, count: number) => {
  for (let i = 0; i < count; i++) b.step();
};
describe("Minion Horde", () => {
  it("pins the six-body five-elixir Common card and shares normalized Minion stats and native profiles", () => {
    const reconstruction = JSON.parse(
      readFileSync("reference/client/minion-horde-reconstruction.json", "utf8"),
    );
    for (const input of reconstruction.inputs)
      expect(
        createHash("sha256").update(readFileSync(input.path)).digest("hex"),
      ).toBe(input.sha256);
    const rows = csvRows(
      readFileSync("reference/logic/spells_characters.csv", "utf8"),
    );
    const row = rows.find((r: any) => r.Name === "MinionHorde");
    expect(row).toMatchObject({
      SummonCharacter: "Minion",
      SummonNumber: "6",
      ManaCost: "5",
      Rarity: "Common",
      IconFile: "minion_horde",
    });
    expect(CARD_MAP["minion-horde"]).toMatchObject({
      cost: Number(row.ManaCost),
      count: Number(row.SummonNumber),
      rarity: row.Rarity,
      air: true,
      hitsAir: true,
    });
    for (const field of [
      "hp",
      "damage",
      "speed",
      "range",
      "interval",
      "air",
      "hitsAir",
    ] as const)
      expect(CARD_MAP["minion-horde"][field]).toBe(CARD_MAP.minions[field]);
    expect(combatTraits({ card: "minion-horde" })).toEqual(
      combatTraits({ card: "minions" }),
    );
    expect(filter.cards).toContain("minion-horde");
    for (const phase of [
      "attack",
      "launch",
      "impact",
      "cast",
      "spawn",
    ] as const)
      expect(combatAudio.profiles["minion-horde"][phase]).toEqual(
        combatAudio.profiles.minions[phase],
      );
    expect(deathAudio.effects["minion-horde"]).toEqual(
      deathAudio.effects.minions,
    );
    expect(destruction.effects["minion-horde"]).toEqual(
      destruction.effects.minions,
    );
    expect(destruction.deployments["minion-horde"]).toEqual(
      destruction.deployments.minions,
    );
    const art = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    );
    expect(art.portraits["minion-horde"]).toMatchObject({
      table: "spells_characters",
      row: "MinionHorde",
      name: "minion_horde",
    });
    expect(art.portraits["minion-horde"].shape).not.toBe(
      art.portraits.minions.shape,
    );
  });
  it("deploys six independent flying bodies for one card play and one five-elixir payment", () => {
    const b = battle();
    play(b, "blue", "minion-horde", 4, 23);
    const troops = b.entities.filter((e) => e.card === "minions");
    expect(troops).toHaveLength(6);
    expect(new Set(troops.map((e) => e.id)).size).toBe(6);
    expect(troops.map(({ x, y }) => ({ x, y }))).toEqual(
      deploymentPositions("minion-horde", { x: 4, y: 23 }),
    );
    expect(troops.every((e) => e.air && e.hp === CARD_MAP.minions.hp)).toBe(
      true,
    );
    expect(b.players.blue.elixir).toBe(5);
    expect(b.actions).toHaveLength(1);
    expect(
      b.audioEvents.filter(
        (e) => e.profile === "minions" && e.phase === "spawn",
      ),
    ).toHaveLength(6);
    expect(
      b.audioEvents.filter(
        (e) => e.profile === "minion-horde" && e.phase === "cast",
      ),
    ).toHaveLength(1);
  });
  it.each(["knight", "minions"] as const)(
    "attacks an enemy %s with native Minion projectiles",
    (target) => {
      const b = battle();
      play(b, "blue", "minion-horde", 4, 23);
      play(b, "red", target, 4, 10);
      const enemy = b.entities.filter(
        (e) => e.card === target && e.team === "red",
      );
      for (const e of b.entities.filter((e) => e.kind === "troop")) {
        e.deploy = 0;
        e.cooldown = 0;
        e.speed = 0;
        e.x = 4;
        e.y = e.team === "blue" ? 23 : 22;
        e.active = true;
      }
      const before = enemy.reduce((n, e) => n + e.hp, 0);
      step(b, 16);
      const spits = b.projectiles.filter((p) => p.style === "minions");
      expect(spits.length).toBeGreaterThan(0);
      expect(
        spits.every(
          (p) => projectileArt(p) === "Tower_projectile1" && p.homing,
        ),
      ).toBe(true);
      step(b, 25);
      expect(enemy.reduce((n, e) => n + Math.max(0, e.hp), 0)).toBeLessThan(
        before,
      );
      if (target === "knight")
        expect(
          b.entities
            .filter((e) => e.card === "minions")
            .every((e) => e.hp === e.maxHp),
        ).toBe(true);
    },
  );
  it("loses all six flying bodies to the complete Arrows volley", () => {
    const b = battle();
    play(b, "blue", "minion-horde", 4, 23);
    for (const e of b.entities.filter((e) => e.card === "minions"))
      e.speed = 0;
    play(b, "red", "arrows", 4, 23);
    step(b, 100);
    expect(b.entities.filter((e) => e.card === "minions")).toHaveLength(0);
    expect(
      b.audioEvents.filter(
        (e) => e.profile === "minions" && e.phase === "death",
      ),
    ).toHaveLength(6);
  });
  it("accepts Horde from both direct peers, hides opposing resources and rejects a duplicate swarm command", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((seed) => {
      const b = new Battle({ seed, deck, enemyDeck: deck, ai: false });
      return (
        b.players.blue.hand.includes("minion-horde") &&
        b.players.red.hand.includes("minion-horde")
      );
    })!;
    const sent: { team: Team; message: ServerMessage }[] = [];
    const host = new PeerMatch(
      "1234567890abcdef12345678",
      "classic",
      { name: "Blue", deck },
      seed,
      (team, message) => sent.push({ team, message: structuredClone(message) }),
    );
    expect(host.join({ name: "Red", deck })).toBe(true);
    for (const team of ["blue", "red"] as const)
      sendPeerCommand(host, team, { type: "ready", ready: true });
    for (let i = 0; i < 210; i++) host.advance(STEP);
    for (const team of ["blue", "red"] as const) {
      const command = {
        type: "play" as const,
        seq: 1,
        card: "minion-horde" as const,
        x: team === "blue" ? 4 : 14,
        y: team === "blue" ? 22 : 10,
      };
      sendPeerCommand(host, team, command);
      expect(
        sent.findLast((e) => e.team === team && e.message.type === "ack")
          ?.message,
      ).toMatchObject({ ok: true });
      sendPeerCommand(host, team, command);
    }
    expect(host.battle!.actions).toHaveLength(2);
    expect(
      host.battle!.entities.filter((e) => e.card === "minions"),
    ).toHaveLength(12);
    const packet = sent.findLast(
      (e) => e.team === "red" && e.message.type === "state",
    )!.message;
    if (packet.type !== "state") throw new Error("Missing guest snapshot");
    const guest = perspective(packet.state, "red");
    expect(
      guest.entities.filter(
        (e) => e.card === "minions" && e.team === "blue",
      ),
    ).toHaveLength(6);
    expect(guest.players.red.elixir).toBe(0);
    expect(guest.players.blue.hand).toEqual(host.battle!.players.red.hand);
  });
  it("replays its commands and red-side state exactly and travels through deck and replay files", () => {
    let b = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
    for (
      let seed = 2;
      seed <= 100 &&
      !(
        b.players.blue.hand.includes("minion-horde") &&
        b.players.red.hand.includes("minion-horde")
      );
      seed++
    )
      b = new Battle({ seed, ai: false, deck, enemyDeck: deck });
    for (const team of ["blue", "red"] as const) {
      const slot = b.players[team].hand.indexOf("minion-horde");
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(
        b.play(team, slot, team === "blue" ? 4 : 14, team === "blue" ? 23 : 10)
          .ok,
      ).toBe(true);
    }
    step(b, 300);
    const replay = b.exportReplay();
    const canonical = new Battle({ replay });
    step(canonical, replay.duration);
    expect(snapshot(canonical)).toEqual(snapshot(b));
    const record = {
      id: 1,
      date: "2026-10-24T12:00:00.000Z",
      mode: b.mode,
      winner: "red" as const,
      crowns: [0, 0] as [number, number],
      replay: { ...replay, perspective: "red" as const },
    };
    const file = importReplayFile(exportReplayFile(record, "Horde King"));
    expect(file.record.replay.deck).toContain("minion-horde");
    expect(perspective(snapshot(canonical), "red").players.blue).toEqual(
      b.players.red,
    );
    expect(decodeDeckCode(encodeDeckCode(deck))).toEqual(deck);
  });
});
