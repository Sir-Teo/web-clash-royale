import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import lightning from "./lightning-data.json" with { type: "json" };
import { CARD_MAP } from "./cards";
import { damagePacketOrder, type DamagePacket } from "./projectile-impacts";
import { healthPackets, type HealthPacket } from "./status-health";

const eligible = (e: Entity, team: Team, struck: readonly number[]) =>
  e.hp > 0 &&
  e.team !== team &&
  !(e.deploy <= 0 && e.burrow?.phase === "hidden") &&
  !struck.includes(e.id);
const order = (a: Entity, b: Entity) => b.hp - a.hp || a.id - b.id;
const contains = (point: Point, e: Entity, radius: number) =>
  Math.hypot(e.x - point.x, e.y - point.y) < radius + e.radius;

/** Exact live-pulse eligibility, current-health priority and ID tie break. */
export function selectLightningTarget(
  team: Team,
  point: Point,
  radius: number,
  entities: readonly Entity[],
  struck: readonly number[],
) {
  return entities
    .filter((e) => eligible(e, team, struck) && contains(point, e, radius))
    .sort(order)[0];
}

function strikeSteps(area: AreaEffect) {
  let remaining = area.remaining;
  let next = area.hitAt ?? lightning.strikeInterval;
  const steps: number[] = [];
  for (let step = 1; remaining > 1e-8; step++) {
    if (area.duration - remaining + 1e-8 >= next) {
      steps.push(step);
      next += lightning.strikeInterval;
    }
    remaining = Math.max(0, remaining - COMBAT_STEP);
  }
  return steps;
}

interface ProjectedStrike {
  entity: Entity;
  step: number;
  hp: number;
  shield: number;
  area: number;
  damage: number;
}
interface Projection {
  strikes: ProjectedStrike[];
  packets: Map<number, DamagePacket[]>;
}
const damageFor = (e: Entity) =>
  CARD_MAP.lightning.damage *
  (e.kind === "tower" ? lightning.crownTowerDamageFraction : 1);
const hidden = (e: Entity) => e.deploy <= 0 && e.burrow?.phase === "hidden";
function apply(body: Entity, packet: HealthPacket) {
  if (body.hp <= 0) return;
  if (packet.healing) body.hp = Math.min(body.maxHp, body.hp + packet.damage);
  else if (packet.bypassShield) body.hp = Math.max(0, body.hp - packet.damage);
  else if (!body.dash && !hidden(body)) {
    if ((body.shield ?? 0) > 0)
      body.shield = Math.max(0, body.shield! - packet.damage);
    else body.hp = Math.max(0, body.hp - packet.damage);
  }
}
function append(result: Projection, strike: ProjectedStrike) {
  result.strikes.push(strike);
  const hits = result.packets.get(strike.entity.id) ?? [];
  hits.push({
    step: strike.step,
    damage: strike.damage,
    phase: -1,
    born: 0,
    order: strike.area,
  });
  result.packets.set(strike.entity.id, hits);
}
function healthContext(
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
) {
  const horizon = Math.max(
    lightning.duration,
    ...areas.filter((a) => a.card === "lightning").map((a) => a.remaining),
  );
  const cache = new Map<Entity, HealthPacket[]>();
  return (body: Entity) => {
    let events = cache.get(body);
    if (!events) {
      events = healthPackets(body, projectiles, areas, entities, horizon);
      cache.set(body, events);
    }
    return events;
  };
}
function projectAreas(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  eventsFor: ReturnType<typeof healthContext>,
): Projection {
  const live = areas
    .map((area, index) => ({ area, index }))
    .filter(({ area }) => area.card === "lightning" && area.remaining > 0);
  const result: Projection = { strikes: [], packets: new Map() };
  if (!live.length) return result;
  const slots = live
    .flatMap(({ area, index }) =>
      strikeSteps(area).map((step) => ({ step, index, area })),
    )
    .sort((a, b) => a.step - b.step || a.index - b.index);
  const states = entities
    .filter((e) =>
      live.some(
        ({ area }) =>
          eligible(e, area.team, area.struck ?? []) &&
          contains(area, e, area.radius),
      ),
    )
    .map((entity) => ({
      entity,
      body: { ...entity },
      cursor: 0,
      events: eventsFor(entity),
    }));
  const bodies = states.map((s) => s.body);
  const byId = new Map(states.map((s) => [s.body.id, s]));
  const struck = new Map(
    live.map(({ area, index }) => [index, [...(area.struck ?? [])]]),
  );
  for (const slot of slots) {
    for (const state of states) {
      while (
        state.cursor < state.events.length &&
        state.events[state.cursor].step < slot.step
      )
        apply(state.body, state.events[state.cursor++]);
    }
    const history = struck.get(slot.index)!;
    const target = selectLightningTarget(
      slot.area.team,
      slot.area,
      slot.area.radius,
      bodies,
      history,
    );
    if (!target) continue;
    history.push(target.id);
    const state = byId.get(target.id)!;
    const damage = target.dash || hidden(target) ? 0 : damageFor(target);
    append(result, {
      entity: state.entity,
      step: slot.step,
      hp: target.hp,
      shield: target.shield ?? 0,
      area: slot.index,
      damage,
    });
    apply(target, {
      step: slot.step,
      damage,
      phase: -1,
      born: 0,
      order: slot.index,
    });
  }
  return result;
}

