import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Point, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { createSpellApproachPaths } from "../src/game/spell-approach-paths";
import { damageSpellTarget } from "../src/game/spell-targeting";
import { createWindupHealth } from "../src/game/windup-health";

function setup(card: "hog-rider" | "balloon", caster: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  battle.entities.forEach((e) => (e.active = false));
  const team = caster === "red" ? "blue" : "red";
  const target = battle.entities.find(
    (e) =>
      e.team === caster &&
      e.kind === "tower" &&
      !e.king &&
      e.lane === (caster === "red" ? "left" : "right"),
  )!;
  const spawn = battle as unknown as {
    spawn: (card: CardId, team: Team, x: number, y: number) => void;
  };
  spawn.spawn(
    card,
    team,
    caster === "red" ? 3.5 : 14.5,
    caster === "red" ? 20 : 12,
  );
  const body = battle.entities.at(-1)!;
  Object.assign(body, { active: true, deploy: 0, target: target.id });
  const cast = (card: CardId, side: Team, point: Point = body) => {
    battle.players[side].hand[0] = card;
    battle.players[side].elixir = 10;
    expect(battle.play(side, 0, point.x, point.y).ok).toBe(true);
  };
  const paths = (steps = 90) =>
    createSpellApproachPaths(
      battle.entities,
      battle.areas,
      battle.projectiles,
      steps,
    );
  const shoot = (from: Entity, to: Entity, damage = from.damage) => {
    (
      battle as unknown as {
        releaseAttack: (from: Entity, to: Entity, damage: number) => void;
      }
    ).releaseAttack(from, to, damage);
    return battle.projectiles.at(-1)!;
  };
  return { battle, body, target, team, caster, spawn, cast, paths, shoot };
}

