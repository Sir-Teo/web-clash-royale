import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import {
  lightningDamageMap,
  createLightningPlan,
} from "../src/game/lightning-strikes";
import { pendingSpellDamage } from "../src/game/spell-targeting";
import { createKingSpellRace } from "../src/game/king-damage";

function setup() {
  const battle = new Battle({ seed: 1, ai: false });
  for (const e of battle.entities) e.active = false;
  const spawn = (card: CardId, hp: number, x = 4, y = 9) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: string, x: number, y: number) => void;
      }
    ).spawn(card, "blue", x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { hp, deploy: 0, active: false, speed: 0 });
    return body;
  };
  const cast = (point: Entity) => {
    battle.players.red.hand[0] = "lightning";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, point.x, point.y).ok).toBe(true);
    return battle.areas.at(-1)!;
  };
  const shoot = (body: Entity, at: number, damage = 1000) => {
    const shot: Projectile = {
      id: 900 + battle.projectiles.length,
      team: "red",
      source: 800,
      x: body.x,
      y: body.y,
      tx: body.x,
      ty: body.y,
      target: body.id,
      damage,
      remaining: at,
      duration: at,
      splash: 0,
      air: true,
      style: "musketeer",
      stun: 0,
    };
    battle.projectiles.push(shot);
  };
  const forecast = () =>
    lightningDamageMap(battle.entities, battle.areas, battle.projectiles);
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  return { battle, spawn, cast, shoot, forecast, step };
}

