import { describe, expect, it } from "vitest";
import { Battle, type Team } from "../src/game/engine";
import { createKingDefense } from "../src/game/king-defense";
import type { Projectile } from "../src/game/engine";
import type { InfernoCard } from "../src/game/inferno";
import { areaSpellTarget } from "../src/game/area-spell-targeting";

function setup(
  team: Team = "red",
  hp = 300,
  card: InfernoCard = "inferno-dragon",
) {
  const battle = new Battle({ seed: 12, ai: false });
  for (const entity of battle.entities) entity.active = false;
  const king = battle.entities.find(
    (entity) => entity.team === team && entity.king,
  )!;
  Object.assign(king, { hp, active: true, activation: 3.3 });
  const enemy = team === "red" ? "blue" : "red";
  const y = king.y + (team === "red" ? 3 : -3);
  (battle as any).spawn(card, enemy, king.x, y);
  const attacker = battle.entities.at(-1)!;
  Object.assign(attacker, {
    deploy: 0,
    active: true,
    target: king.id,
    inferno: { target: king.id, stage: 2, elapsed: 4.2, hitTimer: 0.2 },
  });
  battle.players[team].hand = ["rocket", "freeze", "tornado", "pekka"];
  battle.players[team].queue = ["pekka", "pekka", "pekka", "pekka"];
  battle.players[team].elixir = 6;
  const forecast = () =>
    createKingDefense(team, battle.entities, battle.projectiles, battle.areas);
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  return { battle, king, attacker, team, enemy, forecast, step };
}

describe("current Inferno locks threatening the King", () => {
  it.each(["red", "blue"] as const)(
    "predicts a charged Dragon's actual lethal pulse (%s)",
    (team) => {
      const s = setup(team);
      const baseline = s.forecast().baseline;
      s.step(5);
      expect(s.battle.winner).toBeNull();
      s.step(1);
      expect(s.battle.winner).toBe(s.enemy);
      expect(baseline).toBe(6);
    },
  );

  it("includes repeated pulses from the current uninterrupted lock", () => {
    const s = setup("red", 600);
    const baseline = s.forecast().baseline;
    s.step(17);
    expect(s.battle.winner).toBeNull();
    s.step(1);
    expect(s.battle.winner).toBe("blue");
    expect(baseline).toBe(18);
  });

  it("freezes a charged Dragon before choosing a later King-finishing Rocket", () => {
    const s = setup();
    s.battle.entities.find(
      (entity) => entity.team === "blue" && entity.king,
    )!.hp = 50;
    const target = areaSpellTarget(
      "freeze",
      "red",
      s.battle.entities,
      s.battle.areas,
      s.battle.projectiles,
    )!;
    expect(target?.protectsKing).toBe(true);
    expect(target.kingThreatStep).toBe(6);
    (s.battle as any).think();
    expect(s.battle.actions.at(-1)?.card).toBe("freeze");
    s.step(30);
    expect(s.king.hp).toBe(300);
    expect(s.battle.winner).toBeNull();
  });
});

