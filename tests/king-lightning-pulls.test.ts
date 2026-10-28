import { describe, expect, it } from "vitest";
import { Battle, type AreaEffect, type Team } from "../src/game/engine";
import { type CardId, CARD_MAP } from "../src/game/cards";
import { createKingDefense } from "../src/game/king-defense";
import { launchedKingDeadline } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";

function setup(team: Team = "red", inward = false) {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 600;
  const spawn = (card: CardId, side: Team, x: number, y: number) => {
    (
      battle as unknown as {
        spawn: (c: CardId, t: Team, x: number, y: number) => void;
      }
    ).spawn(card, side, x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { deploy: 0, active: false, cooldown: 100 });
    return body;
  };
  const giant = spawn("giant", team, 13, king.y);
  giant.x = king.x + 3.5 + giant.radius + (inward ? 0.15 : -0.001);
  giant.hp = 400;
  const attacker = spawn(
    "lumberjack",
    enemy,
    king.x,
    king.y + (team === "red" ? 2 : -2),
  );
  Object.assign(attacker, {
    hp: 200,
    active: true,
    target: king.id,
    pendingAttack: { target: king.id, remaining: 0.2, damage: 242 },
  });
  const lightning: AreaEffect = {
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
  };
  const tornado: AreaEffect = {
    id: 901,
    card: "tornado",
    team: enemy,
    x: inward ? king.x : 17,
    y: king.y,
    radius: 5.5,
    duration: 3.05,
    remaining: 3.05,
    hitAt: 0,
  };
  battle.areas = [lightning, tornado];
  const forecast = () =>
    createKingDefense(team, battle.entities, battle.projectiles, battle.areas);
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  const freeze = () => {
    battle.players[team].hand = ["freeze", "pekka", "pekka", "pekka"];
    battle.players[team].elixir = 4;
    expect(battle.play(team, 0, attacker.x, attacker.y).ok).toBe(true);
  };
  return {
    battle,
    king,
    giant,
    attacker,
    lightning,
    tornado,
    forecast,
    step,
    freeze,
    enemy,
  };
}

