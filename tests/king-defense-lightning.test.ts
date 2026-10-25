import { describe, expect, it } from "vitest";
import { Battle, type Team } from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { createKingDefense } from "../src/game/king-defense";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { snapshot } from "../src/network/perspective";

function setup(team: Team = "red", release = 0.2, ai = false) {
  const battle = new Battle({ seed: 12, ai });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const sign = team === "red" ? 1 : -1;
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 300;
  const spawn = (card: CardId, side: Team, x: number, y: number) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, side, x, y);
    const e = battle.entities.at(-1)!;
    Object.assign(e, {
      deploy: 0,
      active: false,
      cooldown: 100,
      spawnTimer: 100,
    });
    return e;
  };
  const giant = spawn("giant", team, king.x + 1, king.y);
  giant.hp = 250;
  const attacker = spawn("lumberjack", enemy, king.x, king.y + sign * 2);
  Object.assign(attacker, {
    active: true,
    target: king.id,
    pendingAttack: {
      target: king.id,
      remaining: release,
      damage: attacker.damage,
    },
  });
  // Only the last pulse remains; it selects after the current swing.
  battle.areas.push({
    id: 900,
    card: "lightning",
    team: enemy,
    x: king.x,
    y: king.y,
    radius: 3.5,
    duration: 1.5,
    remaining: 0.5,
    hitAt: 1.38,
    struck: [],
  });
  battle.players[team].hand = ["tornado", "freeze", "pekka", "pekka"];
  battle.players[team].queue = ["pekka", "pekka", "pekka", "pekka"];
  battle.players[team].elixir = 4;
  const point = { x: king.x, y: king.y + sign * 5 };
  const forecast = () =>
    createKingDefense(team, battle.entities, battle.projectiles, battle.areas);
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  return { battle, king, giant, attacker, point, forecast, step, team, enemy };
}

