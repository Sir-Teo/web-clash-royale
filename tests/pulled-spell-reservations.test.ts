import { describe, expect, it } from "vitest";
import { Battle, type Point, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { impactSteps } from "../src/game/projectile-impacts";
import {
  createSpellDamageReservation,
  pendingSpellDamage,
} from "../src/game/spell-reservations";
import log from "../src/game/log-data.json";

function board(team: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  battle.entities.forEach((e) => (e.active = false));
  const enemy = team === "red" ? "blue" : "red";
  (
    battle as unknown as {
      spawn: (card: CardId, team: Team, x: number, y: number) => void;
    }
  ).spawn("wizard", enemy, 5, 20);
  const body = battle.entities.at(-1)!;
  Object.assign(body, { hp: 500, active: false, deploy: 0 });
  const cast = (card: CardId, point: Point) => {
    battle.players[team].hand[0] = card;
    battle.players[team].elixir = 10;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const step = (count: number) => {
    for (let i = 0; i < count; i++) battle.step();
  };
  const reserve = () =>
    pendingSpellDamage(
      body,
      team,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
  return { battle, body, team, cast, step, reserve };
}

function blast(
  card: "zap" | "fireball" | "arrows" | "rocket",
  team: Team,
  inward: boolean,
  released = true,
) {
  const s = board(team),
    point = { x: 5, y: 20 };
  s.body.x =
    point.x + CARD_MAP[card].radius! + s.body.radius + (inward ? 0.1 : -0.1);
  s.cast("tornado", { x: inward ? point.x : s.body.x + 3, y: point.y });
  if (released) s.cast(card, point);
  return s;
}

describe("spell reservations follow current pulls", () => {
  for (const team of ["red", "blue"] as const) {
    for (const card of ["zap", "fireball", "arrows", "rocket"] as const) {
      it.each([false, true])(
        `${card} contacts match the native pull (${team}, inward=%s)`,
        (inward) => {
          const s = blast(card, team, inward),
            control = blast(card, team, inward, false);
          expect(s.reserve()).toBe(inward ? CARD_MAP[card].damage : 0);
          const shot = s.battle.projectiles.find((p) => p.style === card)!;
          const ticks = impactSteps(shot.remaining);
          s.step(ticks);
          control.step(ticks);
          expect(s.body.hp).toBe(
            inward
              ? Math.max(0, control.body.hp - CARD_MAP[card].damage)
              : control.body.hp,
          );
          expect(
            s.battle.projectiles.filter((p) => p.style === card),
          ).toHaveLength(0);
        },
      );
    }

    it.each([false, true])(
      `Log enters or leaves its rolling lane (${team}, inward=%s)`,
      (inward) => {
        const s = board(team),
          control = board(team);
        const y = team === "red" ? 20 : 12;
        for (const b of [s, control]) {
          b.body.x =
            4 +
            log.collisionHalfWidth +
            b.body.radius +
            (inward ? 0.05 : -0.05);
          b.body.y = y;
          b.cast("tornado", { x: inward ? 4 : 8, y });
        }
        s.cast("log", { x: 4, y: team === "red" ? 14.5 : 17.5 });
        expect(s.reserve()).toBe(inward ? CARD_MAP.log.damage : 0);
        let ticks = 0;
        while (
          s.battle.projectiles.some((p) => p.style.startsWith("log")) &&
          ticks++ < 180
        )
          s.step(1);
        control.step(ticks);
        expect(s.battle.projectiles).toHaveLength(0);
        expect(s.body.hp).toBe(inward ? 0 : control.body.hp);
        expect(control.body.hp).toBeGreaterThan(0);
      },
    );
  }

  it("retains Rocket contacts after Tornado expires and beyond a two-second windup", () => {
    const s = board();
    Object.assign(s.body, { x: 5.6, y: 29.5 });
    s.cast("tornado", { x: 3, y: 29.5 });
    s.cast("rocket", { x: 3, y: 29.5 });
    const ticks = impactSteps(s.battle.projectiles[0].remaining);
    expect(ticks).toBeGreaterThan(120);
    expect(s.reserve()).toBe(CARD_MAP.rocket.damage);
    s.step(ticks);
    expect(s.body.hp).toBe(0);
    expect(s.battle.areas).toHaveLength(0);
  });

  it("includes a late Log contact after its launch and nearly complete roll", () => {
    const s = board();
    Object.assign(s.body, { x: 4, y: 31.3 });
    s.cast("tornado", { x: 4, y: 28.5 });
    s.cast("log", { x: 4, y: 14.5 });
    expect(s.reserve()).toBe(CARD_MAP.log.damage);
    s.step(60);
    expect(s.body.hp).toBeGreaterThan(0);
    s.step(40);
    expect(s.body.hp).toBe(0);
  });

  it("caches repeated body queries without changing clocks, positions or RNG", () => {
    const s = blast("fireball", "red", true);
    const before = JSON.stringify(s.battle);
    const reserve = createSpellDamageReservation(
      s.team,
      s.battle.entities,
      s.battle.projectiles,
      s.battle.areas,
    );
    expect(reserve(s.body)).toBe(CARD_MAP.fireball.damage);
    expect(reserve(s.body)).toBe(CARD_MAP.fireball.damage);
    expect(
      pendingSpellDamage(s.body, s.team, s.battle.projectiles, s.battle.areas),
    ).toBe(CARD_MAP.fireball.damage);
    expect(JSON.stringify(s.battle)).toBe(before);
  });

  it.each([false, true])(
    "reserves the genuine Fireball on the ordinary AI timer (inward=%s)",
    (inward) => {
      const b = new Battle({ seed: 12, ai: true });
      b.entities.forEach((e) => (e.active = false));
      for (const y of [19, 20, 21]) {
        (
          b as unknown as {
            spawn: (card: CardId, team: Team, x: number, y: number) => void;
          }
        ).spawn("wizard", "blue", inward ? 9 : 5, y);
        Object.assign(b.entities.at(-1)!, {
          hp: 500,
          active: false,
          deploy: 0,
        });
      }
      while (b.tick < 73) b.step();
      for (const [card, x] of [
        ["tornado", inward ? 5 : 10],
        ["fireball", 5],
      ] as const) {
        b.players.red.hand[0] = card;
        b.players.red.elixir = 10;
        expect(b.play("red", 0, x, 20).ok).toBe(true);
      }
      b.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
      b.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      b.players.red.elixir = 2;
      b.step();
      b.step();
      expect(
        b.actions.filter((a) => a.team === "red").map((a) => [a.card, a.tick]),
      ).toEqual([
        ["tornado", 73],
        ["fireball", 73],
        ...(!inward ? [["zap", 74]] : []),
      ]);
      for (let i = 0; i < 4; i++) b.step();
      expect(
        b.entities
          .filter((e) => e.card === "wizard")
          .every((e) => e.hp === (inward ? 500 : 308)),
      ).toBe(true);
      while (b.tick < 150) b.step();
      const alive = b.entities.filter((e) => e.card === "wizard");
      if (inward) {
        expect(alive).toHaveLength(0);
        expect(b.players.red.hand).toContain("zap");
        expect(b.players.red.elixir).toBeGreaterThan(2);
      } else {
        expect(alive).toHaveLength(3);
        expect(alive.every((e) => e.hp === 73)).toBe(true);
      }
    },
  );
});
