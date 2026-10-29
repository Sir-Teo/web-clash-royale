import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { damageSpellTarget } from "../src/game/spell-targeting";
import { createSpellPullPaths } from "../src/game/spell-pull-paths";
import { logSpellProjectile } from "../src/game/log-flight";
import { projectileDamagePackets } from "../src/game/projectile-impacts";
import { perspective, snapshot } from "../src/network/perspective";
import log from "../src/game/log-data.json";

function scene(team: Team = "red", version = 56) {
  const b =
    version === 56
      ? new Battle({ seed: 12, ai: false })
      : new Battle({
          replay: {
            ...new Battle({ seed: 12, ai: false }).exportReplay(),
            version,
          },
        });
  if (version !== 56)
    Object.assign(b, { replayActions: null, replayDuration: undefined });
  b.entities.forEach((e) => (e.active = false));
  const bodies = [19, 20, 21].map((y) => {
    (b as any).spawn(
      "wizard",
      team === "red" ? "blue" : "red",
      5,
      team === "red" ? y : 32 - y,
    );
    const body = b.entities.at(-1)!;
    Object.assign(body, { hp: 500, deploy: 0, active: false });
    return body;
  });
  const cast = (card: CardId, x: number, y: number, side = team) => {
    b.players[side].hand[0] = card;
    b.players[side].elixir = 10;
    expect(b.play(side, 0, x, y).ok).toBe(true);
  };
  const pull = (x = 10, side = team) =>
    cast("tornado", x, team === "red" ? 20 : 12, side);
  const aim = (rulesVersion = version, cost = 2) =>
    damageSpellTarget(
      "log",
      team,
      b.entities,
      b.projectiles,
      b.areas,
      cost,
      Infinity,
      undefined,
      rulesVersion,
    );
  const roll = () => {
    for (let n = 0; n < 130; n++) b.step();
  };
  return { b, bodies, cast, pull, aim, roll };
}
const think = (b: Battle) => (b as any).think();

