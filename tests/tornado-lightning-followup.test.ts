import { describe, expect, it } from "vitest";
import { Battle, type Point, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { createKingSpellRace } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";
import { pendingSpellDamage } from "../src/game/spell-reservations";

function setup(team: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const king = battle.entities.find((e) => e.king && e.team === enemy)!;
  king.hp = 300;
  const spawn = (card: CardId, x: number, y = king.y, hp = 400) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, enemy, x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { hp, deploy: 0, active: false });
    return body;
  };
  const cloud = {
    id: 900,
    card: "lightning" as const,
    team,
    x: king.x,
    y: king.y,
    radius: 3.5,
    duration: 1.5,
    remaining: 0.5,
    hitAt: 1.38,
    struck: [998, 999],
  };
  battle.areas.push(cloud);
  const forecast = () =>
    createMatchFinisher(
      team,
      battle.entities,
      battle.projectiles,
      battle.areas,
      { blue: 0, red: 0 },
      100,
      false,
    );
  const target = (cost = 3) =>
    areaSpellTarget(
      "tornado",
      team,
      battle.entities,
      battle.areas,
      battle.projectiles,
      cost,
      Infinity,
      forecast(),
    );
  const cast = (point: Point) => {
    battle.players[team].hand[0] = "tornado";
    battle.players[team].elixir = 10;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  return { battle, king, team, cloud, spawn, forecast, target, cast, step };
}

