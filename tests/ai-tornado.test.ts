import { attackReach } from "../src/game/attack-range";
import { describe, expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { areaSpellTarget, isAreaSpell } from "../src/game/area-spell-targeting";
import { tornadoEscapeStep } from "../src/game/tornado-pull";
import { perspective, snapshot } from "../src/network/perspective";
import golden from "./fixtures/tornado-pull-golden.json";

function setup(team: Team = "red", version?: Replay["version"]) {
  const initial = new Battle({ seed: 12, ai: false });
  const battle = version === undefined ? initial : new Battle({ replay: { ...initial.exportReplay(), version } });
  if (version !== undefined) Object.assign(battle, { replayActions: null, replayDuration: undefined });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 100;
  const spawn = (card: CardId, x: number, y: number, side: Team = enemy) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, side, x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { deploy: 0, active: false });
    return body;
  };
  const attacker = spawn(
    "lumberjack",
    king.x,
    king.y + (team === "red" ? 2 : -2),
  );
  Object.assign(attacker, {
    active: true,
    target: king.id,
    pendingAttack: { target: king.id, remaining: 0.2, damage: attacker.damage },
  });
  battle.players[team].hand = ["tornado", "pekka", "pekka", "pekka"];
  battle.players[team].elixir = 3;
  const target = () =>
    areaSpellTarget(
      "tornado",
      team,
      battle.entities,
      battle.areas,
      battle.projectiles,
    );
  return { battle, king, attacker, spawn, target };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, count: number) => {
  for (let i = 0; i < count && !b.winner; i++) b.step();
};