describe("Lightning known-health forecasts", () => {
  it("skips an enemy killed by a launched troop shot before the first pulse", () => {
    const { battle, spawn, cast, shoot, forecast, step } = setup();
    const giant = spawn("giant", 900),
      wizard = spawn("wizard", 600),
      witch = spawn("witch", 500),
      musketeer = spawn("musketeer", 400);
    const area = cast(giant);
    shoot(giant, 0.1);
    const packets = forecast();
    expect(packets.has(giant.id)).toBe(false);
    expect(
      [wizard, witch, musketeer].map((e) => packets.get(e.id)?.[0].step),
    ).toEqual([15, 29, 43]);
    expect(
      pendingSpellDamage(
        musketeer,
        "red",
        battle.projectiles,
        battle.areas,
        battle.entities,
      ),
    ).toBe(CARD_MAP.lightning.damage);
    step(43);
    expect(area.struck).toEqual([wizard.id, witch.id, musketeer.id]);
  });

  it("reorders a surviving body after nonlethal projectile damage", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const giant = spawn("giant", 900),
      wizard = spawn("wizard", 600),
      witch = spawn("witch", 500),
      musketeer = spawn("musketeer", 400);
    const area = cast(giant);
    shoot(giant, 0.1, 500);
    const packets = forecast();
    expect(
      [wizard, witch, giant].map((e) => packets.get(e.id)?.[0].step),
    ).toEqual([15, 29, 43]);
    expect(packets.has(musketeer.id)).toBe(false);
    step(43);
    expect(area.struck).toEqual([wizard.id, witch.id, giant.id]);
  });

  it("resolves the Lightning pulse before a projectile arriving on that same step", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const giant = spawn("giant", 900),
      wizard = spawn("wizard", 600),
      witch = spawn("witch", 500),
      musketeer = spawn("musketeer", 400);
    const area = cast(giant);
    shoot(giant, 0.5);
    expect(forecast().get(giant.id)?.[0].step).toBe(15);
    expect(forecast().has(musketeer.id)).toBe(false);
    step(43);
    expect(area.struck).toEqual([giant.id, wizard.id, witch.id]);
  });

  it("refreshes health between the first and second pulses", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const giant = spawn("giant", 900),
      wizard = spawn("wizard", 600),
      witch = spawn("witch", 500),
      musketeer = spawn("musketeer", 400);
    const area = cast(giant);
    shoot(wizard, 0.7);
    expect(forecast().has(wizard.id)).toBe(false);
    expect(forecast().get(musketeer.id)?.[0].step).toBe(43);
    step(43);
    expect(area.struck).toEqual([giant.id, witch.id, musketeer.id]);
  });

  it("keeps shield-only projectile damage out of the current-HP ranking", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const prince = spawn("dark-prince", 900),
      wizard = spawn("wizard", 800);
    prince.shield = 50;
    const area = cast(prince);
    shoot(prince, 0.1);
    expect(forecast().get(prince.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([prince.id, wizard.id]);
  });

  it("includes an applied Heal tick before the first pulse", () => {
    const { spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 200),
      witch = spawn("witch", 250);
    wizard.heal = { remaining: 1, elapsed: 0.4 };
    const area = cast(wizard);
    expect(forecast().get(wizard.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([wizard.id, witch.id]);
  });

  it("keeps a same-step Heal tick after Lightning selection", () => {
    const { spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 200),
      witch = spawn("witch", 250);
    wizard.heal = { remaining: 1, elapsed: 0 };
    const area = cast(wizard);
    expect(forecast().get(witch.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([witch.id, wizard.id]);
  });

  it("includes an applied Poison tick before selection", () => {
    const { spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 300),
      witch = spawn("witch", 250);
    wizard.poison = { remaining: 1, elapsed: 0.9 };
    const area = cast(wizard);
    expect(forecast().get(witch.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([witch.id, wizard.id]);
  });

  it("accounts for passive building HP decay", () => {
    const { spawn, cast, forecast, step } = setup();
    const cannon = spawn("cannon", 300),
      wizard = spawn("wizard", 295);
    const area = cast(cannon);
    expect(forecast().get(wizard.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([wizard.id, cannon.id]);
  });

  it("lets earlier overlapping Lightning damage redirect the next area", () => {
    const { spawn, cast, forecast, step } = setup();
    const a = spawn("giant", 900),
      b = spawn("wizard", 800),
      c = spawn("witch", 700),
      d = spawn("musketeer", 600);
    const first = cast(a),
      second = cast(a);
    const packets = forecast();
    expect([a, b, c, d].map((e) => packets.get(e.id)?.[0].step)).toEqual([
      15, 15, 29, 29,
    ]);
    step(29);
    expect(first.struck).toEqual([a.id, c.id]);
    expect(second.struck).toEqual([b.id, d.id]);
  });

  it("preserves full shield absorption between overlapping areas", () => {
    const { spawn, cast, forecast, step } = setup();
    const a = spawn("dark-prince", 900),
      b = spawn("wizard", 800),
      c = spawn("witch", 700);
    a.shield = 50;
    const first = cast(a),
      second = cast(a);
    expect(
      forecast()
        .get(a.id)
        ?.map((p) => p.step),
    ).toEqual([15, 15]);
    step(29);
    expect(first.struck).toEqual([a.id, b.id]);
    expect(second.struck).toEqual([a.id, c.id]);
  });

  it("retains elapsed area clocks and struck history while projecting later health", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const a = spawn("giant", 900),
      b = spawn("wizard", 800),
      c = spawn("witch", 700),
      d = spawn("musketeer", 600);
    const area = cast(a);
    step(15);
    shoot(b, 0.1);
    expect(forecast().get(c.id)?.[0].step).toBe(14);
    expect(forecast().get(d.id)?.[0].step).toBe(28);
    step(28);
    expect(area.struck).toEqual([a.id, c.id, d.id]);
  });

  it("recognizes a King finisher after launched shots remove the three blockers", () => {
    const { battle, spawn, shoot, step } = setup();
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 400;
    for (let i = 0; i < 3; i++) shoot(spawn("giant", 900, king.x, king.y), 0.1);
    const race = createKingSpellRace(
      "lightning",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.stepAt(king)).toBe(15);
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 6;
    (battle as unknown as { think: () => void }).think();
    expect(battle.actions.at(-1)?.card).toBe("lightning");
    step(15);
    expect(battle.winner).toBe("red");
  });

  it("does not let healing revive a body killed before the pulse", () => {
    const { spawn, cast, shoot, forecast, step } = setup();
    const wizard = spawn("wizard", 200),
      witch = spawn("witch", 250);
    wizard.heal = { remaining: 1, elapsed: 0.4 };
    const area = cast(wizard);
    shoot(wizard, 1 / 30);
    expect(forecast().has(wizard.id)).toBe(false);
    step(29);
    expect(area.struck).toEqual([witch.id]);
  });

  it("caps projected healing at maximum HP", () => {
    const { spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 200),
      witch = spawn("witch", 610);
    wizard.hp = wizard.maxHp - 10;
    witch.hp = wizard.maxHp + 10;
    wizard.heal = { remaining: 1, elapsed: 0.4 };
    const area = cast(wizard);
    expect(forecast().get(witch.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([witch.id, wizard.id]);
  });

  it("refreshes Heal from an active friendly area before a pending pulse", () => {
    const { battle, spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 200),
      witch = spawn("witch", 250);
    wizard.heal = { remaining: 0.05, elapsed: 0.1 };
    const area = cast(wizard);
    Object.assign(area, { remaining: 1, hitAt: 0.92, struck: [999] });
    battle.areas.push({
      id: 901,
      card: "heal",
      team: "blue",
      x: 4,
      y: 9,
      radius: 3,
      duration: 3.05,
      remaining: 3.05,
      hitAt: 0,
    });
    expect(forecast().get(wizard.id)?.[0].step).toBe(14);
    step(28);
    expect(area.struck).toEqual([999, wizard.id, witch.id]);
  });

  it("refreshes Poison from an active area before a pending pulse", () => {
    const { battle, spawn, cast, forecast, step } = setup();
    const wizard = spawn("wizard", 300),
      witch = spawn("witch", 250);
    wizard.poison = { remaining: 0.05, elapsed: 0.8 };
    const area = cast(wizard);
    Object.assign(area, { remaining: 1, hitAt: 0.92, struck: [999] });
    battle.areas.push({
      id: 901,
      card: "poison",
      team: "red",
      x: 4,
      y: 9,
      radius: 3.5,
      duration: 8,
      remaining: 8,
      hitAt: 0,
    });
    expect(forecast().get(witch.id)?.[0].step).toBe(14);
    step(28);
    expect(area.struck).toEqual([999, witch.id, wizard.id]);
  });

  it("waits for building deployment before starting passive decay", () => {
    const { spawn, cast, forecast, step } = setup();
    const cannon = spawn("cannon", 300),
      wizard = spawn("wizard", 295);
    cannon.deploy = 1;
    const area = cast(cannon);
    expect(forecast().get(cannon.id)?.[0].step).toBe(15);
    step(29);
    expect(area.struck).toEqual([cannon.id, wizard.id]);
  });

  it("recomputes an existing King's pulse for a proposed overlapping cast", () => {
    const { battle, spawn, cast, step } = setup();
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 400;
    spawn("giant", 900, king.x, king.y);
    spawn("giant", 600, king.x, king.y);
    cast(king);
    const race = createKingSpellRace(
      "lightning",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.baseline).toBe(43);
    expect(race.stepAt(king)).toBe(29);
    cast(king);
    step(29);
    expect(battle.winner).toBe("red");
  });

  it("does not count the existing Lightning twice when judging a match-ending cast", () => {
    const { battle, cast, shoot, step } = setup();
    battle.tick = 6000;
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    const own = battle.entities.find((e) => e.team === "red" && e.king)!;
    king.hp = 1500;
    own.hp = 100;
    cast(king);
    shoot(own, 0.8, 500);
    battle.projectiles.at(-1)!.team = "blue";
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 6;
    const count = battle.actions.length;
    (battle as unknown as { think: () => void }).think();
    expect(battle.actions).toHaveLength(count);
    cast(king);
    step(24);
    expect(battle.winner).toBe("blue");
    expect(king.hp).toBeCloseTo(1500 - 2 * 552);
  });

  it("retains incoming enemy Lightning when replacing friendly cast forecasts", () => {
    const { battle, spawn, cast, step } = setup();
    battle.tick = 6000;
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    const own = battle.entities.find((e) => e.team === "red" && e.king)!;
    king.hp = 400;
    own.hp = 100;
    spawn("giant", 900, king.x, king.y);
    spawn("giant", 600, king.x, king.y);
    cast(king);
    battle.players.blue.hand[0] = "lightning";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, own.x, own.y).ok).toBe(true);
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 6;
    const count = battle.actions.length;
    (battle as unknown as { think: () => void }).think();
    expect(battle.actions).toHaveLength(count);
    cast(king);
    step(15);
    expect(battle.winner).toBe("blue");
    expect(king.hp).toBe(400);
  });

  it("can accelerate an existing King strike from outside the new cast's circle", () => {
    const { battle, spawn, cast, step } = setup();
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 400;
    battle.entities = battle.entities.filter(
      (e) => !(e.team === "blue" && e.kind === "tower" && !e.king),
    );
    battle.players.red.crowns = 2;
    spawn("giant", 900, 7, 26.5);
    spawn("giant", 600, 7, 26.5);
    cast(king);
    const point = { x: 3.5, y: 25 };
    const race = createKingSpellRace(
      "lightning",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.baseline).toBe(43);
    expect(race.stepAt(point)).toBe(29);
    battle.players.red.hand[0] = "lightning";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, point.x, point.y).ok).toBe(true);
    step(29);
    expect(battle.winner).toBe("red");
  });

  it("keeps repeated equivalent projections read-only", () => {
    const { battle, spawn, cast, shoot } = setup();
    const wizard = spawn("wizard", 300),
      witch = spawn("witch", 250);
    wizard.heal = { remaining: 1, elapsed: 0.4 };
    cast(wizard);
    shoot(witch, 0.7, 200);
    const before = JSON.stringify(battle);
    const plan = createLightningPlan(
      "red",
      battle.entities,
      undefined,
      battle.projectiles,
      battle.areas,
    );
    const first = plan
      .project(wizard)
      .strikes.map((s) => [s.entity.id, s.step]);
    expect(
      plan.project({ x: 4.1, y: 9 }).strikes.map((s) => [s.entity.id, s.step]),
    ).toEqual(first);
    expect(
      plan.project(wizard).strikes.map((s) => [s.entity.id, s.step]),
    ).toEqual(first);
    expect(JSON.stringify(battle)).toBe(before);
  });
});