/** Fixed-position health projection. Released projectiles, current status
 * clocks and earlier Lightning pulses can change the next selected body. */
export function createLightningPlan(
  team: Team,
  entities: readonly Entity[],
  area?: AreaEffect,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
) {
  const template: AreaEffect = area ?? {
    id: -1,
    card: "lightning",
    team,
    x: 0,
    y: 0,
    radius: lightning.radius,
    duration: lightning.duration,
    remaining: lightning.duration,
    hitAt: lightning.strikeInterval,
    struck: [],
  };
  const current = areas.filter(
    (a) => a.card === "lightning" && a.team === team && a.remaining > 0,
  );
  let index = area ? current.findIndex((a) => a.id === area.id) : -1;
  if (index < 0) index = current.length;
  const ordered = entities
    .filter((e) => eligible(e, team, template.struck ?? []))
    .sort(order);
  const eventsFor = healthContext(entities, projectiles, areas);
  const cache = new Map<string, Projection>();
  const project = (point: Point, radius = template.radius): Projection => {
    const members = ordered.filter((e) => contains(point, e, radius));
    const key = members.map((e) => e.id).join(",");
    const known = cache.get(key);
    if (known) return known;
    const proposed = { ...template, x: point.x, y: point.y, radius };
    const combined = [...current];
    combined[index] = proposed;
    let result: Projection;
    if (
      combined.length === 1 &&
      members.every((e) => eventsFor(e).length === 0)
    ) {
      result = { strikes: [], packets: new Map() };
      const steps = strikeSteps(proposed);
      members
        .slice(0, steps.length)
        .forEach((entity, i) =>
          append(result, {
            entity,
            step: steps[i],
            hp: entity.hp,
            shield: entity.shield ?? 0,
            area: index,
            damage: entity.dash ? 0 : damageFor(entity),
          }),
        );
    } else result = projectAreas(entities, combined, eventsFor);
    const selection = {
      ...result,
      strikes: result.strikes.filter((hit) => hit.area === index),
    };
    cache.set(key, selection);
    return selection;
  };
  return Object.assign(
    (point: Point, radius = template.radius) => project(point, radius).strikes,
    { project },
  );
}

export const lightningStrikes = (
  team: Team,
  point: Point,
  entities: readonly Entity[],
  area?: AreaEffect,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
) =>
  createLightningPlan(
    team,
    entities,
    area,
    projectiles,
    areas,
  )(point, area?.radius);

/** Reuse released health timelines while testing counterfactual pending hits.
 * Additional packets affect selection only before a pulse, never on its frame.
 * They are inputs to ranking, not part of the returned Lightning damage. */
export function createLightningDamageForecast(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[] = [],
) {
  const eventsFor = healthContext(entities, projectiles, areas);
  return (
    additional: ReadonlyMap<number, readonly HealthPacket[]> = new Map(),
  ) =>
    projectAreas(entities, areas, (body) => {
      const extra = additional.get(body.id);
      return extra?.length
        ? [...eventsFor(body), ...extra].sort(damagePacketOrder)
        : eventsFor(body);
    }).packets;
}

/** Prepare each area's selection once for a whole-board decision. */
export function lightningDamageMap(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[] = [],
  additional: ReadonlyMap<number, readonly HealthPacket[]> = new Map(),
) {
  return createLightningDamageForecast(
    entities,
    areas,
    projectiles,
  )(additional);
}