describe("AI Tornado control", () => {
  it("recognizes Tornado as a planned area spell", () =>
    expect(isAreaSpell("tornado")).toBe(true));

  it("pulls a fatal attacker away and keeps the King alive", () => {
    const { battle, king, target } = setup();
    const point = target()!;
    expect(point.protectsKing).toBe(true);
    expect(point.y).toBeGreaterThan(king.y + 2);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("tornado");
    step(battle, 90);
    expect(king.hp).toBe(100);
    expect(battle.winner).toBeNull();
  });

  it("reproduces the loss without that displacement", () => {
    const { battle, king } = setup();
    step(battle, 6);
    expect(king.hp).toBe(0);
    expect(battle.winner).toBe("blue");
  });

  it("does not call an attacker-centered cast a rescue", () => {
    const { battle, king, attacker } = setup();
    expect(
      tornadoEscapeStep(attacker, king, battle.areas, attacker),
    ).toBeUndefined();
    battle.play("red", 0, attacker.x, attacker.y);
    step(battle, 6);
    expect(battle.winner).toBe("blue");
  });

  it.each([
    { name: "ordinary", remaining: 0.2 },
    { name: "Rage", remaining: 0.2, rage: 2 },
    { name: "slow", remaining: 0.1, slow: 2 },
    { name: "expired Rage", remaining: 0.15, rage: 1 / 30 },
    { name: "expired slow", remaining: 0.1, slow: 1 / 30 },
  ])("matches actual cancellation under $name", ({ remaining, rage, slow }) => {
    const { battle, king, attacker } = setup();
    attacker.pendingAttack!.remaining = remaining;
    if (rage) attacker.rage = { remaining: rage };
    if (slow) attacker.slow = { remaining: slow };
    const point = { x: king.x, y: king.y + 6.5 };
    const expected = tornadoEscapeStep(attacker, king, battle.areas, point);
    battle.play("red", 0, point.x, point.y);
    let actual: number | undefined;
    for (let i = 1; i <= 30; i++) {
      battle.step();
      if (!attacker.pendingAttack || king.hp <= 0) {
        if (king.hp > 0) actual = i;
        break;
      }
    }
    expect(actual).toBe(expected);
  });

  it("accounts for a covering Rage area's clock before release", () => {
    const { battle, king, attacker } = setup();
    battle.areas.push({
      id: 900,
      card: "rage",
      team: "blue",
      x: attacker.x,
      y: attacker.y,
      radius: 5,
      duration: 6,
      remaining: 6,
      hitAt: 0,
    });
    const point = { x: king.x, y: king.y + 6.5 };
    const expected = tornadoEscapeStep(attacker, king, battle.areas, point);
    battle.play("red", 0, point.x, point.y);
    step(battle, 8);
    expect(king.hp > 0).toBe(expected !== undefined);
  });

  it("does not invent displacement for a stationary attacker", () => {
    const { attacker, target } = setup();
    attacker.speed = 0;
    expect(target()?.protectsKing).not.toBe(true);
  });

  it("does not invent a rescue when the first pull cannot beat release", () => {
    const { attacker, target } = setup();
    attacker.pendingAttack!.remaining = 1 / 30;
    expect(target()?.protectsKing).not.toBe(true);
  });

  it("never claims to pull an attacking building", () => {
    const { battle, attacker, king, spawn, target } = setup();
    attacker.hp = 0;
    const building = spawn("x-bow", king.x, king.y + 4);
    Object.assign(building, {
      active: true,
      speed: 2,
      target: king.id,
      pendingAttack: { target: king.id, remaining: 0.5, damage: 200 },
    });
    spawn("skeletons", king.x, king.y + 4);
    expect(target()?.protectsKing).not.toBe(true);
    expect(
      tornadoEscapeStep(building, king, battle.areas, {
        x: king.x,
        y: king.y + 9,
      }),
    ).toBeUndefined();
  });

  it("does not refresh a Tornado already interrupting the attack", () => {
    const { battle, king, attacker, target } = setup();
    battle.areas.push({
      id: 900,
      card: "tornado",
      team: "red",
      x: king.x,
      y: king.y + 6.5,
      radius: 5.5,
      duration: 3.05,
      remaining: 3.05,
      hitAt: 0,
    });
    expect(tornadoEscapeStep(attacker, king, battle.areas)).toBeDefined();
    expect(target()).toBeUndefined();
  });

  it("does not undo an existing King rescue to damage a different group", () => {
    const { battle, king, attacker, spawn, target } = setup();
    battle.areas.push({
      id: 900,
      card: "tornado",
      team: "red",
      x: king.x,
      y: king.y + 6.5,
      radius: 5.5,
      duration: 3.05,
      remaining: 3.05,
      hitAt: 0,
    });
    for (const x of [8.5, 9, 9.5]) spawn("minions", x, 1);
    expect(tornadoEscapeStep(attacker, king, battle.areas)).toBeDefined();
    const point = target();
    if (point)
      expect(
        tornadoEscapeStep(attacker, king, battle.areas, point),
      ).toBeDefined();
    think(battle);
    step(battle, 30);
    expect(king.hp).toBe(100);
  });

  it("requires all known fatal King windups to be interrupted", () => {
    const { battle, attacker, king, spawn, target } = setup();
    attacker.pendingAttack!.remaining = 0.5;
    const second = spawn("lumberjack", king.x, king.y + 1.8);
    Object.assign(second, {
      active: true,
      target: king.id,
      pendingAttack: {
        target: king.id,
        remaining: 1 / 30,
        damage: second.damage,
      },
      speed: 0,
    });
    expect(target()?.protectsKing).not.toBe(true);
    think(battle);
    step(battle, 3);
    expect(battle.winner).toBe("blue");
  });

  it("does not claim that Tornado can stop a shot already in flight", () => {
    const { battle, king, target } = setup();
    battle.projectiles.push({
      id: 900,
      team: "blue",
      source: 800,
      x: king.x,
      y: king.y,
      tx: king.x,
      ty: king.y,
      target: king.id,
      damage: 200,
      remaining: 0.1,
      duration: 0.1,
      splash: 0,
      air: true,
      style: "musketeer",
      stun: 0,
    });
    expect(target()?.protectsKing).not.toBe(true);
  });

  it("prefers protection over a Rocket King finisher arriving too late", () => {
    const { battle, king } = setup();
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
    battle.players.red.hand = ["rocket", "tornado", "pekka", "pekka"];
    battle.players.red.elixir = 6;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("tornado");
    step(battle, 90);
    expect(king.hp).toBe(100);
  });

  it("takes a genuinely earlier winning Zap", () => {
    const { battle, attacker } = setup();
    attacker.pendingAttack!.remaining = 0.5;
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
    battle.players.red.hand = ["zap", "tornado", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 6);
    expect(battle.winner).toBe("red");
  });

  it("keeps the rescue ahead of a same-step King draw", () => {
    const { battle, attacker, king } = setup();
    attacker.pendingAttack!.remaining = 0.15;
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
    battle.players.red.hand = ["zap", "tornado", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("tornado");
    step(battle, 30);
    expect(king.hp).toBe(100);
  });

  it.each([
    ["deep", 37], ["edge", 37], ["deep", 38], ["edge", 38],
  ] as const)(
    "tests the release range of a %s ranged attacker under rules %s",
    (position, version) => {
      const { battle, attacker, king, spawn } = setup("red", version);
      attacker.hp = 0;
      const ranged = spawn("musketeer", king.x, king.y + 3);
      if (position === "edge")
        ranged.y =
          king.y + attackReach(ranged, king) - 0.15;
      Object.assign(ranged, {
        active: true,
        target: king.id,
        pendingAttack: {
          target: king.id,
          remaining: 0.2,
          damage: ranged.damage,
        },
      });
      const point = { x: king.x, y: ranged.y + 5 };
      const expected = tornadoEscapeStep(ranged, king, [], point);
      expect(expected !== undefined).toBe(position === "edge" && version === 37);
      battle.play("red", 0, point.x, point.y);
      step(battle, 40);
      expect(king.hp > 0).toBe(position === "edge" && version === 37);
    },
  );

  it.each([false, true])(
    "uses the ordinary AI timer for King defense with late Rocket=%s",
    (rocket) => {
      const b = new Battle({ seed: 12, ai: true });
      for (const e of b.entities) e.active = false;
      const king = b.entities.find((e) => e.team === "red" && e.king)!;
      Object.assign(king, { hp: 100, active: true, cooldown: 3 });
      (b as any).spawn("lumberjack", "blue", king.x, king.y + 2);
      Object.assign(b.entities.at(-1)!, { hp: 200, deploy: 2.3 });
      b.players.red.hand = rocket
        ? ["rocket", "tornado", "pekka", "pekka"]
        : ["tornado", "pekka", "pekka", "pekka"];
      b.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      b.players.red.elixir = rocket ? 6 : 3;
      if (rocket) b.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      step(b, 120);
      expect(
        b.actions
          .filter((a) => a.team === "red")
          .map((a) => ({ card: a.card, tick: a.tick })),
      ).toEqual([{ card: "tornado", tick: 74 }]);
      expect(king.hp).toBe(100);
      expect(b.winner).toBeNull();
    },
  );

  it("respects Mirror's actual cost when choosing a rescue", () => {
    const { battle } = setup();
    battle.players.red.hand = ["mirror", "tornado", "pekka", "pekka"];
    battle.players.red.lastPlayed = "tornado";
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("tornado");
    expect(battle.players.red.elixir).toBe(1);
  });

  it("can use an affordable mirrored Tornado", () => {
    const { battle, king } = setup();
    battle.players.red.hand[0] = "mirror";
    battle.players.red.lastPlayed = "tornado";
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("mirror");
    expect(battle.players.red.elixir).toBe(0);
    step(battle, 90);
    expect(king.hp).toBe(100);
  });

  it("values air damage by body and clears a Minion group", () => {
    const { battle, attacker, king, spawn, target } = setup();
    attacker.hp = 0;
    king.hp = king.maxHp;
    const group = [3.5, 4, 4.5].map((x) => spawn("minions", x, 10));
    expect(target()?.protectsKing).not.toBe(true);
    expect(target()).toBeDefined();
    think(battle);
    step(battle, 92);
    expect(group.every((e) => e.hp === 0)).toBe(true);
  });

  it("holds against a lone cheap body and against buildings", () => {
    const { attacker, king, spawn, target } = setup();
    attacker.hp = 0;
    king.hp = king.maxHp;
    spawn("skeletons", 4, 10);
    for (const x of [3, 4, 5]) spawn("cannon", x, 10);
    expect(target()).toBeUndefined();
  });

  it("discounts a group already covered by a friendly spell projectile", () => {
    const { battle, attacker, king, spawn, target } = setup();
    attacker.hp = 0;
    king.hp = king.maxHp;
    for (const x of [3.5, 4, 4.5]) spawn("minions", x, 10);
    battle.projectiles.push({
      id: 900,
      team: "red",
      source: 0,
      x: 4,
      y: 10,
      tx: 4,
      ty: 10,
      target: null,
      damage: 1000,
      remaining: 0.1,
      duration: 0.1,
      splash: 3,
      air: true,
      style: "fireball",
      stun: 0,
    });
    expect(target()).toBeUndefined();
  });

  it("supports a general pull away from a threatened Princess", () => {
    const { battle, attacker, king, spawn, target } = setup();
    attacker.hp = 0;
    king.hp = king.maxHp;
    const princess = battle.entities.find((e) => e.team === "red" && !e.king)!;
    const giant = spawn("giant", princess.x, princess.y + 2);
    Object.assign(giant, { active: true, target: princess.id });
    const point = target()!;
    expect(point.protectsKing).not.toBe(true);
    expect(point.y).toBeGreaterThan(giant.y);
  });

  it("returns symmetric guest coordinates without changing state or RNG", () => {
    const { battle, target } = setup();
    const before = JSON.stringify(battle);
    const point = target()!;
    expect(target()).toEqual(point);
    expect(JSON.stringify(battle)).toBe(before);
    const guest = perspective(snapshot(battle), "red");
    const rotated = areaSpellTarget(
      "tornado",
      "blue",
      guest.entities,
      guest.areas,
      guest.projectiles,
    )!;
    expect(rotated.x).toBeCloseTo(18 - point.x);
    expect(rotated.y).toBeCloseTo(32 - point.y);
    expect(rotated.score).toBeCloseTo(point.score);
  });

  it.each(golden.cases)(
    "preserves original pull frames for $input.card/$input.team at $input.at.x,$input.at.y",
    ({ input, frames }) => {
      const { battle, attacker, spawn } = setup(input.team as Team);
      attacker.hp = 0;
      for (const tower of battle.entities.filter((e) => e.kind === "tower"))
        tower.hp = tower.maxHp;
      const body = spawn(
        input.card as CardId,
        input.at.x,
        input.at.y,
        input.team as Team,
      );
      if ("speed" in input) body.speed = input.speed!;
      const caster = input.team === "blue" ? "red" : "blue";
      battle.players[caster].hand[0] = "tornado";
      battle.players[caster].elixir = 10;
      expect(battle.play(caster, 0, input.center.x, input.center.y).ok).toBe(
        true,
      );
      const actual = frames.map(() => {
        battle.step();
        return { x: body.x, y: body.y, hp: body.hp };
      });
      expect(golden.capturedFrom).toBe("7a8d090");
      expect(actual).toEqual(frames);
    },
  );
});
