import { COMBAT_STEP, SPELL_CROWN_TOWER_DAMAGE_FRACTION } from "./combat";
import type { Entity, Point, Projectile } from "./engine";
import bowler from "./bowler-data.json" with { type: "json" };
import executioner from "./executioner-data.json" with { type: "json" };
import log from "./log-data.json" with { type: "json" };

export interface DamagePacket {
  step: number;
  damage: number;
  phase: number;
  born: number;
  order: number;
}
export const impactSteps = (time: number) =>
  Math.max(1, Math.ceil((time - 1e-8) / COMBAT_STEP));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const touch = (from: Point, to: Point, target: Entity, radius: number) => {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const segment = dx * dx + dy * dy;
  const t =
    segment > 0
      ? clamp(((target.x - from.x) * dx + (target.y - from.y) * dy) / segment)
      : 0;
  return (
    Math.hypot(target.x - (from.x + dx * t), target.y - (from.y + dy * t)) <=
    radius + target.radius
  );
};

/** Damage from current projectiles against a fixed body or its supplied
 * per-step path. Homing shots aimed at another troop are omitted; inputs stay
 * untouched. Path positions are after areas and before projectile updates. */
export function projectileDamagePackets(
  target: Entity,
  projectiles: readonly Projectile[],
  entities?: readonly Entity[],
  path?: readonly Point[],
): DamagePacket[] {
  const one = (p: Projectile, order: number, offset = 0): DamagePacket[] => {
    if (
      p.team === target.team ||
      p.damage <= 0 ||
      (!p.air && target.air) ||
      p.remaining <= 0 ||
      ["miner-travel", "rage-bottle", "goblin-barrel"].includes(p.style)
    )
      return [];
    const delay = p.delay && p.delay > 1e-8 ? impactSteps(p.delay) : 0;
    const packet = (step: number, damage: number, born = 0): DamagePacket => ({
      step: step + delay + offset,
      damage,
      phase: 1,
      born,
      order,
    });
    const locked =
      p.target === target.id
        ? target
        : entities?.find(
            (e) =>
              e.id === p.target &&
              e.hp > 0 &&
              !(e.deploy <= 0 && e.burrow?.phase === "hidden"),
          );
    if (
      p.homing &&
      p.target !== target.id &&
      (!entities || locked?.kind === "troop")
    )
      return [];
    let end =
      p.homing && locked ? { x: locked.x, y: locked.y } : { x: p.tx, y: p.ty };
    const duration =
      p.speed && p.flight ? distance(p.flight, end) / p.speed : p.remaining;
    let arrival = impactSteps(duration);
    if (path && p.homing && p.target === target.id && p.speed && p.flight) {
      let position = { ...p.flight };
      let arrived = false;
      for (let step = 1; offset + delay + step <= path.length; step++) {
        const destination = path[offset + delay + step - 1];
        const gap = distance(position, destination);
        const travel = Math.min(gap, p.speed * COMBAT_STEP);
        if (gap > 0)
          position = {
            x: position.x + ((destination.x - position.x) / gap) * travel,
            y: position.y + ((destination.y - position.y) / gap) * travel,
          };
        if ((gap - travel) / p.speed <= 1e-8) {
          arrival = step;
          end = destination;
          arrived = true;
          break;
        }
      }
      if (!arrived) return [];
    } else if (path && p.homing && p.target === target.id) {
      end = path[offset + delay + arrival - 1] ?? end;
    }
    if (p.style === "log-launch") {
      const range = Math.min(
        log.rollingRange,
        p.team === "blue" ? p.ty - 0.6 : 31.4 - p.ty,
      );
      if (range <= 0) return [];
      const child: Projectile = {
        ...p,
        x: p.tx,
        y: p.ty,
        tx: p.tx,
        ty: p.ty + (p.team === "blue" ? -range : range),
        target: null,
        remaining: range / log.rollingSpeed,
        duration: range / log.rollingSpeed,
        speed: log.rollingSpeed,
        flight: { x: p.tx, y: p.ty },
        style: "log",
        delay: undefined,
        rollHits: [],
      };
      return one(child, order, offset + delay + arrival).map((hit) => ({
        ...hit,
        born: offset + delay + arrival,
      }));
    }
    if (["log", "bowler", "executioner"].includes(p.style)) {
      const speed = p.speed!;
      if (!(speed > 0)) return [];
      let position = { ...(p.flight ?? { x: p.x, y: p.y }) };
      let destination = { ...end },
        returning = !!p.returning;
      let struck = !!p.rollHits?.includes(target.id);
      const axe = p.style === "executioner";
      const limit =
        impactSteps(
          (distance(position, destination) +
            (axe && !returning ? distance(destination, p) : 0)) /
            speed,
        ) + 3;
      const result: DamagePacket[] = [];
      for (let step = 1; step <= limit; step++) {
        if (path && offset + delay + step > path.length) break;
        const body = path
          ? { ...target, ...path[offset + delay + step - 1] }
          : target;
        const gap = distance(position, destination),
          travel = Math.min(gap, speed * COMBAT_STEP);
        const next =
          gap > 0
            ? {
                x: position.x + ((destination.x - position.x) / gap) * travel,
                y: position.y + ((destination.y - position.y) / gap) * travel,
              }
            : { ...position };
        const hit =
          p.style === "log"
            ? Math.abs(body.x - p.x) < log.collisionHalfWidth + target.radius &&
              body.y >=
                Math.min(position.y, next.y) -
                  log.collisionRadius -
                  target.radius &&
              body.y <=
                Math.max(position.y, next.y) +
                  log.collisionRadius +
                  target.radius
            : touch(
                position,
                next,
                body,
                axe ? executioner.projectile.radius : bowler.projectile.radius,
              );
        if (!struck && hit) {
          result.push(
            packet(
              step,
              p.damage *
                (p.style === "log" && target.kind === "tower"
                  ? log.crownTowerDamageFraction
                  : 1),
            ),
          );
          struck = true;
        }
        position = next;
        if ((gap - travel) / speed <= 1e-8) {
          if (!axe || returning) break;
          returning = true;
          struck = false;
          destination = { x: p.x, y: p.y };
        }
      }
      return result;
    }
    if (path && offset + delay + arrival > path.length) return [];
    const body = path
      ? { ...target, ...path[offset + delay + arrival - 1] }
      : target;
    if (
      p.splash > 0
        ? distance(end, body) >= p.splash + target.radius
        : p.target !== target.id
    )
      return [];
    return [
      packet(
        arrival,
        p.damage *
          (p.splash > 0 && p.source === 0 && target.kind === "tower"
            ? (p.towerDamageFraction ?? SPELL_CROWN_TOWER_DAMAGE_FRACTION)
            : 1),
      ),
    ];
  };
  return projectiles.flatMap((p, order) => one(p, order));
}

export const damagePacketOrder = (a: DamagePacket, b: DamagePacket) =>
  a.step - b.step || a.phase - b.phase || a.born - b.born || a.order - b.order;