describe("stable spell approach paths", () => {
  for (const card of ["hog-rider", "balloon"] as const)
    for (const caster of ["red", "blue"] as const) {
      it.each([
        "normal",
        "rage",
        "slow",
        "freeze",
        "stun",
        "deploy",
        "stacked",
        "deploy-rage",
        "deploy-stun",
      ])(
        `matches 90 native movement frames (${card}, ${caster}, %s)`,
        (modifier) => {
          const s = setup(card, caster);
          if (["rage", "stacked", "deploy-rage"].includes(modifier))
            s.cast("rage", s.team);
          if (["slow", "stacked"].includes(modifier))
            s.body.slow = { remaining: 0.8 };
          if (modifier === "freeze") {
            s.cast("freeze", s.caster);
            s.battle.areas.at(-1)!.remaining = 0.4;
          }
          if (["stun", "deploy-stun"].includes(modifier)) s.body.stun = 0.8;
          if (["deploy", "deploy-rage", "deploy-stun"].includes(modifier))
            s.body.deploy = 0.4;
          const before = JSON.stringify(s.battle),
            paths = s.paths()!;
          const positions = paths(s.body)!;
          expect(positions).toHaveLength(90);
          expect(paths(s.body)).toBe(positions);
          expect(JSON.stringify(s.battle)).toBe(before);
          for (let i = 0; i < positions.length; i++) {
            s.battle.step();
            expect(s.body.x).toBeCloseTo(positions[i].x, 10);
            expect(s.body.y).toBeCloseTo(positions[i].y, 10);
          }
        },
      );
    }

  for (const caster of ["red", "blue"] as const) {
    it(`leads Rocket ahead of a Raged Balloon (${caster})`, () => {
      const s = setup("balloon", caster),
        control = setup("balloon", caster);
      for (const b of [s, control]) {
        b.body.hp = Math.min(CARD_MAP.rocket.damage, b.body.maxHp * 0.8);
        b.cast("rage", b.team);
      }
      const original = { x: control.body.x, y: control.body.y };
      const point = damageSpellTarget(
        "rocket",
        caster,
        s.battle.entities,
        [],
        s.battle.areas,
      )!;
      expect(point).toBeDefined();
      expect(Math.abs(point.y - s.body.y)).toBeGreaterThan(2);
      s.cast("rocket", caster, point);
      control.cast("rocket", caster, original);
      for (const b of [s, control]) {
        let ticks = 0;
        while (
          b.battle.projectiles.some((p) => p.style === "rocket") &&
          ticks++ < 180
        )
          b.battle.step();
      }
      expect(control.body.hp).toBeGreaterThan(0);
      expect(s.body.hp).toBe(0);
    });

    it(`leads a defensive Fireball ahead of a Raged Hog (${caster})`, () => {
      const s = setup("hog-rider", caster),
        control = setup("hog-rider", caster);
      for (const b of [s, control]) {
        b.body.y = caster === "red" ? 12 : 20;
        b.body.hp = CARD_MAP.fireball.damage;
        b.cast("rage", b.team);
      }
      const original = { x: control.body.x, y: control.body.y };
      const point = damageSpellTarget(
        "fireball",
        caster,
        s.battle.entities,
        [],
        s.battle.areas,
      )!;
      expect(point).toBeDefined();
      s.cast("fireball", caster, point);
      control.cast("fireball", caster, original);
      for (const b of [s, control]) {
        let ticks = 0;
        while (
          b.battle.projectiles.some((p) => p.style === "fireball") &&
          ticks++ < 180
        )
          b.battle.step();
      }
      expect(control.body.hp).toBeGreaterThan(0);
      expect(s.body.hp).toBe(0);
    });
  }

  it("stops at the surviving target's native attack range", () => {
    const s = setup("hog-rider");
    s.body.y = 12;
    const positions = s.paths(120)!(s.body)!;
    for (let i = 0; i < positions.length; i++) {
      s.battle.step();
      expect(s.body.y).toBeCloseTo(positions[i].y, 10);
    }
    expect(positions.at(-1)).toEqual(positions.at(-20));
  });

  it("declines an approach whose fixed destination can be destroyed", () => {
    const s = setup("hog-rider");
    s.body.y = 9;
    s.target.hp = 1;
    expect(s.paths(120)!(s.body)).toBeUndefined();
  });

  it("keeps released spells and damaging/target-changing areas outside this model", () => {
    const s = setup("balloon");
    s.cast("zap", s.caster);
    expect(s.paths()).toBeUndefined();
    s.battle.projectiles = [];
    s.cast("poison", s.caster);
    expect(s.paths()).toBeUndefined();
  });
  it.each(["hog-rider", "balloon"] as const)(
    "leads the approach on the ordinary AI timer (%s)",
    (card) => {
      const s = setup(card),
        b = s.battle;
      const initial = card === "balloon" ? 20 : 13;
      s.body.y = initial;
      s.body.deploy = 2.4;
      const spell = card === "balloon" ? "rocket" : "fireball";
      s.body.hp =
        card === "balloon"
          ? Math.min(CARD_MAP.rocket.damage, s.body.maxHp * 0.8)
          : CARD_MAP.fireball.damage;
      (b as unknown as { ai: boolean }).ai = true;
      while (b.tick < 73) b.step();
      s.cast("rage", s.team);
      b.players.red.hand = [
        spell,
        "three-musketeers",
        "three-musketeers",
        "three-musketeers",
      ];
      b.players.red.queue = [
        "three-musketeers",
        "three-musketeers",
        "three-musketeers",
        "three-musketeers",
      ];
      b.players.red.elixir = CARD_MAP[spell].cost;
      while (b.tick < 180) b.step();
      const actions = b.actions.filter((a) => a.team === "red");
      expect(actions.map((a) => [a.card, a.tick])).toEqual([[spell, 74]]);
      expect(actions[0].y).toBeLessThan(initial - 2);
      expect(s.body.hp).toBe(0);
      expect(s.target.hp).toBe(s.target.maxHp);
    },
  );
  it("declines future visibility changes from an enemy Tesla", () => {
    const s = setup("balloon");
    s.spawn.spawn("tesla", s.caster, 4, 14);
    expect(s.paths()!(s.body)).toBeUndefined();
  });

  it("declines a destination already receiving an ally's windup", () => {
    const s = setup("balloon");
    s.spawn.spawn("knight", s.team, 4, 8);
    const ally = s.battle.entities.at(-1)!;
    Object.assign(ally, {
      active: true,
      deploy: 0,
      target: s.target.id,
      pendingAttack: {
        target: s.target.id,
        remaining: 0.1,
        damage: ally.damage,
      },
    });
    expect(s.paths()!(s.body)).toBeUndefined();
  });
  it("declines a destination that lingering Poison can remove", () => {
    const s = setup("hog-rider");
    s.target.hp = 1;
    s.target.poison = { remaining: 1, elapsed: 0.99 };
    expect(s.paths()!(s.body)).toBeUndefined();
    s.battle.step();
    expect(s.target.hp).toBe(0);
  });

  for (const card of ["hog-rider", "balloon"] as const)
    for (const caster of ["red", "blue"] as const)
      for (const king of [false, true])
        it(`keeps 90 native approach/health frames with a current Crown shot (${card}, ${caster}, king=${king})`, () => {
          const s = setup(card, caster);
          s.body.y = caster === "red" ? 13 : 19;
          s.cast("rage", s.team);
          const tower = s.battle.entities.find(
            (e) => e.team === caster && e.kind === "tower" && e.king === king,
          )!;
          const shot = s.shoot(tower, s.body);
          expect(shot.homing).toBe(true);
          expect(shot.splash).toBe(0);
          expect(shot.source).toBe(tower.id);
          const before = JSON.stringify(s.battle);
          const paths = s.paths()!;
          const positions = paths(s.body)!;
          expect(positions).toHaveLength(90);
          const health = createWindupHealth(
            s.battle.projectiles,
            s.battle.entities,
          ).survival(s.body, paths.frames(s.body)!, s.battle.areas);
          expect(JSON.stringify(s.battle)).toBe(before);
          for (const [i, point] of positions.entries()) {
            s.battle.step();
            expect(s.body.x).toBeCloseTo(point.x, 10);
            expect(s.body.y).toBeCloseTo(point.y, 10);
            expect(health[i].afterAlive).toBe(s.body.hp > 0);
          }
          expect(s.body.hp).toBe(s.body.maxHp - shot.damage);
          expect(s.battle.projectiles).not.toContain(shot);
        });

  it.each(["hog-rider", "balloon"] as const)(
    "holds a spell when a released Crown shot already kills the approaching %s",
    (card) => {
      const s = setup(card);
      s.body.hp = s.target.damage;
      s.cast("rage", s.team);
      s.shoot(s.target, s.body);
      const paths = s.paths()!;
      expect(paths(s.body)).toBeDefined();
      const health = createWindupHealth(
        s.battle.projectiles,
        s.battle.entities,
      ).survival(s.body, paths.frames(s.body)!, s.battle.areas);
      expect(
        damageSpellTarget(
          card === "balloon" ? "rocket" : "fireball",
          s.caster,
          s.battle.entities,
          s.battle.projectiles,
          s.battle.areas,
        ),
      ).toBeUndefined();
      for (const frame of health) {
        s.battle.step();
        expect(frame.afterAlive).toBe(s.body.hp > 0);
      }
      expect(s.body.hp).toBe(0);
    },
  );

  it.each(["stun", "slow", "knockback", "splash", "homing", "source"] as const)(
    "declines a shot outside ordinary homing damage (%s)",
    (field) => {
      const s = setup("balloon");
      const shot = s.shoot(s.target, s.body);
      if (field === "homing") shot.homing = false;
      else if (field === "source") shot.source = 0;
      else shot[field] = 1;
      expect(s.paths()).toBeUndefined();
    },
  );

  it("declines a destination removed by a released homing shot", () => {
    const s = setup("balloon");
    const tower = s.battle.entities.find((e) => e.team === s.team && e.king)!;
    s.shoot(tower, s.target, s.target.hp);
    expect(s.paths(90)!(s.body)).toBeUndefined();
    for (let i = 0; i < 90; i++) s.battle.step();
    expect(s.target.hp).toBe(0);
  });

  it("bounds destination damage by the requested horizon", () => {
    const s = setup("balloon");
    const tower = s.battle.entities.find((e) => e.team === s.team && e.king)!;
    s.target.hp = 1;
    s.shoot(tower, s.target, 1).delay = 2;
    expect(s.paths(20)!(s.body)).toBeDefined();
    expect(s.paths(180)!(s.body)).toBeUndefined();
    for (let i = 0; i < 20; i++) s.battle.step();
    expect(s.target.hp).toBe(1);
  });

  it.each([false, true])(
    "checks another troop's possible death effects before retaining a path (lethal=%s)",
    (lethal) => {
      const s = setup("balloon");
      s.spawn.spawn("lumberjack", s.team, s.body.x, s.body.y);
      const lumberjack = s.battle.entities.at(-1)!;
      Object.assign(lumberjack, {
        active: false,
        deploy: 0,
        hp: lethal ? s.target.damage : lumberjack.maxHp,
      });
      s.shoot(s.target, lumberjack);
      if (lethal) expect(s.paths()!(s.body)).toBeUndefined();
      else expect(s.paths()!(s.body)).toBeDefined();
      for (let i = 0; i < 90; i++) s.battle.step();
      expect(lumberjack.hp === 0).toBe(lethal);
      expect(s.battle.areas.some((a) => a.card === "rage")).toBe(lethal);
    },
  );

  it("leads Fireball on the ordinary AI timer while the defending Princess arrow is in flight", () => {
    const s = setup("hog-rider"),
      b = s.battle;
    Object.assign(s.body, { y: 13, deploy: 2.4, hp: CARD_MAP.fireball.damage });
    (b as unknown as { ai: boolean }).ai = true;
    while (b.tick < 73) b.step();
    s.cast("rage", s.team);
    Object.assign(s.target, {
      active: true,
      target: s.body.id,
      cooldown: 1,
      pendingAttack: {
        target: s.body.id,
        remaining: 1 / 30,
        damage: s.target.damage,
      },
    });
    b.players.red.hand = [
      "fireball",
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
    ];
    b.players.red.queue = [
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
    ];
    b.players.red.elixir = CARD_MAP.fireball.cost;
    b.step();
    expect(b.tick).toBe(74);
    expect(
      b.projectiles.some(
        (p) => p.style === "arrow" && p.source === s.target.id,
      ),
    ).toBe(true);
    expect(s.paths()!(s.body)).toBeDefined();
    while (b.tick < 180) b.step();
    const actions = b.actions.filter((a) => a.team === "red");
    expect(actions.map((a) => [a.card, a.tick])).toEqual([["fireball", 74]]);
    expect(actions[0].y).toBeLessThan(11);
    expect(s.body.hp).toBe(0);
    expect(s.target.hp).toBe(s.target.maxHp);
  });
});
