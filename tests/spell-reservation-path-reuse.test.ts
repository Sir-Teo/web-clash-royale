import { describe, expect, it } from "vitest";
import { Battle, type Point, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { createSpellApproachPaths } from "../src/game/spell-approach-paths";
import { createSpellPullPaths } from "../src/game/spell-pull-paths";
import { createSpellDamageReservation } from "../src/game/spell-reservations";

function scene(card: "hog-rider" | "wizard" = "hog-rider") {
  const battle = new Battle({ seed: 12, ai: false });
  battle.entities.forEach((e) => (e.active = false));
  (
    battle as unknown as {
      spawn: (card: CardId, team: Team, x: number, y: number) => void;
    }
  ).spawn(card, "blue", 3.5, 20);
  const body = battle.entities.at(-1)!;
  Object.assign(body, { active: card === "hog-rider", deploy: 0 });
  const cast = (id: CardId, point: Point, team: Team = "red") => {
    battle.players[team].hand[0] = id;
    battle.players[team].elixir = 10;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const finish = (id: string) => {
    let ticks = 0;
    while (battle.projectiles.some((p) => p.style === id) && ticks++ < 210)
      battle.step();
    expect(battle.projectiles.some((p) => p.style === id)).toBe(false);
  };
  return { battle, body, cast, finish };
}

describe("reservation reuse keeps independent flight coverage", () => {
  for (const inward of [false, true])
    it.each([8, 180])(
      `keeps the native Arrows contact with a preferred path (inward=${inward}, steps=%s)`,
      (steps) => {
        const s = scene(),
          b = s.battle;
        s.cast("rage", s.body, "blue");
        s.cast("arrows", { x: s.body.x, y: s.body.y + (inward ? -4.7 : 4.5) });
        const preferred = createSpellApproachPaths(
          b.entities,
          b.areas,
          b.projectiles,
          steps,
        )!;
        expect(preferred(s.body)).toHaveLength(steps);
        const before = JSON.stringify(b);
        const reserve = createSpellDamageReservation(
          "red",
          b.entities,
          b.projectiles,
          b.areas,
          preferred,
        );
        expect(reserve(s.body)).toBe(inward ? CARD_MAP.arrows.damage : 0);
        expect(reserve(s.body)).toBe(inward ? CARD_MAP.arrows.damage : 0);
        expect(JSON.stringify(b)).toBe(before);
        s.finish("arrows");
        expect(s.body.hp).toBe(
          s.body.maxHp - (inward ? CARD_MAP.arrows.damage : 0),
        );
      },
    );

  it("retains an earlier reservation when the destination cannot survive a longer preferred horizon", () => {
    const s = scene(),
      b = s.battle;
    s.body.y = 11;
    const destination = b.entities.find(
      (e) => e.team === "red" && !e.king && e.lane === "left",
    )!;
    destination.hp = 1;
    s.cast("rage", s.body, "blue");
    s.cast("arrows", { x: s.body.x, y: 6.3 });
    const preferred = createSpellApproachPaths(
      b.entities,
      b.areas,
      b.projectiles,
      180,
    )!;
    expect(preferred(s.body)).toBeUndefined();
    expect(
      createSpellDamageReservation(
        "red",
        b.entities,
        b.projectiles,
        b.areas,
        preferred,
      )(s.body),
    ).toBe(CARD_MAP.arrows.damage);
    s.finish("arrows");
    expect(s.body.hp).toBe(s.body.maxHp - CARD_MAP.arrows.damage);
    expect(destination.hp).toBe(1);
  });

  it("keeps a late Rocket contact after a preferred short pull path ends", () => {
    const s = scene("wizard"),
      b = s.battle;
    Object.assign(s.body, { x: 5.6, y: 29.5 });
    s.cast("tornado", { x: 3, y: 29.5 });
    s.cast("rocket", { x: 3, y: 29.5 });
    const preferred = createSpellPullPaths(b.areas, 8)!;
    expect(preferred(s.body)).toHaveLength(8);
    const shot = b.projectiles.find((p) => p.style === "rocket")!;
    expect(shot.remaining).toBeGreaterThan(4);
    expect(
      createSpellDamageReservation(
        "red",
        b.entities,
        b.projectiles,
        b.areas,
        preferred,
      )(s.body),
    ).toBe(CARD_MAP.rocket.damage);
    s.finish("rocket");
    expect(s.body.hp).toBe(0);
  });
});
