import { describe, expect, it } from "vitest";
import {
  Battle,
  type AreaEffect,
  type Point,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { createKingDefense } from "../src/game/king-defense";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { createWindupHealth } from "../src/game/windup-health";
import { snapshot } from "../src/network/perspective";

function setup(team: Team = "red", card: CardId = "lumberjack", ai = false) {
  const battle = new Battle({ seed: 12, ai });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 100;
  const enemy = team === "red" ? "blue" : "red";
  (
    battle as unknown as {
      spawn: (card: CardId, team: Team, x: number, y: number) => void;
    }
  ).spawn(
    card,
    enemy,
    king.x,
    king.y + (team === "red" ? 1 : -1) * (card === "musketeer" ? 4 : 2),
  );
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
  const bolt = (step = 3, point: Point = attacker): AreaEffect => {
    const area: AreaEffect = {
      id: 900 + battle.areas.length,
      card: "lightning",
      team,
      x: point.x,
      y: point.y,
      radius: 3.5,
      duration: 1.5,
      remaining: 0.5,
      hitAt: 1 + (step - 1) / 30,
      struck: [],
    };
    battle.areas.push(area);
    return area;
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
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  const pull = (point: Point) => {
    battle.players[team].hand = ["tornado", "pekka", "pekka", "pekka"];
    battle.players[team].elixir = 3;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const blocker = (
    hp = 600,
    point: Point = { x: attacker.x + 1, y: attacker.y },
    card: CardId = "knight",
  ) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, enemy, point.x, point.y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { hp, deploy: 0, active: false });
    return body;
  };
  const shoot = (body: typeof attacker, arrival: number, damage = 1000) =>
    battle.projectiles.push({
      id: 1000 + battle.projectiles.length,
      team,
      source: 0,
      x: body.x,
      y: body.y,
      tx: body.x,
      ty: body.y,
      target: body.id,
      damage,
      remaining: arrival / 30,
      duration: arrival / 30,
      splash: 0,
      air: true,
      style: "musketeer",
      stun: 0,
    });
  return {
    battle,
    king,
    attacker,
    enemy,
    team,
    bolt,
    forecast,
    project,
    step,
    pull,
    blocker,
    shoot,
  };
}

describe("Lightning before a current King windup", () => {
  it.each(["red", "blue"] as const)(
    "removes a pending attacker before its swing (%s)",
    (team) => {
      const s = setup(team);
      const area = s.bolt();
      expect(s.project().cancelledStep).toBe(3);
      expect(s.forecast().baseline).toBe(Infinity);
      s.step(15);
      expect(s.attacker.hp).toBe(0);
      expect(s.king.hp).toBe(100);
      expect(area.struck).toEqual([s.attacker.id]);
    },
  );

  it.each([false, true])(
    "cancels a surviving windup even when Lightning only breaks a shield (%s)",
    (shield) => {
      const s = setup();
      s.attacker.hp = s.attacker.maxHp;
      if (!shield) Object.assign(s.attacker, { hp: 2000, maxHp: 2000 });
      if (shield) s.attacker.shield = 1;
      s.bolt();
      expect(s.forecast().baseline).toBe(Infinity);
      expect(s.project().cancelledStep).toBe(3);
      s.step(6);
      expect(s.attacker.hp).toBeGreaterThan(0);
      expect(s.attacker.pendingAttack).toBeUndefined();
      expect(s.king.hp).toBe(100);
    },
  );

  it.each([3, 6, 7])(
    "preserves Lightning-before-Combat order on step %i",
    (arrival) => {
      const s = setup();
      s.bolt(arrival);
      const deadline = s.forecast().baseline;
      expect(deadline).toBe(arrival <= 6 ? Infinity : 6);
      s.step(8);
      expect(s.battle.winner).toBe(arrival <= 6 ? null : s.enemy);
    },
  );

  it("retains a ranged shot launched before Lightning removes its caster", () => {
    const s = setup("red", "musketeer");
    s.bolt(7);
    expect(s.project().releaseStep).toBe(6);
    const deadline = s.forecast().baseline;
    expect(Number.isFinite(deadline)).toBe(true);
    expect(deadline).toBeGreaterThan(7);
    s.step(deadline - 1);
    expect(s.attacker.hp).toBe(0);
    expect(s.battle.winner).toBeNull();
    s.step(1);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it("rejects a pull that saves a fatal attacker from Lightning", () => {
    const s = setup();
    s.bolt(3, {
      x: s.attacker.x + 3.5 + s.attacker.radius - 0.001,
      y: s.attacker.y,
    });
    const context = s.forecast();
    expect(context.baseline).toBe(Infinity);
    expect(context.evaluate("tornado", s.king)).toMatchObject({
      deathStep: 6,
      worsens: true,
    });
    s.pull(s.king);
    s.step(6);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it("credits a pull that brings a fatal attacker into Lightning before release", () => {
    const s = setup();
    const area = s.bolt(3, {
      x: s.attacker.x + 3.5 + s.attacker.radius + 0.1,
      y: s.attacker.y,
    });
    const point = { x: s.attacker.x + 5, y: s.attacker.y };
    const context = s.forecast();
    expect(context.baseline).toBe(6);
    expect(context.evaluate("tornado", point)).toMatchObject({
      deathStep: Infinity,
      improves: true,
    });
    expect(s.project(point).cancelledStep).toBe(3);
    s.pull(point);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
    expect(area.struck).toEqual([s.attacker.id]);
  });

  it("does not count a pulse already spent on this attacker", () => {
    const s = setup();
    const area = s.bolt();
    area.struck = [s.attacker.id];
    expect(s.forecast().baseline).toBe(6);
    s.step(6);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it("keeps the attack when a higher-HP blocker consumes the last pulse", () => {
    const s = setup();
    const blocker = s.blocker();
    const area = s.bolt();
    expect(s.forecast().baseline).toBe(6);
    s.step(6);
    expect(area.struck).toEqual([blocker.id]);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it("shares one pulse selection across multiple current King attackers", () => {
    const s = setup();
    s.king.hp = 300;
    s.attacker.x -= 0.5;
    const second = s.blocker(150, { x: s.king.x + 0.5, y: s.attacker.y });
    Object.assign(second, {
      active: true,
      cooldown: 100,
      target: s.king.id,
      pendingAttack: { target: s.king.id, remaining: 0.2, damage: 200 },
    });
    const area = s.bolt();
    const context = s.forecast();
    expect(context.attempts.map((a) => a.packets.length)).toEqual([0, 1]);
    expect(context.baseline).toBe(Infinity);
    s.step(6);
    expect(area.struck).toEqual([s.attacker.id]);
    expect(s.king.hp).toBe(100);
  });

  it.each([true, false])(
    "preserves same-frame Tornado/Lightning area order (%s)",
    (pullFirst) => {
      const s = setup();
      s.attacker.hp = 100;
      s.attacker.shield = 1;
      const blocker = s.blocker(130);
      const area = s.bolt(1);
      const tornado: AreaEffect = {
        id: 899,
        card: "tornado",
        team: s.team,
        x: s.attacker.x,
        y: s.attacker.y,
        radius: 5.5,
        duration: 3.05,
        remaining: 3.05,
        damageAt: 0,
        hitAt: 100,
      };
      s.battle.areas = pullFirst ? [tornado, area] : [area, tornado];
      expect(s.forecast().baseline).toBe(pullFirst ? Infinity : 6);
      s.step(6);
      expect(area.struck).toEqual([pullFirst ? s.attacker.id : blocker.id]);
      expect(s.battle.winner).toBe(pullFirst ? null : s.enemy);
    },
  );

  it.each([1, 3])(
    "orders applied Heal after pulses, before later frames (%i)",
    (arrival) => {
      const s = setup();
      s.attacker.hp = 100;
      s.attacker.heal = { remaining: 0.1, elapsed: 0.49 };
      const blocker = s.blocker(150);
      const area = s.bolt(arrival);
      expect(s.forecast().baseline).toBe(arrival === 1 ? 6 : Infinity);
      s.step(6);
      expect(area.struck).toEqual([arrival === 1 ? blocker.id : s.attacker.id]);
      expect(s.battle.winner).toBe(arrival === 1 ? s.enemy : null);
    },
  );

  it.each([true, false])(
    "uses the attacker's position at Lightning's own area phase (%s)",
    (pullFirst) => {
      const s = setup();
      const area = s.bolt(1, {
        x: s.attacker.x + 3.5 + s.attacker.radius - 0.001,
        y: s.attacker.y,
      });
      const tornado: AreaEffect = {
        id: 899,
        card: "tornado",
        team: s.team,
        x: s.king.x,
        y: s.king.y,
        radius: 5.5,
        duration: 3.05,
        remaining: 3.05,
        hitAt: 0,
      };
      s.battle.areas = pullFirst ? [tornado, area] : [area, tornado];
      expect(s.forecast().baseline).toBe(pullFirst ? 6 : Infinity);
      s.step(6);
      expect(area.struck).toEqual(pullFirst ? [] : [s.attacker.id]);
      expect(s.battle.winner).toBe(pullFirst ? s.enemy : null);
    },
  );

  it.each([1, 3])(
    "orders applied Poison after pulses, before later frames (%i)",
    (arrival) => {
      const s = setup();
      s.attacker.hp = 100;
      const blocker = s.blocker(150);
      blocker.poison = { remaining: 0.1, elapsed: 0.99 };
      const area = s.bolt(arrival);
      expect(s.forecast().baseline).toBe(arrival === 1 ? 6 : Infinity);
      s.step(6);
      expect(area.struck).toEqual([arrival === 1 ? blocker.id : s.attacker.id]);
      expect(s.battle.winner).toBe(arrival === 1 ? s.enemy : null);
    },
  );

  it.each([1, 3])(
    "orders released shots after pulses, before later frames (%i)",
    (arrival) => {
      const s = setup();
      const blocker = s.blocker(600);
      const area = s.bolt(arrival);
      s.shoot(blocker, 1);
      expect(s.forecast().baseline).toBe(arrival === 1 ? 6 : Infinity);
      s.step(6);
      expect(area.struck).toEqual([arrival === 1 ? blocker.id : s.attacker.id]);
      expect(s.battle.winner).toBe(arrival === 1 ? s.enemy : null);
    },
  );

  it("does not revive an attacker killed before its same-frame Heal tick", () => {
    const s = setup();
    s.attacker.heal = { remaining: 0.2, elapsed: 0.42 };
    s.bolt();
    expect(s.forecast().baseline).toBe(Infinity);
    s.step(6);
    expect(s.attacker.hp).toBe(0);
    expect(s.king.hp).toBe(100);
  });

  it.each([
    { card: "lumberjack", castAt: 60, defend: false },
    { card: "dark-prince", castAt: 60, defend: false },
    { card: "lumberjack", castAt: 70, defend: true },
  ] as const)(
    "the ordinary AI timer respects real $card Lightning timing ($castAt)",
    ({ card, castAt, defend }) => {
      const s = setup("red", card, true);
      Object.assign(s.king, { hp: 300, active: true, cooldown: 3 });
      Object.assign(s.attacker, {
        x: 8.5,
        pendingAttack: undefined,
        cooldown: 0,
        deploy: 2.3,
      });
      const second = s.blocker(200, { x: 9.5, y: s.attacker.y }, card);
      Object.assign(second, { active: true, cooldown: 0, deploy: 2.3 });
      s.battle.players.red.hand = ["lightning", "freeze", "pekka", "pekka"];
      s.battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      s.battle.players.red.elixir = 10;
      for (let i = 0; i < 90 && !s.battle.winner; i++) {
        if (s.battle.tick === castAt)
          expect(s.battle.play("red", 0, 9, s.attacker.y).ok).toBe(true);
        s.battle.step();
      }
      expect(
        s.battle.actions.map((a) => ({ card: a.card, tick: a.tick })),
      ).toEqual([
        { card: "lightning", tick: castAt },
        ...(defend ? [{ card: "freeze", tick: 74 }] : []),
      ]);
      expect(s.king.hp).toBe(defend ? 300 : 300 - s.attacker.damage);
      expect(s.battle.winner).toBeNull();
      if (!defend) {
        expect(s.battle.players.red.hand).toContain("freeze");
        expect(s.battle.players.red.elixir).toBeGreaterThan(4);
      }
    },
  );

  it.each([
    { arrival: 1, deploy: 0, cancelled: false },
    { arrival: 3, deploy: 0, cancelled: true },
    { arrival: 3, deploy: 1, cancelled: false },
  ])(
    "includes building decay only after deployment ($arrival/$deploy)",
    ({ arrival, deploy, cancelled }) => {
      const s = setup();
      const building = s.blocker(
        201,
        { x: s.attacker.x + 2, y: s.attacker.y },
        "cannon",
      );
      building.deploy = deploy;
      const area = s.bolt(arrival);
      expect(s.forecast().baseline).toBe(cancelled ? Infinity : 6);
      s.step(6);
      expect(area.struck).toEqual([cancelled ? s.attacker.id : building.id]);
      expect(s.battle.winner).toBe(cancelled ? null : s.enemy);
    },
  );

  it("follows another body pulled out of Lightning before selecting the attacker", () => {
    const s = setup();
    s.battle.entities = s.battle.entities.filter(
      (e) => e.kind !== "tower" || e.king,
    );
    const point = { x: s.attacker.x, y: s.attacker.y + 3 };
    const blocker = s.blocker(600, { x: 13, y: point.y }, "giant");
    blocker.x = point.x + 3.5 + blocker.radius - 0.001;
    const area = s.bolt(3, point);
    const pull = { x: 14, y: s.king.y };
    const context = s.forecast();
    expect(context.baseline).toBe(6);
    expect(context.evaluate("tornado", pull)).toMatchObject({
      deathStep: Infinity,
      improves: true,
    });
    s.pull(pull);
    s.step(6);
    expect(area.struck).toEqual([s.attacker.id]);
    expect(blocker.hp).toBe(600);
    expect(s.king.hp).toBe(100);
  });

  it("rejects a pull that brings a blocker in to shield the fatal attacker", () => {
    const s = setup();
    const blocker = s.blocker(600, { x: 13, y: s.attacker.y }, "giant");
    blocker.x = s.attacker.x + 3.5 + blocker.radius + 0.01;
    const area = s.bolt();
    const context = s.forecast();
    expect(context.baseline).toBe(Infinity);
    expect(context.evaluate("tornado", s.king)).toMatchObject({
      deathStep: 6,
      worsens: true,
    });
    s.pull(s.king);
    s.step(6);
    expect(area.struck).toEqual([blocker.id]);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it("reuses counterfactuals without mutating paths, health or struck history", () => {
    const s = setup();
    s.blocker();
    s.bolt();
    const before = JSON.stringify(snapshot(s.battle));
    const context = s.forecast();
    const a = context.evaluate("tornado", s.king);
    context.evaluate("freeze", s.attacker);
    expect(context.evaluate("tornado", s.king)).toEqual(a);
    expect(JSON.stringify(snapshot(s.battle))).toBe(before);
  });
});
