import { CARD_MAP } from "./cards";
import { COMBAT_STEP, HEAL_PER_TICK, combatTraits } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import {
  damagePacketOrder,
  projectileDamagePackets,
  type DamagePacket,
} from "./projectile-impacts";
import {
  projectAreaFrames,
  resolveWindup,
  type WindupFrame,
  type WindupHealthEvaluator,
  type WindupHealthFrame,
} from "./tornado-pull";
import { healthPackets, type HealthPacket } from "./status-health";
import { poisonTickDamage } from "./poison-damage";
import {
  createLightningPlan,
  lightningDamageMap,
  lightningStrikeSteps,
  projectLightningDamage,
} from "./lightning-strikes";
import heal from "./heal-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import tornado from "./tornado-data.json" with { type: "json" };

/** Same area/status/projectile ordering for health traces and final windup
 * survival. Raw packets let Lightning rank all potential targets together. */
function healthProjection(
  attacker: Entity,
  frames: readonly WindupFrame[],
  originalAreas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
  entities: readonly Entity[],
  strikes: readonly DamagePacket[] = [],
  collect = false,
) {
  const path = frames.map((f) => f.position);
  const packets = projectileDamagePackets(
    attacker,
    projectiles,
    entities,
    path,
  ).sort(damagePacketOrder);
  const areas = originalAreas.map((a) => ({ ...a }));
  let hp = attacker.hp,
    shield = attacker.shield ?? 0;
  let healing = attacker.heal ? { ...attacker.heal } : undefined;
  let poisoned = attacker.poison ? { ...attacker.poison } : undefined;
  let cursor = 0,
    deploy = attacker.deploy;
  const events: HealthPacket[] = [];
  const hidden = attacker.deploy <= 0 && attacker.burrow?.phase === "hidden";
  const hurt = (damage: number, bypass = false, bypassHidden = false, bypassDash = false) => {
    if (hp <= 0 || (!bypass && ((!bypassDash && attacker.dash) || (hidden && !bypassHidden)))) return;
    if (shield > 0 && !bypass) shield = Math.max(0, shield - damage);
    else hp = Math.max(0, hp - damage);
  };
  const record = (
    step: number,
    damage: number,
    phase: number,
    order: number,
    bypass = false,
    bypassHidden = false,
    bypassDash = false,
  ) => {
    if (collect)
      events.push({
        step,
        damage,
        phase,
        order,
        born: 0,
        ...(bypass ? { bypassShield: true } : {}),
        ...(bypassHidden ? { bypassHidden: true } : {}),
        ...(bypassDash ? { bypassDash: true } : {}),
      });
    hurt(damage, bypass, bypassHidden, bypassDash);
  };
  const result: WindupHealthFrame[] = [];
  for (const [index, frame] of frames.entries()) {
    const step = index + 1;
    let beforeInterrupt = false;
    areas.forEach((area, areaIndex) => {
      if (area.remaining <= 0) return;
      const position = frame.areaPositions[areaIndex];
      const inside =
        hp > 0 &&
        Math.hypot(position.x - area.x, position.y - area.y) <
          area.radius + attacker.radius;
      const age = area.duration - area.remaining;
      if (area.card === "lightning") {
        for (const hit of strikes) {
          if (hit.step !== step || hit.order !== areaIndex || hp <= 0) continue;
          hurt(hit.damage);
          if (hp > 0 && !attacker.dash && !hidden) beforeInterrupt = true;
        }
      }
      if (
        (area.card === "poison" || area.card === "heal") &&
        age + 1e-8 >= (area.hitAt ?? 0)
      ) {
        area.hitAt =
          (area.hitAt ?? 0) +
          (area.card === "poison"
            ? poison.areaHitInterval
            : heal.areaHitInterval);
        if (
          inside &&
          area.card === "heal" &&
          area.team === attacker.team &&
          attacker.kind === "troop"
        ) {
          healing ??= { remaining: 0, elapsed: 0 };
          healing.remaining = heal.buffDuration;
        }
        if (
          inside &&
          !hidden &&
          area.card === "poison" &&
          area.team !== attacker.team
        ) {
          poisoned ??= { remaining: 0, elapsed: 0 };
          poisoned.remaining = poison.buffDuration;
        }
      }
      if (
        area.card === "tornado" &&
        age + 1e-8 >= (area.damageAt ?? tornado.damageInterval)
      ) {
        area.damageAt =
          (area.damageAt ?? tornado.damageInterval) + tornado.damageInterval;
        if (
          inside &&
          area.team !== attacker.team &&
          attacker.kind === "troop" &&
          !hidden
        )
          record(step, CARD_MAP.tornado.damage, -1, areaIndex);
      }
      area.remaining = Math.max(0, area.remaining - COMBAT_STEP);
      if (area.card !== "ice-golem" && area.remaining < 1e-8)
        area.remaining = 0;
    });
    if (healing) {
      healing.remaining = Math.max(0, healing.remaining - COMBAT_STEP);
      healing.elapsed += COMBAT_STEP;
      if (hp > 0 && healing.elapsed + 1e-8 >= heal.healInterval) {
        healing.elapsed -= heal.healInterval;
        if (collect)
          events.push({
            step,
            damage: HEAL_PER_TICK,
            healing: true,
            phase: -0.5,
            born: 0,
            order: -1,
          });
        hp = Math.min(attacker.maxHp, hp + HEAL_PER_TICK);
      }
      if (healing.remaining < 1e-8 || hp <= 0) healing = undefined;
    }
    if (poisoned && hp > 0) {
      poisoned.remaining = Math.max(0, poisoned.remaining - COMBAT_STEP);
      poisoned.elapsed += COMBAT_STEP;
      if (poisoned.elapsed + 1e-8 >= poison.damageInterval) {
        poisoned.elapsed -= poison.damageInterval;
        record(
          step,
          poisonTickDamage(attacker),
          0,
          -1,
          false,
          !!attacker.nativeRetainedPoison,
          !!attacker.nativeBanditDash,
        );
      }
      if (poisoned.remaining < 1e-8) poisoned = undefined;
    }
    if (deploy > 0) deploy -= COMBAT_STEP;
    else if (attacker.lifetime)
      record(
        step,
        (attacker.maxHp / attacker.lifetime) * COMBAT_STEP,
        0.5,
        -1,
        true,
      );
    const beforeAlive = hp > 0;
    let interrupt = false,
      slow = 0;
    while (cursor < packets.length && packets[cursor].step === step) {
      const packet = packets[cursor++];
      if (hp <= 0) continue;
      if (collect) events.push(packet);
      hurt(packet.damage);
      if (hp <= 0) continue;
      const shot = projectiles[packet.order];
      const push =
        shot.style === "log" ||
        shot.style === "log-launch" ||
        shot.style === "bowler" ||
        (shot.splash > 0 && !!shot.knockback);
      if (
        (shot.splash > 0 && !!shot.stun) ||
        (push &&
          attacker.kind === "troop" &&
          !combatTraits(attacker).ignoresKnockback)
      )
        interrupt = true;
      if (shot.splash > 0 && shot.slow) slow = Math.max(slow, shot.slow);
    }
    result.push({
      beforeAlive,
      beforeInterrupt,
      afterAlive: hp > 0,
      interrupt,
      slow,
    });
  }
  return { statuses: result, events: events.sort(damagePacketOrder) };
}

