import { describe, expect, it } from "vitest";
import { Battle, type Team, type Point } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { createMovingLightningPlan } from "../src/game/windup-health";
import { kingDeathStep, towerDamageForecast } from "../src/game/king-damage";
import { pendingSpellDamage } from "../src/game/spell-reservations";
import { createLightningFollowup } from "../src/game/lightning-followup";
import { createMatchFinisher } from "../src/game/match-finisher";

function setup(inward: boolean, team: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const enemy = team === "red" ? "blue" : "red";
  const king = battle.entities.find((e) => e.team === enemy && e.king)!;
  king.hp = 300;
  const spawn = (card: CardId, side: Team, point: Point, hp: number) => {
    (
      battle as unknown as {
        spawn: (c: CardId, t: Team, x: number, y: number) => void;
      }
    ).spawn(card, side, point.x, point.y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, { hp, deploy: 0, active: false });
    return body;
  };
  const giant = spawn(
    "giant",
    enemy,
    { x: king.x + 4.25 + (inward ? 0.15 : -0.001), y: king.y },
    400,
  );
  battle.areas.push({
    id: 900,
    card: "tornado",
    team,
    x: inward ? king.x : 17,
    y: king.y,
    radius: 5.5,
    duration: 3.05,
    remaining: 3.05,
    hitAt: 0,
  });
  const cast = (card: CardId, point: Point = king) => {
    battle.players[team].hand[0] = card;
    battle.players[team].elixir = 10;
    expect(battle.play(team, 0, point.x, point.y).ok).toBe(true);
  };
  const step = (count: number) => {
    for (let i = 0; i < count && !battle.winner; i++) battle.step();
  };
  const plan = () =>
    createMovingLightningPlan(
      team,
      battle.entities,
      undefined,
      battle.projectiles,
      battle.areas,
    );
  return { battle, king, giant, team, enemy, spawn, cast, step, plan };
}

