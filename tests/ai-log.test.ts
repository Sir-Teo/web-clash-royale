import { describe, expect, it } from "vitest";
import { Battle, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { damageSpellTarget, isDamageSpell } from "../src/game/spell-targeting";
import { logSpellContains, logSpellProjectile } from "../src/game/log-flight";
import { createKingSpellRace } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";
import { projectileDamagePackets } from "../src/game/projectile-impacts";
import { perspective, snapshot } from "../src/network/perspective";
import log from "../src/game/log-data.json";

function setup(team: Team = "red", ai = false) {
  const battle = new Battle({ seed: 12, ai });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const spawn = (card: CardId, x: number, y: number, side: Team = enemy) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, side, x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { deploy: 0, active: false, speed: 0 });
    return body;
  };
  battle.players[team].hand = ["log", "pekka", "pekka", "pekka"];
  battle.players[team].elixir = 2;
  const target = () =>
    damageSpellTarget(
      "log",
      team,
      battle.entities,
      battle.projectiles,
      battle.areas,
    );
  const princess = battle.entities.find(
    (e) => e.team === enemy && e.kind === "tower" && !e.king,
  )!;
  const king = battle.entities.find((e) => e.team === enemy && e.king)!;
  return { battle, spawn, target, king, princess };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, count: number) => {
  for (let i = 0; i < count && !b.winner; i++) b.step();
};

