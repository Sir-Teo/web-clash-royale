import { CARD_MAP } from "./cards";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { attackFlight } from "./attack-flight";
import { kingDeathStep, towerDamageForecast } from "./king-damage";
import {
  projectileDamagePackets,
  type DamagePacket,
} from "./projectile-impacts";
import { projectTornadoWindup, type WindupProjection } from "./tornado-pull";
import miner from "./miner-data.json" with { type: "json" };
import freeze from "./freeze-data.json" with { type: "json" };

/** Complete current attack packet, including both Executioner passes. The
 * release frame already advances a projectile; melee precedes projectiles. */
export function pendingKingPackets(
  attacker: Entity,
  king: Entity,
  projection: WindupProjection,
  order: number,
): DamagePacket[] {
  const release = projection.releaseStep;
  if (release === undefined || !attacker.pendingAttack) return [];
  const actor = { ...attacker, ...projection.position };
  const damage =
    attacker.card === "miner"
      ? Math.round(
          attacker.pendingAttack.damage * miner.crownTowerDamageFraction,
        )
      : attacker.pendingAttack.damage;
  const flight = attackFlight(actor, king);
  if (!flight) return [{ step: release, damage, phase: 0.75, born: 0, order }];
  const rolling = actor.card === "bowler" || actor.card === "executioner";
  const shot: Projectile = {
    id: -1,
    team: actor.team,
    source: actor.id,
    x: rolling ? actor.x : flight.start.x,
    y: rolling ? actor.y : flight.start.y,
    tx: flight.end.x,
    ty: flight.end.y,
    target: rolling ? null : king.id,
    damage,
    remaining: flight.duration,
    duration: flight.duration,
    splash: 0,
    air: true,
    style: actor.card,
    stun: 0,
    flight: flight.start,
    speed: flight.speed,
    homing: !rolling,
    rollHits: [],
  };
  return projectileDamagePackets(king, [shot]).map((packet) => ({
    ...packet,
    step: release + packet.step - 1,
    // Combat creates pending shots before children born in projectile updates.
    born: release - 0.25,
    order,
  }));
}

export interface KingDefenseResult {
  baseline: number;
  deathStep: number;
  improves: boolean;
  worsens: boolean;
}
export function kingDefenseScore(
  result: KingDefenseResult,
  cost: number,
  value: number,
) {
  return (
    9_000 -
    cost +
    (Number.isFinite(result.deathStep)
      ? Math.min(80, result.deathStep - result.baseline)
      : 100) +
    Math.min(10, value)
  );
}

/** One read-only context per decision: released damage plus every eligible
 * current King windup. No new attacks, attacker health or separation is run. */
export function createKingDefense(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
  knownEndingStep = Infinity,
) {
  const king = entities.find((e) => e.hp > 0 && e.team === team && e.king);
  const released = king
    ? towerDamageForecast(king, projectiles, areas, entities).baseline
    : [];
  const attempts = king
    ? entities.flatMap((attacker, index) => {
        const pending = attacker.pendingAttack;
        if (
          attacker.team === team ||
          attacker.hp <= 0 ||
          !attacker.active ||
          attacker.deploy > 0 ||
          attacker.stun > 0 ||
          attacker.dash ||
          (attacker.deploy <= 0 && attacker.burrow?.phase === "hidden") ||
          !pending ||
          pending.target !== king.id ||
          pending.damage <= 0 ||
          pending.remaining > 1
        )
          return [];
        const projection = projectTornadoWindup(attacker, king, areas);
        const order = projectiles.length + index;
        return [
          {
            attacker,
            order,
            packets: pendingKingPackets(attacker, king, projection, order),
          },
        ];
      })
    : [];
  const baseline = king
    ? kingDeathStep(king, [...released, ...attempts.flatMap((a) => a.packets)])
    : Infinity;
  const opposingKing = entities.find(
    (e) => e.hp > 0 && e.team !== team && e.king,
  );
  const endingStep = Math.min(
    knownEndingStep,
    opposingKing
      ? kingDeathStep(
          opposingKing,
          towerDamageForecast(opposingKing, projectiles, areas, entities)
            .baseline,
        )
      : Infinity,
  );
  const atRisk = Number.isFinite(baseline) && baseline <= endingStep;
  const threats = atRisk
    ? attempts.filter((a) => a.packets.some((p) => p.step <= baseline))
    : [];
  const cache = new Map<string, KingDefenseResult>();
  const evaluate = (
    card: "freeze" | "tornado",
    point: Point,
  ): KingDefenseResult => {
    if (!king || !attempts.length)
      return { baseline, deathStep: baseline, improves: false, worsens: false };
    const clouds =
      card === "freeze"
        ? [
            ...areas,
            {
              id: -1,
              card: "freeze" as const,
              team,
              x: point.x,
              y: point.y,
              radius: CARD_MAP.freeze.radius!,
              duration: freeze.duration,
              remaining: freeze.duration,
            },
          ]
        : areas;
    const pending = attempts.map((a) =>
      pendingKingPackets(
        a.attacker,
        king,
        projectTornadoWindup(
          a.attacker,
          king,
          clouds,
          card === "tornado" ? point : undefined,
        ),
        a.order,
      ),
    );
    const key = pending
      .map((packets) => packets.map((p) => p.step).join(","))
      .join("/");
    const known = cache.get(key);
    if (known) return known;
    const deathStep = kingDeathStep(king, [...released, ...pending.flat()]);
    const result = {
      baseline,
      deathStep,
      improves: atRisk && deathStep > baseline,
      worsens: deathStep < baseline,
    };
    cache.set(key, result);
    return result;
  };
  return { baseline, endingStep, attempts, threats, evaluate };
}
export type KingDefense = ReturnType<typeof createKingDefense>;