describe("King defense changes Lightning priority", () => {
  it.each(["red", "blue"] as const)(
    "retains a nonlethal swing that draws the last pulse onto a blocker (%s)",
    (team) => {
      const s = setup(team);
      expect(s.forecast().baseline).toBe(Infinity);
      s.step(13);
      expect(s.king.hp).toBe(300 - s.attacker.damage);
      expect(s.giant.hp).toBe(0);
      expect(s.battle.areas[0].struck).toEqual([s.giant.id]);
      expect(s.battle.winner).toBeNull();
    },
  );

  for (const card of ["freeze", "tornado"] as const)
    it.each(["red", "blue"] as const)(
      `rejects ${card} redirecting the last pulse onto the King (%s)`,
      (team) => {
        const s = setup(team);
        const point = card === "freeze" ? s.attacker : s.point;
        expect(s.forecast().evaluate(card, point)).toMatchObject({
          baseline: Infinity,
          deathStep: 13,
          improves: false,
          worsens: true,
        });
        expect(
          s.battle.play(team, card === "tornado" ? 0 : 1, point.x, point.y).ok,
        ).toBe(true);
        s.step(12);
        expect(s.battle.winner).toBeNull();
        s.step(1);
        expect(s.battle.winner).toBe(s.enemy);
        expect(s.battle.areas[0].struck).toEqual([s.king.id]);
      },
    );

  it("the ordinary AI decision preserves the King instead of casting Tornado", () => {
    const s = setup();
    expect(
      areaSpellTarget("tornado", "red", s.battle.entities, s.battle.areas),
    ).toBeUndefined();
    (s.battle as unknown as { think: () => void }).think();
    expect(s.battle.actions).toEqual([]);
    s.step(13);
    expect(s.king.hp).toBe(58);
    expect(s.battle.winner).toBeNull();
  });

  it("does not move same-frame Combat damage ahead of the Lightning selection", () => {
    const s = setup("red", 13 / 30);
    expect(s.forecast().baseline).toBe(13);
    s.step(13);
    expect(s.battle.winner).toBe("blue");
    expect(s.battle.areas[0].struck).toEqual([s.king.id]);
  });

  it("reranks the last pulse after a swing between two remaining pulses", () => {
    const s = setup("red", 0.6);
    const blocker = { ...s.giant, id: 801, x: s.king.x - 1, hp: 600 };
    s.battle.entities.push(blocker);
    Object.assign(s.battle.areas[0], { remaining: 1, hitAt: 0.92 });
    expect(s.forecast().baseline).toBe(Infinity);
    expect(s.forecast().evaluate("freeze", s.attacker)).toMatchObject({
      deathStep: 28,
      worsens: true,
    });
    s.step(28);
    expect(s.battle.areas[0].struck).toEqual([blocker.id, s.giant.id]);
    expect(s.king.hp).toBe(58);
  });

  it("keeps a real rescue when the unprotected swing is itself fatal", () => {
    const s = setup();
    s.attacker.pendingAttack!.damage = 400;
    s.giant.hp = 500;
    const context = s.forecast();
    expect(context.baseline).toBe(6);
    expect(context.evaluate("freeze", s.attacker)).toMatchObject({
      deathStep: Infinity,
      improves: true,
      worsens: false,
    });
    expect(s.battle.play("red", 1, s.attacker.x, s.attacker.y).ok).toBe(true);
    s.step(13);
    expect(s.king.hp).toBe(300);
    expect(s.battle.areas[0].struck).toEqual([s.giant.id]);
  });

  it("combines two nonfatal windups before ranking a later pulse", () => {
    const s = setup();
    s.attacker.pendingAttack!.damage = 100;
    s.attacker.x -= 0.5;
    s.battle.entities.push({
      ...s.attacker,
      id: 802,
      x: s.king.x + 0.5,
      pendingAttack: { ...s.attacker.pendingAttack! },
    });
    s.giant.hp = 150;
    const context = s.forecast();
    expect(context.baseline).toBe(Infinity);
    expect(context.evaluate("freeze", s.attacker).worsens).toBe(true);
    s.step(13);
    expect(s.king.hp).toBe(100);
    expect(s.battle.areas[0].struck).toEqual([s.giant.id]);
  });

  it("keeps whole shield packets out of Lightning's current-health ranking", () => {
    const s = setup();
    s.king.shield = 1;
    expect(s.forecast().baseline).toBe(13);
    s.step(13);
    expect(s.battle.winner).toBe("blue");
    expect(s.battle.areas[0].struck).toEqual([s.king.id]);
  });

  it.each(["freeze", "tornado"] as const)(
    "the ordinary AI timer holds %s through a real three-pulse cast",
    (card) => {
      const s = setup("red", 0.2, true);
      s.battle.areas = [];
      s.battle.entities = s.battle.entities.filter(
        (e) => !(e.team === "red" && e.kind === "tower" && !e.king),
      );
      s.battle.players.blue.crowns = 2;
      Object.assign(s.king, { active: true, cooldown: 3 });
      Object.assign(s.attacker, {
        pendingAttack: undefined,
        cooldown: 0,
        deploy: 2.3,
      });
      for (const [x, hp] of [
        [8, 900],
        [10, 800],
      ]) {
        (
          s.battle as unknown as {
            spawn: (card: CardId, team: Team, x: number, y: number) => void;
          }
        ).spawn("knight", "red", x, s.king.y);
        Object.assign(s.battle.entities.at(-1)!, {
          hp,
          deploy: 0,
          active: false,
        });
      }
      s.battle.players.red.hand = [card, "pekka", "pekka", "pekka"];
      for (let i = 0; i < 90 && !s.battle.winner; i++) {
        if (s.battle.tick === 46) {
          s.battle.players.blue.hand[0] = "lightning";
          s.battle.players.blue.elixir = 10;
          expect(s.battle.play("blue", 0, s.king.x, s.king.y).ok).toBe(true);
        }
        s.battle.step();
      }
      expect(
        s.battle.actions.map((a) => ({
          card: a.card,
          team: a.team,
          tick: a.tick,
        })),
      ).toEqual([{ card: "lightning", team: "blue", tick: 46 }]);
      expect(s.king.hp).toBe(58);
      expect(s.giant.hp).toBe(0);
      expect(s.battle.winner).toBeNull();
      expect(s.battle.players.red.hand).toContain(card);
      expect(s.battle.players.red.elixir).toBeGreaterThan(4);
    },
  );

  it("caches distinct pending timelines without changing battle inputs", () => {
    const s = setup();
    const before = JSON.stringify(snapshot(s.battle));
    const context = s.forecast();
    const safe = { x: 1, y: 15 };
    expect(context.evaluate("tornado", safe).deathStep).toBe(Infinity);
    expect(context.evaluate("tornado", s.point).deathStep).toBe(13);
    expect(context.evaluate("tornado", safe).deathStep).toBe(Infinity);
    expect(context.evaluate("tornado", s.point).worsens).toBe(true);
    expect(JSON.stringify(snapshot(s.battle))).toBe(before);
  });
});
