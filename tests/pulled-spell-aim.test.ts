import { describe, expect, it } from "vitest";
import { Battle, type Point, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { damageSpellTarget } from "../src/game/spell-targeting";
import { createSpellPullPaths } from "../src/game/spell-pull-paths";

function setup(team: Team = "red", group = true) {
  const battle = new Battle({ seed: 12, ai: false });
  battle.entities.forEach((e) => (e.active = false));
  const bodies = (group ? [19, 20, 21] : [20]).map((y) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(
      "wizard",
      team === "red" ? "blue" : "red",
      5,
      team === "blue" ? 32 - y : y,
    );
    const body = battle.entities.at(-1)!;
    Object.assign(body, { hp: 500, deploy: 0, active: false });
    return body;
  });
  const cast = (card: CardId, point: Point, side = team) => {
    battle.players[side].hand[0] = card;
    battle.players[side].elixir = 10;
    expect(battle.play(side, 0, point.x, point.y).ok).toBe(true);
  };
  const aim = (card: CardId) =>
    damageSpellTarget(
      card,
      team,
      battle.entities,
      battle.projectiles,
      battle.areas,
    );
  const finish = (card: CardId) => {
    let ticks = 0;
    while (battle.projectiles.some((p) => p.style === card) && ticks++ < 180)
      battle.step();
  };
  return {
    battle,
    bodies,
    cast,
    aim,
    finish,
    center: { x: 10, y: team === "blue" ? 12 : 20 },
  };
}

describe("direct spells lead current Tornado pulls", () => {
  for (const team of ["red", "blue"] as const) {
    for (const card of ["fireball", "rocket"] as const) {
      it(`hits the whole pulled group where the original center misses (${card}, ${team})`, () => {
        const s = setup(team),
          control = setup(team);
        for (const b of [s, control]) b.cast("tornado", b.center);
        const point = s.aim(card)!;
        expect(point.x).toBeGreaterThan(5);
        expect(point.value).toBe(15);
        control.cast(card, control.bodies[0]);
        s.cast(card, point);
        control.finish(card);
        s.finish(card);
        expect(control.bodies.some((e) => e.hp > 0)).toBe(true);
        expect(s.bodies.every((e) => e.hp === 0)).toBe(true);
      });
    }
    for (const card of ["zap", "arrows"] as const) {
      it(`retains the real pulled group contacts (${card}, ${team})`, () => {
        const s = setup(team),
          control = setup(team);
        for (const b of [s, control]) b.cast("tornado", b.center);
        const point = s.aim(card)!;
        expect(point).toBeDefined();
        s.cast(card, point);
        s.finish(card);
        for (let i = 0; i < s.battle.tick; i++) control.battle.step();
        for (let i = 0; i < s.bodies.length; i++)
          expect(s.bodies[i].hp).toBe(
            Math.max(0, control.bodies[i].hp - CARD_MAP[card].damage),
          );
      });
    }
    it(`retains a legal Rocket aim at the far arena corner (${team})`, () => {
      const s = setup(team, false);
      const point = team === "red" ? { x: 0.5, y: 31.3 } : { x: 17.5, y: 0.7 };
      Object.assign(
        s.bodies[0],
        team === "red" ? { x: 5, y: 29.5 } : { x: 13, y: 2.5 },
      );
      s.cast("tornado", point);
      const aim = s.aim("rocket")!;
      expect(aim.x).toBeCloseTo(point.x, 8);
      expect(aim.y).toBeCloseTo(point.y, 8);
      s.cast("rocket", aim);
      s.finish("rocket");
      expect(s.battle.tick).toBeGreaterThan(120);
      expect(s.bodies[0].hp).toBe(0);
    });
  }

  it.each([false, true])(
    "shared paths preserve competing pull order through Freeze and Rage (reverse=%s)",
    (reverse) => {
      const s = setup("red", false),
        body = s.bodies[0];
      for (const x of reverse ? [15, 10] : [10, 15])
        s.cast("tornado", { x, y: 20 });
      s.cast("freeze", body);
      s.cast("rage", body, "blue");
      const before = JSON.stringify(s.battle);
      const paths = createSpellPullPaths(s.battle.areas, 60)!;
      const path = paths(body)!;
      expect(paths(body)).toBe(path);
      expect(JSON.stringify(s.battle)).toBe(before);
      for (let i = 0; i < 60; i++) {
        s.battle.step();
        expect(body.x).toBeCloseTo(path[i].x, 10);
        expect(body.y).toBeCloseTo(path[i].y, 10);
      }
    },
  );

  it("keeps stationary targeting and planning inputs unchanged", () => {
    const s = setup();
    expect(s.aim("rocket")).toMatchObject({ x: 5, y: 19, value: 15 });
    s.cast("tornado", { x: 10, y: 20 }, "blue");
    expect(s.aim("rocket")).toMatchObject({ x: 5, y: 19, value: 15 });
    s.cast("tornado", { x: 10, y: 20 });
    const before = JSON.stringify(s.battle),
      point = s.aim("rocket");
    expect(s.aim("rocket")).toEqual(point);
    expect(JSON.stringify(s.battle)).toBe(before);
  });

  it.each(["fireball", "rocket"] as const)(
    "leads a genuine Tornado on the ordinary AI timer (%s)",
    (card) => {
      const b = new Battle({ seed: 12, ai: true });
      b.entities.forEach((e) => (e.active = false));
      for (const y of [19, 20, 21]) {
        (
          b as unknown as {
            spawn: (card: CardId, team: Team, x: number, y: number) => void;
          }
        ).spawn("wizard", "blue", 5, y);
        Object.assign(b.entities.at(-1)!, {
          hp: 500,
          active: false,
          deploy: 0,
        });
      }
      while (b.tick < 73) b.step();
      b.players.red.hand[0] = "tornado";
      b.players.red.elixir = 10;
      expect(b.play("red", 0, 10, 20).ok).toBe(true);
      b.players.red.hand = [card, "pekka", "pekka", "pekka"];
      b.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      b.players.red.elixir = CARD_MAP[card].cost;
      while (b.tick < 180) b.step();
      const actions = b.actions.filter((a) => a.team === "red");
      expect(actions.map((a) => [a.card, a.tick])).toEqual([
        ["tornado", 73],
        [card, 74],
      ]);
      expect(actions[1].x).toBeGreaterThan(8);
      expect(b.entities.filter((e) => e.card === "wizard")).toHaveLength(0);
    },
  );
});
