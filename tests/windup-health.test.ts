import { describe, expect, it } from "vitest";
import {
  Battle,
  type Point,
  type Projectile,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { createKingDefense } from "../src/game/king-defense";
import { createWindupHealth } from "../src/game/windup-health";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { projectileDamagePackets } from "../src/game/projectile-impacts";
import bowler from "../src/game/bowler-data.json";
import log from "../src/game/log-data.json";

function setup(card: CardId = "musketeer", team: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 100;
  const enemy = team === "red" ? "blue" : "red";
  (
    battle as unknown as {
      spawn: (card: CardId, team: Team, x: number, y: number) => void;
    }
  ).spawn(card, enemy, 9, king.y + (team === "red" ? 4 : -4));
  const attacker = battle.entities.at(-1)!;
  Object.assign(attacker, {
    hp: 200,
    deploy: 0,
    active: true,
    cooldown: 100,
    spawnTimer: 100,
    target: king.id,
    pendingAttack: { target: king.id, remaining: 0.2, damage: 200 },
  });
  const shot = (step = 1, damage = 1000, extra: Partial<Projectile> = {}) => {
    const p: Projectile = {
      id: 900 + battle.projectiles.length,
      team,
      source: 0,
      x: attacker.x,
      y: attacker.y,
      tx: attacker.x,
      ty: attacker.y,
      target: attacker.id,
      damage,
      remaining: step / 30,
      duration: step / 30,
      splash: 2.5,
      air: true,
      style: "fireball",
      stun: 0,
      ...extra,
    };
    battle.projectiles.push(p);
    return p;
  };
  const forecast = () =>
    createKingDefense(team, battle.entities, battle.projectiles, battle.areas);
  const project = (point?: Point) =>
    projectTornadoWindup(
      attacker,
      king,
      battle.areas,
      point,
      createWindupHealth(battle.projectiles, battle.entities),
    );
  const tornado = (point: Point) => {
    battle.players[team].hand = ["tornado", "pekka", "pekka", "pekka"];
    battle.players[team].elixir = 3;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const step = (n: number) => {
    for (let i = 0; i < n && !battle.winner; i++) battle.step();
  };
  const verifyFatal = (expected = forecast().baseline) => {
    expect(Number.isFinite(expected)).toBe(true);
    step(expected - 1);
    expect(king.hp).toBe(100);
    step(1);
    expect(battle.winner).toBe(enemy);
  };
  return {
    battle,
    king,
    attacker,
    shot,
    forecast,
    project,
    tornado,
    step,
    verifyFatal,
  };
}

describe("known attacker health before a King attack", () => {
  it.each(["red", "blue"] as const)(
    "holds Freeze when released damage removes both threats (%s)",
    (team) => {
      const s = setup("lumberjack", team);
      s.king.hp = 300;
      s.attacker.y = s.king.y + (team === "red" ? 2 : -2);
      s.attacker.x = 8.5;
      s.attacker.pendingAttack!.damage = s.attacker.damage;
      s.battle.entities.push({
        ...s.attacker,
        id: 800,
        x: 9.5,
        pendingAttack: { ...s.attacker.pendingAttack! },
      });
      s.shot(1);
      s.battle.players.red.hand = ["freeze", "pekka", "pekka", "pekka"];
      s.battle.players.red.elixir = 4;
      expect(s.forecast().baseline).toBe(Infinity);
      expect(s.forecast().threats).toHaveLength(0);
      if (team === "red") {
        (s.battle as unknown as { think: () => void }).think();
        expect(s.battle.actions).toHaveLength(0);
      }
      s.step(10);
      expect(s.king.hp).toBe(300);
      expect(s.attacker.hp).toBe(0);
      expect(s.battle.players.red.elixir).toBeGreaterThanOrEqual(4);
    },
  );

  it.each([5, 6, 7])(
    "retains a shot released before projectile death on step %i",
    (arrival) => {
      const s = setup();
      s.shot(arrival);
      const projection = s.project();
      if (arrival < 6) {
        expect(projection.cancelledStep).toBe(arrival);
        expect(s.forecast().baseline).toBe(Infinity);
        s.step(30);
        expect(s.king.hp).toBe(100);
      } else {
        expect(projection.releaseStep).toBe(6);
        s.verifyFatal();
        expect(s.attacker.hp).toBe(0);
      }
    },
  );

  it("a shield absorbs the entire hit without cancelling the pending attack", () => {
    const s = setup("dark-prince");
    s.attacker.y = s.king.y + 2;
    s.shot();
    expect(s.attacker.shield).toBeGreaterThan(0);
    expect(s.project().releaseStep).toBe(6);
    s.verifyFatal(6);
    expect(s.attacker.shield).toBe(0);
    expect(s.attacker.hp).toBe(200);
  });

  it("orders shield breaking and body damage within the same projectile phase", () => {
    const s = setup("dark-prince");
    s.attacker.y = s.king.y + 2;
    s.shot();
    s.shot();
    expect(s.forecast().baseline).toBe(Infinity);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it("heals before an incoming projectile and keeps the surviving attack", () => {
    const s = setup();
    s.attacker.hp = 40;
    s.attacker.heal = { remaining: 0.1, elapsed: 0.49 };
    s.shot(1, 100);
    expect(s.project().releaseStep).toBe(6);
    s.verifyFatal();
    expect(s.attacker.hp).toBe(68);
  });

  it("caps healing at maximum health before the lethal projectile", () => {
    const s = setup();
    s.attacker.hp = s.attacker.maxHp - 10;
    s.attacker.heal = { remaining: 0.1, elapsed: 0.49 };
    s.shot(1, s.attacker.maxHp);
    expect(s.forecast().baseline).toBe(Infinity);
    s.step(10);
    expect(s.king.hp).toBe(100);
    expect(s.attacker.hp).toBe(0);
  });

  it("applied Poison kills before Combat on the release frame", () => {
    const s = setup();
    s.attacker.hp = 50;
    s.attacker.poison = { remaining: 0.2, elapsed: 0.8 };
    expect(s.project().cancelledStep).toBe(6);
    expect(s.forecast().baseline).toBe(Infinity);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it("does not revive a troop killed by Tornado before its Heal tick", () => {
    const s = setup();
    s.attacker.hp = 40;
    s.attacker.speed = 0;
    s.attacker.heal = { remaining: 0.1, elapsed: 0.49 };
    s.battle.areas.push({
      id: 700,
      card: "tornado",
      team: "red",
      x: s.attacker.x,
      y: s.attacker.y,
      radius: 5.5,
      duration: 3,
      remaining: 2.5,
      hitAt: 0.5,
      damageAt: 0.5,
    });
    expect(s.project().cancelledStep).toBe(1);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it("building decay bypasses a shield before attack release", () => {
    const s = setup("mortar");
    s.attacker.hp = 1;
    s.attacker.shield = 1000;
    expect(s.project().cancelledStep).toBe(1);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it("Tornado's damage can prevent release without any movement", () => {
    const s = setup();
    s.attacker.hp = 30;
    s.attacker.speed = 0;
    s.attacker.pendingAttack!.remaining = 0.8;
    const result = s.forecast().evaluate("tornado", s.attacker);
    expect(result.improves).toBe(true);
    expect(result.deathStep).toBe(Infinity);
    s.tornado(s.attacker);
    s.step(30);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it.each([false, true])(
    "accounts for pulling an attacker %s into a fixed blast",
    (intoBlast) => {
      const s = setup();
      const radius = 2.5 + s.attacker.radius;
      s.shot(3, 1000, {
        ty: s.attacker.y + radius + (intoBlast ? 0.01 : -0.01),
      });
      const point = { x: 9, y: intoBlast ? s.attacker.y + 3 : s.king.y };
      const context = s.forecast();
      expect(Number.isFinite(context.baseline)).toBe(intoBlast);
      const result = context.evaluate("tornado", point);
      expect(result.improves).toBe(intoBlast);
      expect(result.worsens).toBe(!intoBlast);
      s.tornado(point);
      if (intoBlast) {
        s.step(30);
        expect(s.attacker.hp).toBe(0);
        expect(s.king.hp).toBe(100);
      } else s.verifyFatal(result.deathStep);
    },
  );

  it.each([0, 1])(
    "follows a homing shot along the pull path with %i delayed frame",
    (delay) => {
      const s = setup();
      s.shot(10, 1000, {
        source: 800,
        splash: 0,
        homing: true,
        speed: 6.6666666667,
        flight: { x: 9, y: s.attacker.y - 0.8 },
        delay: delay / 30,
      });
      expect(s.forecast().baseline).toBe(Infinity);
      const point = { x: 9, y: s.attacker.y + 3 };
      const result = s.forecast().evaluate("tornado", point);
      expect(result.worsens).toBe(true);
      expect(s.project(point).releaseStep).toBe(6);
      s.tornado(point);
      s.verifyFatal(result.deathStep);
      expect(s.attacker.hp).toBe(0);
    },
  );

  it("uses the moving body for a rolling projectile's first collision", () => {
    const s = setup();
    const y =
      s.attacker.y - bowler.projectile.radius - s.attacker.radius - 0.05;
    const shot = s.shot(3, 1000, {
      source: 800,
      splash: 0,
      target: null,
      style: "bowler",
      x: 9,
      y,
      tx: 9,
      ty: y + 7,
      flight: { x: 9, y },
      speed: 3.3333333333,
      rollHits: [],
    });
    const original = { ...s.attacker };
    const initial = structuredClone(shot);
    expect(projectileDamagePackets(original, [shot])[0].step).toBe(1);
    const point = { x: 9, y: s.attacker.y + 3 };
    s.tornado(point);
    const path: Point[] = [];
    let actual = 0;
    for (let i = 1; i <= 10; i++) {
      s.step(1);
      path.push({ x: s.attacker.x, y: s.attacker.y });
      if (s.attacker.hp <= 0) {
        actual = i;
        break;
      }
    }
    expect(actual).toBeGreaterThan(1);
    // The native projectile mutates in flight; retain the original launch.
    expect(
      projectileDamagePackets(original, [initial], undefined, path)[0].step,
    ).toBe(actual);
  });

  it("retains Log's launch phase before testing a moving body against the roll", () => {
    const s = setup();
    s.attacker.active = false;
    s.attacker.pendingAttack = undefined;
    s.battle.players.red.hand = ["log", "pekka", "pekka", "pekka"];
    s.battle.players.red.elixir = 2;
    const landing =
      s.attacker.y - log.collisionRadius - s.attacker.radius - 0.01;
    expect(
      s.battle.play("red", 0, 9, landing - log.launchMinimumDistance).ok,
    ).toBe(true);
    s.step(14);
    const shots = structuredClone(s.battle.projectiles);
    expect(shots[0].style).toBe("log-launch");
    const original = { ...s.attacker };
    expect(projectileDamagePackets(original, shots)[0].step).toBe(2);
    s.attacker.active = true;
    s.attacker.pendingAttack = {
      target: s.king.id,
      remaining: 0.2,
      damage: 200,
    };
    s.tornado({ x: 9, y: s.attacker.y + 3 });
    const path: Point[] = [];
    let actual = 0;
    for (let i = 1; i <= 10; i++) {
      s.step(1);
      path.push({ x: s.attacker.x, y: s.attacker.y });
      if (s.attacker.hp <= 0) {
        actual = i;
        break;
      }
    }
    expect(actual).toBeGreaterThan(2);
    expect(
      projectileDamagePackets(original, shots, undefined, path)[0].step,
    ).toBe(actual);
    expect(s.king.hp).toBe(100);
  });

  it.each(["stun", "knockback", "slow"] as const)(
    "applies nonlethal projectile %s before a later release",
    (control) => {
      const s = setup();
      s.shot(2, 1, { [control]: control === "slow" ? 1 : 0.5 });
      const projection = s.project();
      if (control === "slow") {
        expect(projection.releaseStep).toBeGreaterThan(6);
        s.verifyFatal();
      } else {
        expect(projection.cancelledStep).toBe(2);
        s.step(2);
        expect(s.attacker.pendingAttack).toBeUndefined();
        expect(s.king.hp).toBe(100);
      }
    },
  );

  it("ignores knockback for an immune attacker", () => {
    const s = setup("giant");
    s.attacker.y = s.king.y + 2;
    s.shot(2, 1, { knockback: 1 });
    expect(s.project().releaseStep).toBe(6);
    s.verifyFatal(6);
  });

  it.each([false, true])(
    "preserves Poison refresh order relative to a pull (%s)",
    (pullFirst) => {
      const s = setup();
      s.attacker.hp = 100;
      s.attacker.pendingAttack!.remaining = 1;
      const pull = {
        id: 700,
        card: "tornado" as const,
        team: "red" as const,
        x: 9,
        y: s.king.y,
        radius: 5.5,
        duration: 3,
        remaining: 3,
        hitAt: 0,
        damageAt: 0.5,
      };
      const cloud = {
        id: 701,
        card: "poison" as const,
        team: "red" as const,
        x: 9,
        y: s.attacker.y + 3.5 + s.attacker.radius - 0.01,
        radius: 3.5,
        duration: 8,
        remaining: 8,
        hitAt: 0,
      };
      s.battle.areas.push(...(pullFirst ? [pull, cloud] : [cloud, pull]));
      expect(Number.isFinite(s.forecast().baseline)).toBe(pullFirst);
      s.step(90);
      expect(s.king.hp <= 0).toBe(pullFirst);
    },
  );

  it.each([
    { card: "fireball", elixir: 8, attacker: "lumberjack", defend: false },
    { card: "arrows", elixir: 7, attacker: "dark-prince", defend: true },
    { card: "rocket", elixir: 10, attacker: "lumberjack", defend: true },
  ] as const)(
    "the natural AI timer handles actual $card flight",
    ({ card, elixir, attacker, defend }) => {
      const battle = new Battle({ seed: 12, ai: true });
      for (const e of battle.entities) e.active = false;
      const king = battle.entities.find((e) => e.team === "red" && e.king)!;
      Object.assign(king, { hp: 300, active: true, cooldown: 3 });
      for (const x of [8.5, 9.5]) {
        (
          battle as unknown as {
            spawn: (card: CardId, team: Team, x: number, y: number) => void;
          }
        ).spawn(attacker, "blue", x, 4.5);
        Object.assign(battle.entities.at(-1)!, { hp: 200, deploy: 2.3 });
      }
      battle.players.red.hand = [card, "freeze", "pekka", "pekka"];
      battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = elixir;
      for (let i = 0; i < 90 && !battle.winner; i++) {
        if (battle.tick === 72)
          expect(battle.play("red", 0, 9, 4.5).ok).toBe(true);
        battle.step();
      }
      expect(
        battle.actions.map((a) => ({ card: a.card, tick: a.tick })),
      ).toEqual([
        { card, tick: 72 },
        ...(defend ? [{ card: "freeze", tick: 74 }] : []),
      ]);
      expect(king.hp).toBe(300);
      expect(battle.winner).toBeNull();
    },
  );

  it("keeps projections repeatable and leaves battle state untouched", () => {
    const s = setup();
    s.shot(3, 1000);
    s.attacker.heal = { remaining: 0.1, elapsed: 0.49 };
    const before = JSON.stringify({
      entities: s.battle.entities,
      projectiles: s.battle.projectiles,
      areas: s.battle.areas,
    });
    const first = s.forecast().evaluate("tornado", { x: 9, y: 10 });
    expect(s.forecast().evaluate("tornado", { x: 9, y: 10 })).toEqual(first);
    expect(
      JSON.stringify({
        entities: s.battle.entities,
        projectiles: s.battle.projectiles,
        areas: s.battle.areas,
      }),
    ).toBe(before);
  });
});