describe("Log follows known Tornado pulls", () => {
  it("keeps an inclusive rear-edge contact identical to native arithmetic", () => {
    const b = new Battle({ seed: 12, ai: false });
    b.entities.forEach((e) => (e.active = false));
    (b as any).spawn("skeletons", "blue", 4.5, 10);
    const body = b.entities.at(-1)!;
    const point = { x: 4.5, y: 1 };
    Object.assign(body, { active: false, deploy: 0, speed: 0, radius: 0.3 });
    body.y =
      point.y + log.launchMinimumDistance - log.collisionRadius - body.radius;
    const path = Array.from({ length: 118 }, () => ({ x: body.x, y: body.y }));
    const expected = projectileDamagePackets(
      body,
      [logSpellProjectile("red", point)],
      b.entities,
      path,
    )[0]?.step;
    b.players.red.hand[0] = "log";
    b.players.red.elixir = 2;
    expect(b.play("red", 0, point.x, point.y).ok).toBe(true);
    while (b.tick < 118 && body.hp > 0) b.step();
    expect(body.hp).toBe(0);
    expect(expected).toBe(b.tick);
  });
  for (const team of ["red", "blue"] as const) {
    it(`clears all three Wizards where stationary aiming misses (${team})`, () => {
      const s = scene(team),
        old = scene(team),
        control = scene(team);
      for (const board of [s, old, control]) board.pull();
      const point = s.aim()!,
        previous = old.aim(55)!;
      expect(point.x).toBeGreaterThan(previous.x + 0.5);
      expect(s.b.canPlace(team, "log", point.x, point.y).ok).toBe(true);
      s.cast("log", point.x, point.y);
      old.cast("log", previous.x, previous.y);
      for (const board of [s, old, control]) board.roll();
      expect(s.bodies.map((e) => e.hp)).toEqual([0, 0, 0]);
      expect(old.bodies.map((e) => e.hp)).toEqual(
        control.bodies.map((e) => e.hp),
      );
      expect(old.bodies.map((e) => e.hp)).toEqual([218, 218, 218]);
    });

    it(`predicts actual first contacts before the Log can knock a target back (${team})`, () => {
      const s = scene(team);
      s.pull();
      const point = s.aim()!;
      const paths = createSpellPullPaths(s.b.areas, 118)!;
      const expected = new Map(
        s.bodies.map((body) => [
          body.id,
          projectileDamagePackets(
            body,
            [logSpellProjectile(team, point)],
            s.b.entities,
            paths(body),
          )[0]?.step,
        ]),
      );
      expect([...expected.values()].every((step) => step !== undefined)).toBe(
        true,
      );
      s.cast("log", point.x, point.y);
      const observed = new Map<number, number>();
      for (let step = 1; step <= 118; step++) {
        s.b.step();
        for (const body of s.bodies)
          if (body.hp === 0 && !observed.has(body.id))
            observed.set(body.id, step);
      }
      expect(observed).toEqual(expected);
    });

    it(`keeps stationary and friendly-pull-only planning unchanged (${team})`, () => {
      const s = scene(team);
      const original = s.aim();
      expect(s.aim(55)).toEqual(original);
      s.pull(10, team === "red" ? "blue" : "red");
      expect(s.aim()).toEqual(s.aim(55));
    });
  }

  it.each([0.1, 0.5, 1.1])(
    "keeps expiring pulls and their last position in the contact path (%ss)",
    (remaining) => {
      const s = scene();
      s.pull();
      s.b.areas[0].remaining = remaining;
      s.b.areas[0].duration = remaining;
      const point = s.aim()!;
      s.cast("log", point.x, point.y);
      s.roll();
      expect(s.bodies.every((e) => e.hp === 0)).toBe(true);
    },
  );

  it.each([false, true])(
    "follows competing area order with actual Freeze and Rage (reverse=%s)",
    (reverse) => {
      const s = scene();
      for (const x of reverse ? [11, 9] : [9, 11]) s.pull(x);
      s.cast("freeze", 5, 20);
      s.cast("rage", 5, 20, "blue");
      const point = s.aim()!;
      s.cast("log", point.x, point.y);
      s.roll();
      expect(s.bodies.every((e) => e.hp === 0)).toBe(true);
    },
  );

  it("spends actual Mirror cost and uses the resolved rolling lane", () => {
    const s = scene();
    s.pull();
    s.b.players.red.hand = ["mirror", "pekka", "pekka", "pekka"];
    s.b.players.red.lastPlayed = "log";
    s.b.players.red.elixir = 3;
    const point = s.aim(56, 3)!;
    think(s.b);
    expect(s.b.actions.at(-1)).toMatchObject({
      card: "mirror",
      x: point.x,
      y: point.y,
    });
    expect(s.b.players.red.elixir).toBe(0);
    s.roll();
    expect(s.bodies.every((e) => e.hp === 0)).toBe(true);
  });

  it("retains rules-55 AI placement while current AI clears the pull", () => {
    for (const version of [55, 56]) {
      const s = scene("red", version);
      s.pull();
      s.b.players.red.hand = ["log", "pekka", "pekka", "pekka"];
      s.b.players.red.elixir = 2;
      const expected = s.aim()!;
      think(s.b);
      expect(s.b.actions.at(-1)).toMatchObject({
        card: "log",
        x: expected.x,
        y: expected.y,
      });
      s.roll();
      expect(s.bodies.map((e) => e.hp)).toEqual(
        version === 56 ? [0, 0, 0] : [218, 218, 218],
      );
    }
  });

  it("is symmetric and leaves state, all area clocks and RNG untouched", () => {
    const s = scene();
    s.pull();
    const before = JSON.stringify(s.b),
      point = s.aim()!;
    expect(s.aim()).toEqual(point);
    expect(JSON.stringify(s.b)).toBe(before);
    const guest = perspective(snapshot(s.b), "red");
    const mirrored = damageSpellTarget(
      "log",
      "blue",
      guest.entities,
      guest.projectiles,
      guest.areas,
    )!;
    expect(mirrored.x).toBeCloseTo(18 - point.x);
    expect(mirrored.y).toBeCloseTo(32 - point.y);
    expect(mirrored.value).toBeCloseTo(point.value);
    expect(mirrored.score).toBeCloseTo(point.score);
  });

  it.each([false, true])(
    "only reserves an earlier Log that reaches the pulled group (hits=%s)",
    (hits) => {
      const s = scene();
      s.pull();
      const point = s.aim(hits ? 56 : 55)!;
      s.cast("log", point.x, point.y);
      expect(!!s.aim()).toBe(!hits);
    },
  );

  it("keeps the same decision RNG draw count as the historical policy", () => {
    const boards = [scene("red", 55), scene("red", 56)];
    for (const s of boards) {
      s.pull();
      s.b.players.red.hand = ["log", "pekka", "pekka", "pekka"];
      s.b.players.red.elixir = 2;
      think(s.b);
    }
    expect((boards[0].b as any).randomState).toBe(
      (boards[1].b as any).randomState,
    );
  });

  it("leads a legal opening on the ordinary AI timer and reconstructs its complete replay", () => {
    const deck: CardId[] = [
      "wizard",
      "knight",
      "archers",
      "skeletons",
      "goblins",
      "fireball",
      "zap",
      "cannon",
    ];
    const enemyDeck: CardId[] = [
      "tornado",
      "log",
      "pekka",
      "golem",
      "lava-hound",
      "three-musketeers",
      "rocket",
      "lightning",
    ];
    const b = new Battle({ seed: 2, deck, enemyDeck, ai: true });
    expect(
      b.play("blue", b.players.blue.hand.indexOf("wizard"), 9, 22).ok,
    ).toBe(true);
    while (b.tick < 73) b.step();
    expect(
      b.play("red", b.players.red.hand.indexOf("tornado"), 13.5, 20).ok,
    ).toBe(true);
    expect(
      damageSpellTarget(
        "log",
        "red",
        b.entities,
        b.projectiles,
        b.areas,
        2,
        Infinity,
        undefined,
        55,
      ),
    ).toBeUndefined();
    let hit = false;
    while (b.tick < 900 && !b.winner) {
      b.step();
      if (
        b.events.some(
          (e) =>
            e.type === "hit" &&
            e.card === "log" &&
            e.value === CARD_MAP.log.damage &&
            e.y < 23,
        )
      )
        hit = true;
    }
    expect(b.actions.find((a) => a.card === "log")).toMatchObject({
      tick: 74,
      team: "red",
      x: 14.5,
      y: 14.5,
    });
    expect(hit).toBe(true);
    const replay = b.exportReplay(),
      rebuilt = new Battle({ replay });
    while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
    expect(rebuilt.entities).toEqual(b.entities);
    expect(rebuilt.players).toEqual(b.players);
    expect(rebuilt.projectiles).toEqual(b.projectiles);
    expect(rebuilt.areas).toEqual(b.areas);
    expect(rebuilt.audioEvents).toEqual(b.audioEvents);
    expect(rebuilt.actions).toEqual(b.actions);
    expect(rebuilt.winner).toBe(b.winner);
  });
});