describe("Tornado changes friendly Lightning finishers", () => {
  for (const team of ["red", "blue"] as const) {
    it(`pulls a reserved blocker out for a last-pulse King win (${team})`, () => {
      const s = setup(team);
      const giant = s.spawn("giant", 13);
      expect(
        pendingSpellDamage(giant, team, [], s.battle.areas, s.battle.entities),
      ).toBeGreaterThan(giant.hp);
      expect(s.forecast().baseline).toBeUndefined();
      const race = createKingSpellRace(
        "tornado",
        team,
        s.king,
        [],
        s.battle.areas,
        s.battle.entities,
      );
      expect(race.baseline).toBe(Infinity);
      expect(race.stepAt({ x: 17, y: s.king.y })).toBe(13);
      const before = JSON.stringify(s.battle);
      const point = s.target()!;
      expect(point.matchDecisionStep).toBe(13);
      expect(point.x).toBeGreaterThan(giant.x);
      expect(point.value).toBe(0);
      expect(s.target()).toEqual(point);
      expect(JSON.stringify(s.battle)).toBe(before);
      s.cast(point);
      s.step(12);
      expect(s.battle.winner).toBeNull();
      s.step(1);
      expect(s.battle.winner).toBe(team);
      expect(giant.hp).toBe(400);
    });

    it(`preserves the known King win when ordinary damage would pull a blocker in (${team})`, () => {
      const s = setup(team);
      const dy = team === "red" ? 1 : -1;
      s.spawn("wizard", 12.2, s.king.y - 2 * dy, 100);
      s.spawn("witch", 12.2, s.king.y + 1.8 * dy, 100);
      s.spawn("musketeer", 11, s.king.y, 100);
      s.spawn("giant", 13.4);
      const forecast = s.forecast();
      expect(forecast.baseline).toEqual({ winner: team, step: 13 });
      expect(
        forecast.outcomeAt("tornado", { x: 12.2, y: s.king.y - 2 * dy }),
      ).toBeUndefined();
      const point = s.target()!;
      expect(point.value).toBeGreaterThan(3);
      expect(forecast.outcomeAt("tornado", point)).toEqual(forecast.baseline);
      s.cast(point);
      s.step(13);
      expect(s.battle.winner).toBe(team);
    });

    it(`keeps the proposed pull after an existing same-frame Lightning pulse (${team})`, () => {
      const s = setup(team);
      const giant = s.spawn("giant", 13.249);
      Object.assign(s.cloud, { remaining: 0.1, hitAt: 1.4 });
      const point = { x: 17, y: s.king.y };
      expect(s.forecast().outcomeAt("tornado", point)).toBeUndefined();
      s.cast(point);
      s.step(1);
      expect(giant.hp).toBe(0);
      expect(s.king.hp).toBe(300);
      expect(s.battle.winner).toBeNull();
    });

    it(`includes Tornado damage lowering a surviving blocker before the third pulse (${team})`, () => {
      const s = setup(team);
      const giant = s.spawn("giant", 13, s.king.y, 390);
      s.spawn("knight", 8, s.king.y, 900);
      s.spawn("knight", 10, s.king.y, 800);
      Object.assign(s.cloud, { remaining: 1.5, hitAt: 0.46, struck: [] });
      expect(s.forecast().baseline).toBeUndefined();
      expect(s.forecast().outcomeAt("tornado", giant)).toEqual({
        winner: team,
        step: 43,
      });
      s.cast(giant);
      s.step(42);
      expect(s.king.hp).toBe(300);
      expect(giant.hp).toBe(296);
      s.step(1);
      expect(s.battle.winner).toBe(team);
      expect(giant.hp).toBe(296);
    });
  }

  it("skips the match search when remaining Lightning cannot finish a healthy tower", () => {
    const s = setup();
    s.king.hp = s.king.maxHp;
    s.spawn("giant", 13, s.king.y, 400);
    expect(s.forecast().canFinishWithLightning).toBe(false);
    expect(s.target()).toBeUndefined();
  });

  it("keeps a finisher enabled when a released shot supplies the missing tower damage", () => {
    const s = setup();
    s.king.hp = 600;
    s.spawn("giant", 13, s.king.y, 1000);
    s.battle.projectiles.push({
      id: 901,
      team: s.team,
      source: s.battle.entities.find((e) => e.team === s.team && e.king)!.id,
      x: s.king.x,
      y: s.king.y,
      tx: s.king.x,
      ty: s.king.y,
      target: s.king.id,
      damage: 100,
      duration: 0.01,
      remaining: 0.01,
      splash: 0,
      air: true,
      style: "cannonball",
      stun: 0,
    });
    expect(s.forecast().canFinishWithLightning).toBe(true);
    expect(s.forecast().baseline).toBeUndefined();
    const point = s.target()!;
    expect(point.matchDecisionStep).toBe(13);
    s.cast(point);
    s.step(13);
    expect(s.battle.winner).toBe(s.team);
  });

  it("includes all remaining clouds in the cheap tower-damage bound", () => {
    const s = setup();
    s.king.hp = 900;
    s.spawn("giant", 13, s.king.y, 1200);
    s.battle.areas.push({ ...s.cloud, id: 901, struck: [...s.cloud.struck] });
    expect(s.forecast().baseline).toBeUndefined();
    expect(s.forecast().canFinishWithLightning).toBe(true);
    const point = s.target()!;
    expect(point.matchDecisionStep).toBe(13);
    s.cast(point);
    s.step(13);
    expect(s.battle.winner).toBe(s.team);
  });

  it("retains a nonlethal Lightning pull that wins the final clock", () => {
    const s = setup();
    s.king.hp = s.king.maxHp;
    const tower = s.battle.entities.find(
      (e) => e.team === "blue" && e.kind === "tower" && !e.king,
    )!;
    tower.hp = 2000;
    s.battle.entities.find(
      (e) => e.team === "red" && e.kind === "tower" && !e.king,
    )!.hp = 1900;
    s.spawn("giant", tower.x + 4, tower.y, 2500);
    Object.assign(s.cloud, { x: tower.x, y: tower.y });
    s.battle.tick = 8985;
    const finisher = createMatchFinisher(
      s.team,
      s.battle.entities,
      [],
      s.battle.areas,
      { blue: 0, red: 0 },
      0.5,
      true,
    );
    expect(finisher.baseline).toEqual({ winner: "blue", step: 15 });
    expect(finisher.canFinishWithLightning).toBe(true);
    const point = areaSpellTarget(
      "tornado",
      s.team,
      s.battle.entities,
      s.battle.areas,
      [],
      3,
      Infinity,
      finisher,
    )!;
    expect(point.matchDecisionStep).toBe(15);
    expect(finisher.outcomeAt("tornado", point)).toEqual({
      winner: "red",
      step: 15,
    });
    s.cast(point);
    s.step(15);
    expect(s.battle.winner).toBe("red");
    expect(tower.hp).toBe(1448);
    expect(s.battle.reason).toBe("Tiebreaker");
  });

  it("uses the actual Mirror cost for the same winning pull", () => {
    const s = setup();
    s.spawn("giant", 13);
    const normal = s.target(3)!,
      mirrored = s.target(4)!;
    expect(mirrored.matchDecisionStep).toBe(normal.matchDecisionStep);
    expect(mirrored.score).toBe(normal.score - 1);
  });

  it("keeps a lone inactive Giant below the ordinary threshold without Lightning", () => {
    const s = setup();
    s.spawn("giant", 13);
    s.battle.areas = [];
    expect(s.target()).toBeUndefined();
  });

  it.each([false, true])(
    "combines genuine casts on the ordinary timer (preserve=%s)",
    (preserve) => {
      const b = new Battle({ seed: 12, ai: true });
      for (const e of b.entities) e.active = false;
      const king = b.entities.find((e) => e.team === "blue" && e.king)!;
      king.hp = 300;
      if (preserve)
        for (const [card, x, y] of [
          ["wizard", 12.2, 27.5],
          ["witch", 12.2, 31.3],
          ["musketeer", 11, 29.5],
        ] as const) {
          (
            b as unknown as {
              spawn: (card: CardId, team: Team, x: number, y: number) => void;
            }
          ).spawn(card, "blue", x, y);
          Object.assign(b.entities.at(-1)!, {
            hp: 100,
            active: false,
            deploy: 0,
          });
        }
      for (const [card, x, hp] of [
        ["knight", 8, 900],
        ["knight", 10, 800],
        ["giant", preserve ? 13.4 : 13, 400],
      ] as const) {
        (
          b as unknown as {
            spawn: (card: CardId, team: Team, x: number, y: number) => void;
          }
        ).spawn(card, "blue", x, king.y);
        Object.assign(b.entities.at(-1)!, { hp, active: false, deploy: 0 });
      }
      while (b.tick < 46) b.step();
      b.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
      b.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      b.players.red.elixir = 10;
      expect(b.play("red", 0, king.x, king.y).ok).toBe(true);
      b.players.red.hand = ["tornado", "pekka", "pekka", "pekka"];
      while (b.tick < 100 && !b.winner) b.step();
      expect(
        b.actions.filter((a) => a.team === "red").map((a) => [a.card, a.tick]),
      ).toEqual([
        ["lightning", 46],
        ["tornado", 74],
      ]);
      expect(b.winner).toBe("red");
      expect(b.tick).toBe(89);
    },
  );
});