/** Known health/control changes until this current attack releases. Positions
 * follow projected pulls; no future attacks, death effects or separation run.
 * The survival method reads the full supplied horizon for spell impacts. */
export function createWindupHealth(
  projectiles: readonly Projectile[],
  entities: readonly Entity[],
) {
  const cache = new Map<string, ReturnType<typeof projectLightningDamage>>();
  const normalize = (areas: readonly AreaEffect[]) =>
    JSON.stringify(
      areas.map((a) => (a.card === "freeze" ? { card: "freeze" } : a)),
    );
  type HealthPath = {
    frames?: WindupFrame[];
    position: Point;
    areas: readonly AreaEffect[];
    events?: HealthPacket[];
  };
  const backgrounds = new Map<string, Map<Entity, HealthPath>>();
  const projectLightning = (
    areas: readonly AreaEffect[],
    through = 60,
    proposedIndex?: number,
    additional: ReadonlyMap<number, readonly HealthPacket[]> = new Map(),
  ) => {
    const key = `${through}/${normalize(areas)}/${JSON.stringify([...additional])}`;
    let forecast = cache.get(key);
    if (!forecast) {
      const proposed =
        proposedIndex === areas.length - 1 &&
        areas[proposedIndex]?.card === "tornado"
          ? areas[proposedIndex]
          : undefined;
      const backgroundAreas = proposed ? areas.slice(0, -1) : areas;
      const backgroundKey = JSON.stringify(
        backgroundAreas.map((a) =>
          a.card === "freeze" || a.card === "lightning" ? { card: a.card } : a,
        ),
      );
      let background = backgrounds.get(backgroundKey);
      if (!background) {
        background = new Map();
        backgrounds.set(backgroundKey, background);
      }
      const movingBackground = backgroundAreas.some(
        (a) => a.card === "tornado",
      );
      const paths = new Map<Entity, HealthPath>();
      const dataFor = (body: Entity) => {
        let data = paths.get(body);
        if (data) return data;
        let base = background.get(body);
        if (!base) {
          base = {
            ...(movingBackground
              ? { frames: projectAreaFrames(body, backgroundAreas, 60) }
              : {}),
            position: { x: body.x, y: body.y },
            areas: backgroundAreas,
          };
          background.set(body, base);
        }
        const affected =
          proposed &&
          body.team !== proposed.team &&
          body.kind === "troop" &&
          !(body.deploy <= 0 && body.burrow?.phase === "hidden") &&
          (base.frames
            ? base.frames
                .slice(0, through)
                .some(
                  (frame) =>
                    Math.hypot(
                      frame.position.x - proposed.x,
                      frame.position.y - proposed.y,
                    ) <
                    proposed.radius + body.radius,
                )
            : Math.hypot(body.x - proposed.x, body.y - proposed.y) <
              proposed.radius + body.radius);
        if (affected) {
          const bodyFrames = projectAreaFrames(body, areas, through);
          data = { frames: bodyFrames, position: base.position, areas };
        } else data = base;
        paths.set(body, data);
        return data;
      };
      forecast = projectLightningDamage(
        entities,
        areas,
        (body) => {
          const data = dataFor(body);
          data.events ??= data.frames
            ? healthProjection(
                body,
                data.frames,
                data.areas,
                projectiles,
                entities,
                [],
                true,
              ).events
            : healthPackets(body, projectiles, data.areas, entities, 2);
          const extra = additional.get(body.id);
          return extra?.length
            ? [...data.events, ...extra].sort(damagePacketOrder)
            : data.events;
        },
        (body, step, area) => {
          const data = dataFor(body);
          return data.frames?.[step - 1].areaPositions[area] ?? data.position;
        },
        through,
      );
      cache.set(key, forecast);
    }
    return forecast;
  };
  const lightning = (...args: Parameters<typeof projectLightning>) =>
    projectLightning(...args).packets;
  // Spell impacts can arrive after a current attack has already released.
  // Keep their survival horizon independent of the windup-only shortcut.
  const survival = (
    body: Entity,
    frames: readonly WindupFrame[],
    areas: readonly AreaEffect[],
  ) => {
    const strikes = areas.some(
      (a) => a.card === "lightning" && a.team !== body.team && a.remaining > 0,
    )
      ? (lightning(areas, Math.min(60, frames.length)).get(body.id) ?? [])
      : [];
    return healthProjection(body, frames, areas, projectiles, entities, strikes)
      .statuses;
  };
  const evaluate: WindupHealthEvaluator = (
    attacker,
    frames,
    areas,
    proposedIndex,
  ) => {
    const baseline = healthProjection(
      attacker,
      frames,
      areas,
      projectiles,
      entities,
    ).statuses;
    if (!areas.some((a) => a.card === "lightning" && a.team !== attacker.team))
      return baseline;
    const target = entities.find(
      (e) => e.id === attacker.pendingAttack?.target,
    );
    const attempt = target
      ? resolveWindup(attacker, target, frames, baseline)
      : undefined;
    const through =
      attempt?.releaseStep ?? attempt?.cancelledStep ?? frames.length;
    const nearby = areas.some(
      (area, index) =>
        area.card === "lightning" &&
        area.team !== attacker.team &&
        lightningStrikeSteps(area).some(
          (step) =>
            step <= through &&
            Math.hypot(
              frames[step - 1].areaPositions[index].x - area.x,
              frames[step - 1].areaPositions[index].y - area.y,
            ) <
              area.radius + attacker.radius,
        ),
    );
    if (!nearby) return baseline;
    const strikes =
      lightning(areas, through, proposedIndex).get(attacker.id) ?? [];
    return healthProjection(
      attacker,
      frames,
      areas,
      projectiles,
      entities,
      strikes,
    ).statuses;
  };
  return Object.assign(evaluate, { lightning, projectLightning, survival });
}

/** Released Lightning follows current pulls; boards without Tornado retain
 * the fixed-position projection and its existing fast path. */
export function currentLightningDamage(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[] = [],
) {
  return areas.some((a) => a.card === "tornado" && a.remaining > 0)
    ? createWindupHealth(projectiles, entities).lightning(areas)
    : lightningDamageMap(entities, areas, projectiles);
}

/** Proposed Lightning shares current pull and health paths with its baseline. */
export function createMovingLightningPlan(
  team: Team,
  entities: readonly Entity[],
  area?: AreaEffect,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
) {
  const context = areas.some((a) => a.card === "tornado" && a.remaining > 0)
    ? createWindupHealth(projectiles, entities)
    : undefined;
  return createLightningPlan(
    team,
    entities,
    area,
    projectiles,
    areas,
    context ? (clouds) => context.projectLightning(clouds) : undefined,
  );
}
