import { describe, expect, it } from "vitest";
import { Battle, type Point, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { pendingSpellDamage } from "../src/game/spell-reservations";
import { createSpellApproachPaths } from "../src/game/spell-approach-paths";
import { createWindupHealth } from "../src/game/windup-health";

function board(card: "hog-rider" | "balloon", caster: Team) {
  const battle = new Battle({ seed: 12, ai: false });
  battle.entities.forEach((e) => (e.active = false));
  const team = caster === "red" ? "blue" : "red";
  (
    battle as unknown as {
      spawn: (card: CardId, team: Team, x: number, y: number) => void;
    }
  ).spawn(card, team, 3.5, caster === "red" ? 20 : 12);
  const body = battle.entities.at(-1)!;
  Object.assign(body, { active: true, deploy: 0 });
  const cast = (id: CardId, point: Point, side = caster) => {
    battle.players[side].hand[0] = id;
    battle.players[side].elixir = 10;
    expect(battle.play(side, 0, point.x, point.y).ok).toBe(true);
  };
  return { battle, body, team, cast };
}

describe("released Arrows follow stable building approaches", () => {
  for (const card of ["hog-rider", "balloon"] as const)
    for (const caster of ["red", "blue"] as const)
      for (const inward of [false, true])
        it.each([0, 0.4])(
          `reserves the native moving contact (${card}, ${caster}, inward=${inward}, delay=%s)`,
          (delay) => {
            const s = board(card, caster);
            const sign = caster === "red" ? -1 : 1;
            const gap = CARD_MAP.arrows.radius! + s.body.radius;
            s.cast("rage", s.body, s.team);
            s.cast("arrows", {
              x: s.body.x,
              y: s.body.y + sign * (inward ? gap + 0.1 : -gap + 0.1),
            });
            const shot = s.battle.projectiles.at(-1)!;
            shot.delay = delay;
            const before = JSON.stringify(s.battle);
            const paths = createSpellApproachPaths(
              s.battle.entities,
              s.battle.areas,
              s.battle.projectiles,
              180,
            )!;
            const health = createWindupHealth(
              s.battle.projectiles,
              s.battle.entities,
            ).survival(s.body, paths.frames(s.body)!, s.battle.areas);
            const reserved = pendingSpellDamage(
              s.body,
              caster,
              s.battle.projectiles,
              s.battle.areas,
              s.battle.entities,
            );
            expect(JSON.stringify(s.battle)).toBe(before);
            let ticks = 0;
            while (s.battle.projectiles.includes(shot) && ticks < 180) {
              s.battle.step();
              expect(health[ticks++].afterAlive).toBe(s.body.hp > 0);
            }
            expect(s.battle.projectiles).not.toContain(shot);
            expect(s.body.hp).toBe(
              s.body.maxHp - (inward ? CARD_MAP.arrows.damage : 0),
            );
            expect(reserved).toBe(inward ? CARD_MAP.arrows.damage : 0);
          },
        );

  for (const card of ["hog-rider", "balloon"] as const)
    for (const caster of ["red", "blue"] as const)
      for (const inward of [false, true])
        it(`matches native survival through a lethal Arrows packet (${card}, ${caster}, inward=${inward})`, () => {
          const s = board(card, caster);
          s.body.hp = CARD_MAP.arrows.damage;
          const sign = caster === "red" ? -1 : 1;
          const gap = CARD_MAP.arrows.radius! + s.body.radius;
          s.cast("rage", s.body, s.team);
          s.cast("arrows", {
            x: s.body.x,
            y: s.body.y + sign * (inward ? gap + 0.1 : -gap + 0.1),
          });
          const shot = s.battle.projectiles.at(-1)!;
          const paths = createSpellApproachPaths(
            s.battle.entities,
            s.battle.areas,
            s.battle.projectiles,
            180,
          )!;
          const health = createWindupHealth(
            s.battle.projectiles,
            s.battle.entities,
          ).survival(s.body, paths.frames(s.body)!, s.battle.areas);
          let ticks = 0;
          while (s.battle.projectiles.includes(shot) && ticks < 180) {
            s.battle.step();
            expect(health[ticks++].afterAlive).toBe(s.body.hp > 0);
          }
          expect(s.battle.projectiles).not.toContain(shot);
          expect(s.body.hp).toBe(inward ? 0 : CARD_MAP.arrows.damage);
        });

  it.each([false, true])(
    "checks possible Arrows death effects on another troop (lethal=%s)",
    (lethal) => {
      const s = board("balloon", "red");
      (
        s.battle as unknown as {
          spawn: (card: CardId, team: Team, x: number, y: number) => void;
        }
      ).spawn("lumberjack", s.team, s.body.x, s.body.y);
      const lumberjack = s.battle.entities.at(-1)!;
      Object.assign(lumberjack, {
        active: false,
        deploy: 0,
        hp: lethal ? CARD_MAP.arrows.damage : lumberjack.maxHp,
      });
      s.cast("arrows", s.body);
      const paths = createSpellApproachPaths(
        s.battle.entities,
        s.battle.areas,
        s.battle.projectiles,
        90,
      )!;
      if (lethal) expect(paths(s.body)).toBeUndefined();
      else expect(paths(s.body)).toBeDefined();
      for (let i = 0; i < 90; i++) s.battle.step();
      expect(lumberjack.hp === 0).toBe(lethal);
      expect(s.battle.areas.some((a) => a.card === "rage")).toBe(lethal);
    },
  );

  it.each(["stun", "slow", "knockback", "homing", "source", "style"] as const)(
    "keeps an Arrows packet with unsupported behavior out of the path (%s)",
    (field) => {
      const s = board("balloon", "red");
      s.cast("arrows", s.body);
      const shot = s.battle.projectiles.at(-1)!;
      if (field === "homing") shot.homing = true;
      else if (field === "source") shot.source = 7;
      else if (field === "style") shot.style = "fireball";
      else shot[field] = 1;
      expect(
        createSpellApproachPaths(
          s.battle.entities,
          s.battle.areas,
          s.battle.projectiles,
          90,
        ),
      ).toBeUndefined();
    },
  );

  it("declines a fixed destination that released Arrows can destroy", () => {
    const s = board("balloon", "red");
    const target = s.battle.entities.find(
      (e) => e.team === "red" && !e.king && e.lane === "left",
    )!;
    target.hp = Math.floor(CARD_MAP.arrows.damage * 0.4);
    s.cast("arrows", target, s.team);
    expect(
      createSpellApproachPaths(
        s.battle.entities,
        s.battle.areas,
        s.battle.projectiles,
        90,
      )!(s.body),
    ).toBeUndefined();
    for (let i = 0; i < 90; i++) s.battle.step();
    expect(target.hp).toBe(0);
  });

  it("casts the useful Fireball on tick 74 when the released Arrows will miss the Hog", () => {
    const s = board("hog-rider", "red"),
      b = s.battle;
    Object.assign(s.body, { y: 11, deploy: 2.4, hp: CARD_MAP.fireball.damage });
    (b as unknown as { ai: boolean }).ai = true;
    while (b.tick < 73) b.step();
    s.cast("rage", s.body, s.team);
    s.cast("arrows", { x: 3.5, y: 15 });
    b.players.red.hand = [
      "fireball",
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
    ];
    b.players.red.queue = [
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
      "three-musketeers",
    ];
    b.players.red.elixir = CARD_MAP.fireball.cost;
    while (b.tick < 180) b.step();
    expect(
      b.actions.filter((a) => a.team === "red").map((a) => [a.card, a.tick]),
    ).toEqual([
      ["arrows", 73],
      ["fireball", 74],
    ]);
    expect(s.body.hp).toBe(0);
    const target = b.entities.find(
      (e) => e.team === "red" && !e.king && e.lane === "left",
    )!;
    expect(target.hp).toBe(target.maxHp);
  });
});