describe("King Lightning targets follow current pulls", () => {
  it.each([false, true])(
    "incoming deadlines and friendly-tower endings follow pulls (%s)",
    (inward) => {
      const s = setup("red", inward);
      s.king.hp = 300;
      s.attacker.pendingAttack = undefined;
      s.attacker.active = false;
      const before = JSON.stringify(s.battle);
      expect(
        launchedKingDeadline(
          "red",
          s.battle.entities,
          s.battle.projectiles,
          s.battle.areas,
        ),
      ).toBe(inward ? Infinity : 13);
      const finisher = createMatchFinisher(
        "red",
        s.battle.entities,
        s.battle.projectiles,
        s.battle.areas,
        { blue: 0, red: 0 },
        100,
        false,
      );
      const ending = finisher.baseline;
      expect(ending).toEqual(inward ? undefined : { winner: "blue", step: 13 });
      expect(finisher.evaluate("zap", { x: 1, y: 16 }, 2, 0)).toBeUndefined();
      expect(
        finisher.evaluate("lightning", { x: 1, y: 16 }, 6, 0),
      ).toBeUndefined();
      expect(JSON.stringify(s.battle)).toBe(before);
      s.step(13);
      expect(s.lightning.struck).toEqual([inward ? s.giant.id : s.king.id]);
      expect(s.battle.winner).toBe(inward ? null : s.enemy);
    },
  );

  it.each(["red", "blue"] as const)(
    "predicts a blocker leaving before the fatal last pulse (%s)",
    (team) => {
      const s = setup(team);
      expect(s.forecast().baseline).toBe(13);
      s.step(12);
      expect(s.king.hp).toBe(358);
      expect(s.battle.winner).toBeNull();
      s.step(1);
      expect(s.lightning.struck).toEqual([s.king.id]);
      expect(s.battle.winner).toBe(s.enemy);
    },
  );

  it.each(["red", "blue"] as const)(
    "defends the swing when Lightning alone leaves the King alive (%s)",
    (team) => {
      const s = setup(team);
      expect(s.forecast().evaluate("freeze", s.attacker)).toMatchObject({
        baseline: 13,
        deathStep: Infinity,
        improves: true,
      });
      s.freeze();
      s.step(13);
      expect(s.lightning.struck).toEqual([s.king.id]);
      expect(s.king.hp).toBeCloseTo(600 - 552);
      expect(s.battle.winner).toBeNull();
    },
  );

  it("includes a blocker pulled into the circle before the final pulse", () => {
    const s = setup("red", true);
    expect(s.forecast().baseline).toBe(Infinity);
    s.step(13);
    expect(s.lightning.struck).toEqual([s.giant.id]);
    expect(s.king.hp).toBe(358);
    expect(s.battle.winner).toBeNull();
  });

  it.each([true, false])(
    "preserves pull/Lightning order on the pulse frame (%s)",
    (pullFirst) => {
      const s = setup();
      s.king.hp = 300;
      s.giant.hp = 600;
      Object.assign(s.lightning, { remaining: 0.1, hitAt: 1.38 });
      s.battle.areas = pullFirst
        ? [s.tornado, s.lightning]
        : [s.lightning, s.tornado];
      expect(s.forecast().baseline).toBe(pullFirst ? 1 : Infinity);
      s.step(6);
      expect(s.lightning.struck).toEqual([pullFirst ? s.king.id : s.giant.id]);
      expect(s.battle.winner).toBe(pullFirst ? s.enemy : null);
    },
  );

  it.each([true, false])(
    "includes Tornado damage at its own area phase (%s)",
    (pullFirst) => {
      const s = setup();
      s.king.hp = 300;
      Object.assign(s.giant, { hp: 320, x: s.king.x + 2 });
      Object.assign(s.tornado, { x: s.giant.x, hitAt: 100, damageAt: 0 });
      Object.assign(s.lightning, { remaining: 0.1, hitAt: 1.38 });
      s.battle.areas = pullFirst
        ? [s.tornado, s.lightning]
        : [s.lightning, s.tornado];
      expect(s.forecast().baseline).toBe(pullFirst ? 1 : Infinity);
      s.step(6);
      expect(s.lightning.struck).toEqual([pullFirst ? s.king.id : s.giant.id]);
      expect(s.battle.winner).toBe(pullFirst ? s.enemy : null);
    },
  );

  it("still predicts the moving blocker when no current King attack exists", () => {
    const s = setup();
    s.king.hp = 300;
    s.attacker.pendingAttack = undefined;
    s.attacker.active = false;
    expect(s.forecast().baseline).toBe(13);
    s.step(13);
    expect(s.battle.winner).toBe(s.enemy);
  });

  it.each([
    { inward: false, race: false },
    { inward: false, race: true },
    { inward: true, race: false },
  ])(
    "the natural AI timer follows genuine pulls ($inward/$race)",
    ({ inward, race }) => {
      const battle = new Battle({ seed: 12, ai: true });
      for (const e of battle.entities) e.active = false;
      const king = battle.entities.find((e) => e.team === "red" && e.king)!;
      Object.assign(king, { hp: 600, active: true, cooldown: 3 });
      if (race)
        battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      for (const [card, side, x, hp, deploy, active] of [
        ["knight", "red", 8, 900, 0, false],
        ["knight", "red", 10, 800, 0, false],
        ["giant", "red", 13.25 + (inward ? 0.3 : -0.3), 400, 0, false],
        ["lumberjack", "blue", 9, 200, 2.3, true],
      ] as const) {
        (
          battle as unknown as {
            spawn: (c: CardId, t: Team, x: number, y: number) => void;
          }
        ).spawn(card, side, x, king.y + (side === "blue" ? 2 : 0));
        Object.assign(battle.entities.at(-1)!, {
          hp,
          deploy,
          active,
          cooldown: 0,
        });
      }
      battle.players.red.hand = race
        ? ["rocket", "freeze", "pekka", "pekka"]
        : ["freeze", "pekka", "pekka", "pekka"];
      battle.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = race ? 6 : 4;
      for (let i = 0; i < 90 && !battle.winner; i++) {
        if (battle.tick === 46 || battle.tick === 73) {
          const card = battle.tick === 46 ? "lightning" : "tornado";
          battle.players.blue.hand[0] = card;
          battle.players.blue.elixir = 10;
          expect(
            battle.play(
              "blue",
              0,
              card === "tornado" && !inward ? 17 : king.x,
              king.y,
            ).ok,
          ).toBe(true);
        }
        battle.step();
      }
      expect(
        battle.actions
          .filter((a) => a.team === "red")
          .map((a) => ({ card: a.card, tick: a.tick })),
      ).toEqual(inward ? [] : [{ card: "freeze", tick: 74 }]);
      expect(king.hp).toBeCloseTo(
        inward ? 358 : 600 - 552,
      );
      expect(battle.winner).toBeNull();
    },
  );
});