describe("AI Log corridor targeting", () => {
  it("recognizes Log as a planned damage spell", () =>
    expect(isDamageSpell("log")).toBe(true));

  it("holds Log against three flying Minions on its ordinary timer", () => {
    const { battle, spawn, target } = setup("red", true);
    const group = [3.7, 4, 4.3].map((x) => spawn("minions", x, 10));
    expect(target()).toBeUndefined();
    step(battle, 120);
    expect(battle.actions).toEqual([]);
    expect(group.every((e) => e.hp === e.maxHp)).toBe(true);
  });

  it("lands behind nearby Goblins and clears them on the ordinary timer", () => {
    const { battle, spawn } = setup("red", true);
    const group = [3.7, 4, 4.3].map((x) => spawn("goblins", x, 10));
    step(battle, 90);
    expect(battle.actions).toHaveLength(1);
    expect(battle.actions[0]).toMatchObject({ tick: 74, card: "log" });
    expect(battle.actions[0].y).toBeLessThan(10);
    expect(group.every((e) => e.hp === 0)).toBe(true);
  });

  it("values separated ground bodies along the full rolling path", () => {
    const { battle, spawn } = setup();
    const group = [10, 14, 20].map((y) => spawn("goblins", 4, y));
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("log");
    step(battle, 130);
    expect(group.every((e) => e.hp === 0)).toBe(true);
  });

  it("finds the narrow shared lane between two bodies", () => {
    const { battle, spawn, target } = setup();
    const group = [3, 4.8].map((x) => spawn("goblins", x, 10));
    const point = target()!;
    expect(point).toBeDefined();
    expect(point.x).toBeGreaterThan(3);
    expect(point.x).toBeLessThan(4.8);
    expect(group.every((e) => logSpellContains("red", point, e))).toBe(true);
    think(battle);
    step(battle, 20);
    expect(group.every((e) => e.hp === 0)).toBe(true);
  });

  it("does not value a broad circular group outside the narrow rolling lane", () => {
    const { spawn, target } = setup();
    for (const x of [4, 6.2]) spawn("goblins", x, 10);
    expect(target()).toBeUndefined();
  });

  it("chooses the ground lane despite an expensive flying group elsewhere", () => {
    const { battle, spawn } = setup();
    const ground = [3.7, 4, 4.3].map((x) => spawn("goblins", x, 10));
    for (const x of [13.7, 14, 14.3]) spawn("lava-hound", x, 8);
    think(battle);
    const cast = battle.actions.at(-1)!;
    expect(cast.card).toBe("log");
    expect(ground.every((e) => logSpellContains("red", cast, e))).toBe(true);
    step(battle, 20);
    expect(
      battle.entities
        .filter((e) => e.card === "lava-hound")
        .every((e) => e.hp === e.maxHp),
    ).toBe(true);
  });

  it("finishes a distant Princess from a legal launch on its own side", () => {
    const { battle, princess, target } = setup();
    princess.hp = 100;
    const point = target()!;
    expect(point.y).toBeLessThanOrEqual(14.5);
    expect(battle.canPlace("red", "log", point.x, point.y).ok).toBe(true);
    think(battle);
    step(battle, 130);
    expect(princess.hp).toBe(0);
    expect(battle.players.red.crowns).toBe(1);
  });

  it("finishes the King at the forecast first rolling contact", () => {
    const { battle, king, target } = setup();
    king.hp = 100;
    const point = target()!;
    expect(point.lethalTower).toBe(king.id);
    const race = createKingSpellRace(
      "log",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(point.matchDecisionStep).toBe(race.stepAt(point));
    think(battle);
    step(battle, point.matchDecisionStep! - 1);
    expect(battle.winner).toBeNull();
    step(battle, 1);
    expect(battle.winner).toBe("red");
  });

  it("keeps an affordable Freeze ahead of a Log arriving after a fatal King swing", () => {
    const { battle, king, spawn } = setup();
    king.hp = 100;
    const own = battle.entities.find((e) => e.team === "red" && e.king)!;
    Object.assign(own, { hp: 100, active: true, cooldown: 100 });
    const attacker = spawn("lumberjack", own.x, own.y + 2);
    Object.assign(attacker, {
      active: true,
      target: own.id,
      pendingAttack: {
        target: own.id,
        remaining: 0.2,
        damage: attacker.damage,
      },
    });
    battle.players.red.hand = ["log", "freeze", "pekka", "pekka"];
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("freeze");
    step(battle, 25);
    expect(own.hp).toBe(100);
  });

  it("uses the same contact packets in the overtime ending forecast", () => {
    const { battle, princess, target } = setup();
    battle.tick = 6000;
    princess.hp = 100;
    const point = target()!;
    const context = createMatchFinisher(
      "red",
      battle.entities,
      [],
      [],
      { blue: 0, red: 0 },
      battle.remaining,
    );
    const expected = context.outcomeAt("log", point)!;
    expect(expected.winner).toBe("red");
    think(battle);
    step(battle, expected.step);
    expect(battle.winner).toBe("red");
    expect(battle.time).toBeCloseTo(200 + expected.step / 30);
  });

  it("spends the ordinary cost instead of Mirror's surcharge for the same finisher", () => {
    const { battle, princess } = setup();
    princess.hp = 100;
    battle.players.red.hand = ["mirror", "log", "pekka", "pekka"];
    battle.players.red.lastPlayed = "log";
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("log");
    expect(battle.players.red.elixir).toBe(1);
  });

  it("can aim a mirrored Log using its actual cost", () => {
    const { battle, princess } = setup();
    princess.hp = 100;
    battle.players.red.hand[0] = "mirror";
    battle.players.red.lastPlayed = "log";
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("mirror");
    expect(battle.players.red.elixir).toBe(0);
    step(battle, 130);
    expect(princess.hp).toBe(0);
  });

  it("reserves the existing Log's contacts instead of casting again", () => {
    const { battle, spawn, target } = setup();
    for (const x of [3.7, 4, 4.3]) spawn("goblins", x, 10);
    const point = target()!;
    expect(battle.play("red", 0, point.x, point.y).ok).toBe(true);
    expect(target()).toBeUndefined();
  });

  it("avoids hidden Teslas and invulnerable dashes", () => {
    const { spawn, target } = setup();
    for (const x of [3.7, 4, 4.3]) {
      spawn("tesla", x, 10);
      spawn("bandit", x, 10).dash = { x, y: 9, remaining: 0.2 } as any;
    }
    expect(target()).toBeUndefined();
  });

  it("does not spend two elixir on one cheap Skeleton", () => {
    const { spawn, target } = setup();
    spawn("skeleton-army", 4, 10);
    expect(target()).toBeUndefined();
  });

  it("absorbs a whole contact into each Guard shield", () => {
    const { battle, spawn, target } = setup();
    const group = [3, 4, 5].map((x) => spawn("guards", x, 10));
    expect(target()).toBeDefined();
    think(battle);
    step(battle, 20);
    expect(group.every((e) => e.shield === 0 && e.hp === e.maxHp)).toBe(true);
  });

  it("has symmetric guest coordinates and leaves the battle unchanged", () => {
    const { battle, spawn, target } = setup();
    for (const x of [3.7, 4, 4.3]) spawn("goblins", x, 10);
    const before = JSON.stringify(battle);
    const point = target()!;
    expect(target()).toEqual(point);
    expect(JSON.stringify(battle)).toBe(before);
    const guest = perspective(snapshot(battle), "red");
    const rotated = damageSpellTarget(
      "log",
      "blue",
      guest.entities,
      guest.projectiles,
      guest.areas,
    )!;
    expect(rotated.x).toBeCloseTo(18 - point.x);
    expect(rotated.y).toBeCloseTo(32 - point.y);
    expect(rotated.score).toBeCloseTo(point.score);
  });

  it("can redirect the last Lightning pulse, distinguishing equally covered rolling paths by contact time", () => {
    const { battle, spawn, princess } = setup();
    battle.tick = 6000;
    princess.hp = 400;
    for (const x of [2.4, 5.6, 4]) spawn("giant", x, 22.5).hp = 600;
    battle.areas.push({
      id: 900,
      card: "lightning",
      team: "red",
      x: princess.x,
      y: princess.y,
      radius: 3.5,
      duration: 1.5,
      remaining: 1.5,
      hitAt: 0.46,
      struck: [],
    });
    const context = createMatchFinisher(
      "red",
      battle.entities,
      [],
      battle.areas,
      { blue: 0, red: 0 },
      battle.remaining,
    );
    const before = JSON.stringify(battle);
    expect(context.outcomeAt("log", { x: 4, y: 14.5 })).toEqual({
      winner: "red",
      step: 43,
    });
    expect(context.outcomeAt("log", { x: 4, y: 13 })).toBeUndefined();
    expect(context.outcomeAt("log", { x: 4, y: 14.5 })).toEqual({
      winner: "red",
      step: 43,
    });
    expect(JSON.stringify(battle)).toBe(before);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("log");
    step(battle, 43);
    expect(battle.winner).toBe("red");
    expect(princess.hp).toBe(0);
  });

  for (const team of ["red", "blue"] as const)
    it.each([
      "landing",
      "far",
      "end",
      "beyond",
      "behind",
      "off-lane",
      "air",
    ] as const)(
      `${team}: matches native first contact for a %s body`,
      (place) => {
        const { battle, spawn } = setup(team);
        const direction = team === "red" ? 1 : -1;
        const point = { x: 9, y: team === "red" ? 8 : 24 };
        const landing = point.y + direction * log.launchMinimumDistance;
        const body = spawn(
          place === "air" ? "minions" : "knight",
          point.x,
          landing +
            direction * (place === "far" ? 9 : place === "behind" ? -4 : 0),
        );
        if (place === "off-lane")
          body.x += log.collisionHalfWidth + body.radius;
        if (place === "end" || place === "beyond")
          body.y =
            landing +
            direction *
              (log.rollingRange +
                log.collisionRadius +
                body.radius +
                (place === "end" ? -0.001 : 0.01));
        const proposed = logSpellProjectile(team, point);
        const packets = projectileDamagePackets(
          body,
          [proposed],
          battle.entities,
        );
        const contained = logSpellContains(team, point, body);
        expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
        expect({ ...battle.projectiles[0], id: -1 }).toEqual(proposed);
        let actual: number | undefined;
        for (let i = 1; i <= 130; i++) {
          battle.step();
          if (body.hp < body.maxHp) {
            actual = i;
            break;
          }
        }
        expect(packets[0]?.step).toBe(actual);
        expect(contained && place !== "air").toBe(packets.length > 0);
      },
    );
});
