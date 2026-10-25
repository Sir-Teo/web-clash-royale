import type { CardId } from "./cards";
import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { towerDamageForecast, towerDamageState } from "./king-damage";
import type { DamagePacket } from "./projectile-impacts";
import poison from "./poison-data.json" with { type: "json" };

interface Ending {
  winner: Team | "draw";
  step: number;
}

/** Overtime endings from released damage and the proposed spell. Troop
 * movement and future attacks are deliberately outside this forecast. */
export function createMatchFinisher(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  crowns: Readonly<Record<Team, number>>,
  remaining: number,
) {
  const enemy = team === "red" ? "blue" : "red";
  // Include the final clock only when it falls within the damage horizon.
  const horizon = Math.ceil(
    (poison.duration + poison.buffDuration) / COMBAT_STEP,
  );
  const clock = Math.max(1, Math.ceil((remaining - 1e-8) / COMBAT_STEP));
  let nextId = 0;
  const towers = entities
    .filter((e) => e.kind === "tower" && e.hp > 0)
    .map((e) => {
      const forecast = towerDamageForecast(e, projectiles, areas, entities);
      const cache = new Map<
        readonly DamagePacket[],
        {
          id: number;
          death: number;
          finalHp: number;
        }
      >();
      const state = (packets: readonly DamagePacket[]) => {
        let result = cache.get(packets);
        if (!result) {
          result = {
            id: nextId++,
            death: towerDamageState(e, packets).deathStep,
            finalHp: towerDamageState(e, packets, clock).hp,
          };
          cache.set(packets, result);
        }
        return result;
      };
      return { entity: e, forecast, state };
    });
  type States = ReturnType<(typeof towers)[number]["state"]>[];
  const endings = new Map<string, Ending | undefined>();
  const ending = (states: States): Ending | undefined => {
    const key = states.map((s) => s.id).join(":");
    if (endings.has(key)) return endings.get(key);
    const events = new Set(
      states.map((s) => s.death).filter((s) => s <= horizon),
    );
    if (crowns.blue !== crowns.red) events.add(1);
    if (clock <= horizon) events.add(clock);
    let result: Ending | undefined;
    for (const step of [...events].sort((a, b) => a - b)) {
      const deadKing = (side: Team) =>
        towers.some(
          (t, i) =>
            t.entity.king && t.entity.team === side && states[i].death <= step,
        );
      const blueKing = deadKing("blue"),
        redKing = deadKing("red");
      if (blueKing || redKing) {
        result = {
          winner: blueKing && redKing ? "draw" : blueKing ? "red" : "blue",
          step,
        };
        break;
      }
      const score = { ...crowns };
      towers.forEach((t, i) => {
        if (!t.entity.king && states[i].death <= step)
          score[t.entity.team === "red" ? "blue" : "red"]++;
      });
      if (score.blue !== score.red) {
        result = { winner: score.blue > score.red ? "blue" : "red", step };
        break;
      }
      if (step === clock) {
        const lowest = (side: Team) =>
          Math.min(
            ...towers.flatMap((t, i) =>
              t.entity.team === side && states[i].death > step
                ? [states[i].finalHp]
                : [],
            ),
          );
        const blue = lowest("blue"),
          red = lowest("red");
        result = {
          winner:
            Math.abs(blue - red) < 0.01 ? "draw" : blue > red ? "blue" : "red",
          step,
        };
        break;
      }
    }
    endings.set(key, result);
    return result;
  };
  const baseline = ending(towers.map((t) => t.state(t.forecast.baseline)));
  const outcomeAt = (card: CardId, point: Point) =>
    ending(towers.map((t) => t.state(t.forecast.withSpell(card, team, point))));
  return {
    baseline,
    outcomeAt,
    evaluate(card: CardId, point: Point, cost: number, value: number) {
      const proposal = outcomeAt(card, point);
      const wins =
        proposal?.winner === team &&
        (baseline?.winner !== team || proposal.step < baseline.step);
      const draws = proposal?.winner === "draw" && baseline?.winner === enemy;
      const survives = !proposal && baseline?.winner === enemy;
      if (!wins && !draws && !survives) return;
      const step = proposal?.step ?? baseline!.step;
      return {
        score:
          (wins ? 30_000 : draws ? 20_000 : 15_000) -
          step * 16 -
          cost +
          Math.min(0.1, value * 0.001),
        matchDecisionStep: proposal?.step ?? Infinity,
      };
    },
  };
}

export type MatchFinisher = ReturnType<typeof createMatchFinisher>;
