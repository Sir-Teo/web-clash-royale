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
import { infernoKingPackets } from "./inferno-forecast";
import { createWindupHealth } from "./windup-health";
import tornado from "./tornado-data.json" with { type: "json" };
import { electroExtraTarget } from "./electro-bolts";

/** Complete current attack packet, including both Executioner passes and the
 * rules-43 first-update delay. Melee precedes projectiles. */
export function pendingKingPackets(
  attacker: Entity,
  king: Entity,
  projection: WindupProjection,
  order: number,
  entities: readonly Entity[] = [king],
  primary: Entity = king,
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
  if (actor.card === "electro-wizard" && actor.nativeExtraTargets) {
    const extra = electroExtraTarget(actor, primary, entities);
    return [primary, extra].filter((victim) => victim?.id === king.id)
      .map(() => ({ step: release, damage, phase: 0.75, born: 0, order }));
  }
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
    step: release + packet.step - 1 + (actor.nativeProjectileStep ? 1 : 0),
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
 * current King windup or uninterrupted Inferno lock. No new attacks or separation
 * is run; channels use the shared two-second defensive horizon. */
export function createKingDefense(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
  knownEndingStep = Infinity,
  version = 23,
) {
  const king = entities.find((e) => e.hp > 0 && e.team === team && e.king);
  const health = createWindupHealth(projectiles, entities);
  // The shared health context below supplies the King's Lightning packets.
  const released = king
    ? towerDamageForecast(king, projectiles, areas, entities, new Map())
    : undefined;
  const tracksLightning = areas.some(
    (a) => a.card === "lightning" && a.team !== team && a.remaining > 0,
  );
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
          (attacker.deploy <= 0 && attacker.burrow?.phase === "hidden")
        )
          return [];
        const channel =
          (attacker.card === "inferno-tower" ||
            attacker.card === "inferno-dragon") &&
          attacker.inferno?.target === king.id &&
          attacker.target === king.id;
        const nativeElectro = attacker.card === "electro-wizard" && attacker.nativeExtraTargets;
        const target = nativeElectro
          ? entities.find((entity) => entity.id === pending?.target && entity.hp > 0)
          : king;
        if (
          !channel &&
          (!pending ||
            (!nativeElectro && pending.target !== king.id) ||
            !target ||
            pending.damage <= 0 ||
            pending.remaining > 1)
        )
          return [];
        if (!target) return [];
        const projection = projectTornadoWindup(
          attacker,
          target,
          areas,
          undefined,
          health,
        );
        const order = projectiles.length + index;
        return [
          {
            attacker,
            target,
            order,
            channel,
            packets: channel
              ? infernoKingPackets(attacker, king, areas, order, health, undefined, version)
              : pendingKingPackets(attacker, king, projection, order, entities, target),
          },
        ];
      })
    : [];
  const deathWith = (
    pending: DamagePacket[],
    projectionAreas = areas,
    proposedIndex?: number,
  ) => {
    if (!king || !released) return Infinity;
    // A surviving hit before a pulse changes current HP and can redirect it.
    // Evaluate the original and proposed timelines independently; same-step
    // Combat and projectile packets remain after Lightning's area phase.
    const packets = tracksLightning
      ? [
          ...released.withoutLightning,
          ...(health
            .lightning(
              projectionAreas,
              60,
              proposedIndex,
              new Map([[king.id, pending]]),
            )
            .get(king.id) ?? []),
        ]
      : released.baseline;
    return kingDeathStep(king, [...packets, ...pending]);
  };
  const baseline = deathWith(attempts.flatMap((a) => a.packets));
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
      a.channel
        ? infernoKingPackets(
            a.attacker,
            king,
            clouds,
            a.order,
            health,
            card === "tornado" ? point : undefined,
            version,
          )
        : pendingKingPackets(
            a.attacker,
            king,
            projectTornadoWindup(
              a.attacker,
              a.target,
              clouds,
              card === "tornado" ? point : undefined,
              health,
            ),
            a.order,
            entities,
            a.target,
          ),
    );
    const key = pending
      .map((packets) => packets.map((p) => p.step).join(","))
      .join("/");
    const known = cache.get(key);
    if (known) return known;
    const projectionAreas =
      card === "tornado"
        ? [
            ...areas,
            {
              id: -1,
              card: "tornado" as const,
              team,
              x: point.x,
              y: point.y,
              radius: tornado.radius,
              duration: tornado.duration,
              remaining: tornado.duration,
              hitAt: 0,
            },
          ]
        : clouds;
    const deathStep = deathWith(
      pending.flat(),
      projectionAreas,
      card === "tornado" ? projectionAreas.length - 1 : undefined,
    );
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