describe("proposed Lightning follows current pulls", () => {
  for (const team of ["red", "blue"] as const)
    it.each([false, true])(
      `matches the actual King pulse for ${team} (inward=%s)`,
      (inward) => {
        const s = setup(inward, team);
        const projection = s.plan().project(s.king);
        const deadline = kingDeathStep(
          s.king,
          projection.packets.get(s.king.id) ?? [],
        );
        expect(deadline).toBe(inward ? 29 : 15);
        const forecast = towerDamageForecast(
          s.king,
          s.battle.projectiles,
          s.battle.areas,
          s.battle.entities,
        );
        expect(
          kingDeathStep(
            s.king,
            forecast.withSpell("lightning", s.team, s.king),
          ),
        ).toBe(deadline);
        const finisher = createMatchFinisher(
          s.team,
          s.battle.entities,
          s.battle.projectiles,
          s.battle.areas,
          { blue: 0, red: 0 },
          100,
          false,
        );
        expect(finisher.outcomeAt("lightning", s.king)).toEqual({
          winner: s.team,
          step: deadline,
        });
        expect(
          finisher.evaluate("lightning", s.king, 6, 0)?.matchDecisionStep,
        ).toBe(deadline);
        expect(
          projection.strikes.map((hit) => ({
            id: hit.entity.id,
            step: hit.step,
          })),
        ).toEqual(
          inward
            ? [
                { id: s.giant.id, step: 15 },
                { id: s.king.id, step: 29 },
              ]
            : [{ id: s.king.id, step: 15 }],
        );
        s.cast("lightning");
        s.step(deadline - 1);
        expect(s.battle.winner).toBeNull();
        s.step(1);
        expect(s.battle.winner).toBe(team);
      },
    );

  it("distinguishes centers with the same current members and different future contacts", () => {
    const s = setup(true);
    const plan = s.plan();
    const left = { x: s.king.x - 1.1, y: s.king.y };
    const before = JSON.stringify(s.battle);
    const center = plan.project(s.king);
    const offset = plan.project(left);
    expect(kingDeathStep(s.king, center.packets.get(s.king.id)!)).toBe(29);
    expect(kingDeathStep(s.king, offset.packets.get(s.king.id)!)).toBe(15);
    expect(plan.project(s.king)).toBe(center);
    expect(plan.project(left)).toBe(offset);
    expect(JSON.stringify(s.battle)).toBe(before);
    s.cast("lightning", left);
    s.step(15);
    expect(s.battle.winner).toBe(s.team);
  });

  it("keeps opposing Lightning out of the proposed offensive packet map", () => {
    const s = setup(true);
    const ownKing = s.battle.entities.find((e) => e.king && e.team === s.team)!;
    s.battle.areas.push({
      id: 901,
      card: "lightning",
      team: s.enemy,
      x: ownKing.x,
      y: ownKing.y,
      radius: 3.5,
      duration: 1.5,
      remaining: 0.1,
      hitAt: 1.38,
      struck: [],
    });
    const result = s.plan().project(s.king);
    expect(result.packets.has(ownKing.id)).toBe(false);
    expect(
      result.strikes.every(
        (hit) => hit.area === 2 && hit.entity.team === s.enemy,
      ),
    ).toBe(true);
    expect(kingDeathStep(s.king, result.packets.get(s.king.id)!)).toBe(29);
  });

  it("replaces a supplied area's original slot without adding duplicate pulses", () => {
    const s = setup(true);
    s.cast("lightning");
    const area = s.battle.areas.at(-1)!;
    const plan = createMovingLightningPlan(
      s.team,
      s.battle.entities,
      area,
      s.battle.projectiles,
      s.battle.areas,
    );
    const result = plan.project(s.king);
    expect(result.strikes.map((hit) => hit.area)).toEqual([1, 1]);
    expect(result.packets.get(s.king.id)).toHaveLength(1);
    expect(kingDeathStep(s.king, result.packets.get(s.king.id)!)).toBe(29);
  });

  it("keeps the moving offensive baseline in an irrelevant Lightning counterfactual", () => {
    const s = setup(true);
    s.cast("lightning");
    const forecast = towerDamageForecast(
      s.king,
      s.battle.projectiles,
      s.battle.areas,
      s.battle.entities,
    );
    expect(kingDeathStep(s.king, forecast.baseline)).toBe(29);
    expect(
      kingDeathStep(
        s.king,
        forecast.withSpell("lightning", s.team, { x: 1, y: 16 }),
      ),
    ).toBe(29);
  });

  it.each([false, true])(
    "reserves only bodies selected after the pull (inward=%s)",
    (inward) => {
      const s = setup(inward);
      s.cast("lightning");
      expect(
        pendingSpellDamage(
          s.giant,
          s.team,
          s.battle.projectiles,
          s.battle.areas,
          s.battle.entities,
        ),
      ).toBe(inward ? CARD_MAP.lightning.damage : 0);
      s.step(inward ? 29 : 15);
      expect(s.giant.hp === 0).toBe(inward);
      expect(s.battle.winner).toBe(s.team);
    },
  );

  it("keeps Zap centers distinct when a body enters only one blast before Lightning", () => {
    const s = setup(true);
    s.battle.areas.push({
      id: 901,
      card: "lightning",
      team: s.team,
      x: s.king.x,
      y: s.king.y,
      radius: 3.5,
      duration: 1.5,
      remaining: 0.5,
      hitAt: 1.38,
      struck: [],
    });
    const radius = CARD_MAP.zap.radius! + s.giant.radius + 0.01;
    const y = s.giant.y - Math.sqrt(radius ** 2 - 0.9 ** 2);
    const hit = { x: s.giant.x - 0.9, y },
      miss = { x: s.giant.x + 0.9, y };
    const followup = createLightningFollowup(
      "zap",
      s.team,
      s.battle.entities,
      s.battle.projectiles,
      s.battle.areas,
    );
    expect(kingDeathStep(s.king, followup(hit).get(s.king.id)!)).toBe(13);
    expect(kingDeathStep(s.king, followup(miss).get(s.king.id)!)).toBe(
      Infinity,
    );
    expect(kingDeathStep(s.king, followup(hit).get(s.king.id)!)).toBe(13);
    s.cast("zap", hit);
    s.step(13);
    expect(s.battle.winner).toBe(s.team);
  });

  it("includes Log clearing a future blocker just before the third pulse", () => {
    const s = setup(true, "blue");
    s.giant.hp = 0;
    s.king.hp = s.king.maxHp;
    const tower = s.battle.entities.find(
      (e) =>
        e.team === "red" && !e.king && e.kind === "tower" && e.lane === "left",
    )!;
    tower.hp = 300;
    s.battle.areas[0].x = tower.x;
    s.battle.areas[0].y = tower.y;
    const giant = s.spawn("giant", "red", { x: tower.x, y: 11.2 }, 400);
    s.spawn("knight", "red", { x: tower.x - 0.5, y: 8 }, 900);
    s.spawn("knight", "red", { x: tower.x + 0.5, y: 8 }, 800);
    s.cast("lightning", tower);
    const point = { x: tower.x, y: 17.5 };
    const followup = createLightningFollowup(
      "log",
      "blue",
      s.battle.entities,
      s.battle.projectiles,
      s.battle.areas,
    );
    expect(kingDeathStep(tower, followup(point).get(tower.id)!)).toBe(43);
    expect(
      kingDeathStep(
        tower,
        followup({ x: point.x + 2.5, y: point.y }).get(tower.id)!,
      ),
    ).toBe(Infinity);
    s.cast("log", point);
    s.step(42);
    expect(tower.hp).toBe(300);
    expect(giant.hp).toBe(0);
    s.step(1);
    expect(tower.hp).toBe(0);
    expect(s.battle.players.blue.crowns).toBe(1);
  });
});
