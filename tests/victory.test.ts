import { describe, expect, it } from "vitest";
import { Battle, STEP, other } from "../src/game/engine";
import type { Entity, Replay, Team } from "../src/game/engine";
import combatV4 from "./fixtures/combat-v4-replay.json";

function setup() {
  const b = new Battle({ seed: 12, ai: false });
  for (const tower of b.entities) tower.active = false;
  return b;
}
function tower(b: Battle, team: Team, king: boolean, lane = "left") {
  return b.entities.find(
    (e) =>
      e.team === team &&
      e.kind === "tower" &&
      (king ? e.king : !e.king && e.lane === lane),
  )!;
}
function lethalZap(b: Battle, target: Entity) {
  target.hp = 1;
  const team = other(target.team);
  b.players[team].hand[0] = "zap";
  b.players[team].elixir = 10;
  expect(b.play(team, 0, target.x, target.y).ok).toBe(true);
  b.projectiles.at(-1)!.remaining = STEP;
}
const awards = (b: Battle, team: Team) =>
  b.events
    .filter((e) => e.type === "crown" && e.team === team)
    .map((e) => e.value!);

describe("tower victory resolution", () => {
  it.each([true, false])(
    "caps rewards at three with King-first impact %s",
    (kingFirst) => {
      const b = setup();
      for (const king of [kingFirst, !kingFirst])
        lethalZap(b, tower(b, "red", king));
      b.step();
      expect(b.winner).toBe("blue");
      expect(b.players.blue.crowns).toBe(3);
      expect(awards(b, "blue")).toEqual(kingFirst ? [3] : [1, 2]);
      expect(
        b.entities.filter((e) => e.team === "red" && e.kind === "tower"),
      ).toEqual([]);
      expect(
        b.entities.filter((e) => e.team === "blue" && e.kind === "tower"),
      ).toHaveLength(3);
      expect(
        b.events.filter((e) => e.type === "death" && e.team === "red"),
      ).toHaveLength(3);
      expect(b.events.filter((e) => e.type === "finish")).toHaveLength(1);
    },
  );

  it("collapses the remaining towers without duplicate crowns after a direct King loss", () => {
    const b = setup();
    lethalZap(b, tower(b, "red", true));
    b.step();
    expect(awards(b, "blue")).toEqual([3]);
    expect(b.events.filter((e) => e.type === "death")).toHaveLength(3);
    expect(b.events.at(-1)?.type).toBe("finish");
    const stopped = JSON.stringify(b);
    for (let i = 0; i < 100; i++) b.step();
    expect(JSON.stringify(b)).toBe(stopped);
    expect(b.play("blue", 0, 4, 22).ok).toBe(false);
  });

  it.each(["blue", "red"] as const)(
    "draws when both Kings fall, regardless of %s resolving first",
    (first) => {
      const b = setup();
      lethalZap(b, tower(b, first, true));
      lethalZap(b, tower(b, other(first), true));
      b.step();
      expect(b.winner).toBe("draw");
      expect(b.reason).toBe("Both King Towers destroyed");
      expect([b.players.blue.crowns, b.players.red.crowns]).toEqual([3, 3]);
      expect(awards(b, "blue")).toEqual([3]);
      expect(awards(b, "red")).toEqual([3]);
      expect(b.entities.filter((e) => e.kind === "tower")).toEqual([]);
      expect(b.events.filter((e) => e.type === "death")).toHaveLength(6);
      expect(b.events.filter((e) => e.type === "finish")).toHaveLength(1);
    },
  );

  it("continues overtime after an equal tower trade in the same step", () => {
    const b = setup();
    b.tick = 6000;
    lethalZap(b, tower(b, "red", false));
    lethalZap(b, tower(b, "blue", false));
    b.step();
    expect(b.winner).toBeNull();
    expect([b.players.blue.crowns, b.players.red.crowns]).toEqual([1, 1]);
    lethalZap(b, tower(b, "red", false, "right"));
    b.step();
    expect(b.winner).toBe("blue");
    expect(b.reason).toBe("Sudden death");
    expect(b.players.blue.crowns).toBe(2);
  });

  it.each(["blue", "red"] as const)(
    "includes both melee windups when %s attacks first",
    (first) => {
      const b = setup();
      for (const team of [first, other(first)]) {
        const target = tower(b, other(team), true);
        target.hp = 1;
        const player = b.players[team];
        player.hand[0] = "knight";
        player.elixir = 10;
        expect(b.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
        const attacker = b.entities.at(-1)!;
        Object.assign(attacker, {
          x: target.x,
          y: target.y + (team === "blue" ? 1 : -1),
          deploy: 0,
          pendingAttack: { target: target.id, remaining: STEP, damage: 1 },
        });
      }
      b.step();
      expect(b.winner).toBe("draw");
      expect([b.players.blue.crowns, b.players.red.crowns]).toEqual([3, 3]);
    },
  );

  it("does not include a lethal projectile arriving in a later step", () => {
    const b = setup();
    const survivor = tower(b, "blue", true);
    lethalZap(b, tower(b, "red", true));
    lethalZap(b, survivor);
    b.projectiles.at(-1)!.remaining = STEP * 2;
    b.step();
    expect(b.winner).toBe("blue");
    expect(survivor.hp).toBe(1);
    expect(b.players.red.crowns).toBe(0);
    b.step();
    expect(survivor.hp).toBe(1);
    expect(b.players.red.crowns).toBe(0);
  });

  it("resolves a King loss ahead of an opposing Princess loss in the same overtime step", () => {
    const b = setup();
    b.tick = 6000;
    lethalZap(b, tower(b, "blue", false));
    lethalZap(b, tower(b, "red", true));
    b.step();
    expect(b.winner).toBe("blue");
    expect(b.reason).toBe("King Tower destroyed");
    expect([b.players.blue.crowns, b.players.red.crowns]).toEqual([3, 1]);
    expect(b.events.filter((e) => e.type === "finish")).toHaveLength(1);
  });

  it("includes simultaneous impacts at the regulation deadline before deciding overtime", () => {
    const b = setup();
    b.tick = 5399;
    lethalZap(b, tower(b, "red", false));
    lethalZap(b, tower(b, "blue", false));
    b.step();
    expect(b.time).toBe(180);
    expect(b.winner).toBeNull();
    expect(b.phase).toBe("overtime");
  });

  it("preserves version-4 scoring and finish order for saved replays", () => {
    const b = new Battle({
      replay: { ...combatV4.replay, actions: [] } as Replay,
    });
    lethalZap(b, tower(b, "red", true));
    lethalZap(b, tower(b, "red", false));
    b.step();
    expect(b.players.blue.crowns).toBe(4);
    expect(awards(b, "blue")).toEqual([3, 1]);
    expect(
      b.entities.filter((e) => e.team === "red" && e.kind === "tower"),
    ).toHaveLength(1);
    expect(b.exportReplay().version).toBe(4);
  });
});