describe("Inferno lock forecast ordering", () => {
  const verify = (s: ReturnType<typeof setup>) => {
    const predicted = s.forecast().baseline;
    let actual = Infinity;
    for (let step = 1; step <= 60 && !s.battle.winner; step++) {
      s.step(1);
      if (s.battle.winner) actual = step;
    }
    expect(predicted).toBe(actual);
    return actual;
  };
  const shot = (
    s: ReturnType<typeof setup>,
    arrival: number,
    extra: Partial<Projectile> = {},
  ) => {
    const a = s.attacker;
    s.battle.projectiles.push({
      id: 900,
      team: s.team,
      source: 0,
      x: a.x,
      y: a.y,
      tx: a.x,
      ty: a.y,
      target: a.id,
      damage: 10000,
      remaining: arrival / 30,
      duration: arrival / 30,
      splash: 0,
      air: true,
      style: "musketeer",
      stun: 0,
      ...extra,
    });
  };
  it.each(["inferno-dragon", "inferno-tower"] as const)(
    "matches %s stages and expiring cadence modifiers",
    (card) => {
      for (const elapsed of [1.8, 3.8, 4.2]) {
        for (const buff of ["none", "rage", "slow", "both"]) {
          const s = setup("red", card === "inferno-tower" ? 1100 : 600, card);
          s.attacker.inferno!.elapsed = elapsed;
          if (buff === "rage" || buff === "both")
            s.attacker.rage = { remaining: 0.3 };
          if (buff === "slow" || buff === "both")
            s.attacker.slow = { remaining: 0.5 };
          verify(s);
        }
      }
    },
  );
  it.each([5, 6, 7])(
    "respects projectile death on tick %i after Combat",
    (arrival) => {
      const s = setup();
      shot(s, arrival);
      expect(verify(s)).toBe(arrival < 6 ? Infinity : 6);
    },
  );
  it("stops later pulses after a nonlethal Zap interrupts the lock", () => {
    const s = setup("red", 600);
    shot(s, 6, { damage: 1, stun: 0.5, splash: 0.5, style: "zap" });
    expect(verify(s)).toBe(Infinity);
    // Reacquired low-stage attacks are outside the current lock forecast.
    expect(s.king.hp).toBe(68);
  });
  it("applies released Ice Wizard slow to the next pulses", () => {
    const s = setup();
    shot(s, 1, { damage: 1, slow: 2.5, splash: 0.5, style: "ice-wizard" });
    expect(verify(s)).toBeGreaterThan(6);
  });
  it.each(["freeze", "tornado"] as const)(
    "predicts the actual protective %s interruption",
    (card) => {
      const s = setup();
      if (card === "tornado")
        s.attacker.y =
          s.king.y +
          s.attacker.range +
          s.king.radius +
          s.attacker.radius * 0.35 -
          0.05;
      const point = {
        x: s.attacker.x,
        y: s.attacker.y + (card === "tornado" ? 4 : 0),
      };
      const result = s.forecast().evaluate(card, point);
      expect(result).toMatchObject({
        baseline: 6,
        improves: true,
        deathStep: Infinity,
      });
      const slot = s.battle.players.red.hand.indexOf(card);
      expect(s.battle.play("red", slot, point.x, point.y).ok).toBe(true);
      s.step(30);
      expect(s.king.hp).toBe(300);
    },
  );
  it("keeps an unreachable Tornado from interrupting the beam", () => {
    const s = setup();
    expect(s.forecast().evaluate("tornado", { x: 1, y: 20 })).toMatchObject({
      improves: false,
      deathStep: 6,
    });
  });
  it.each([
    "unlocked",
    "stale-target",
    "deploying",
    "inactive",
    "stunned",
    "out-of-range",
  ])("excludes a %s channel", (state) => {
    const s = setup();
    if (state === "unlocked") delete s.attacker.inferno;
    if (state === "stale-target") s.attacker.target = null;
    if (state === "deploying") s.attacker.deploy = 0.2;
    if (state === "inactive") s.attacker.active = false;
    if (state === "stunned") s.attacker.stun = 0.2;
    if (state === "out-of-range") s.attacker.y += 10;
    expect(s.forecast().baseline).toBe(Infinity);
  });
  it("combines an existing beam pulse with an ordinary pending swing", () => {
    const s = setup("red", 600);
    (s.battle as any).spawn("lumberjack", "blue", s.king.x, s.king.y + 1);
    Object.assign(s.battle.entities.at(-1)!, {
      deploy: 0,
      target: s.king.id,
      pendingAttack: { target: s.king.id, remaining: 0.2, damage: 200 },
    });
    expect(s.forecast().threats).toHaveLength(2);
    expect(verify(s)).toBe(6);
  });
  it("drops a beam killed by Poison status before its next pulse", () => {
    const s = setup();
    s.attacker.hp = 1;
    s.attacker.poison = { remaining: 1, elapsed: 0.99 };
    expect(verify(s)).toBe(Infinity);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(300);
  });
  it("drops a decaying Inferno Tower before its next pulse", () => {
    const s = setup("red", 300, "inferno-tower");
    s.attacker.hp = 0.01;
    expect(verify(s)).toBe(Infinity);
    expect(s.attacker.hp).toBe(0);
  });
  it("recognizes an already active Freeze before Combat", () => {
    const s = setup();
    expect(s.battle.play("red", 1, s.attacker.x, s.attacker.y).ok).toBe(true);
    expect(verify(s)).toBe(Infinity);
    expect(s.king.hp).toBe(300);
  });
  it("leaves the world and RNG unchanged across alternative defenses", () => {
    const s = setup();
    const before = JSON.stringify(s.battle);
    const context = s.forecast();
    for (const card of ["freeze", "tornado"] as const)
      for (const y of [4, 7, 10, 14]) context.evaluate(card, { x: 9, y });
    expect(JSON.stringify(s.battle)).toBe(before);
  });
  it("does not spend on protection when known damage wins before the beam", () => {
    const s = setup();
    const context = createKingDefense("red", s.battle.entities, [], [], 5);
    expect(context.baseline).toBe(6);
    expect(context.threats).toEqual([]);
    expect(context.evaluate("freeze", s.attacker).improves).toBe(false);
  });
});
