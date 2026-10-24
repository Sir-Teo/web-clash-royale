import * as T from "three";
import type { Entity, Projectile } from "../game/engine";
import { sphere } from "./models";
import { EffectLibrary } from "./effects";
import type { EffectSprite } from "./effects";
import { arrowOffsets } from "./arrow-volley";

export interface ProjectileVisual {
  object: T.Group;
  sprites: EffectSprite[];
}
export function rocketFlightPoint(p: Projectile, seconds: number) {
  const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / (p.speed ?? 1);
  const t = T.MathUtils.clamp(seconds / Math.max(duration, 1e-8), 0, 1);
  return new T.Vector3(
    T.MathUtils.lerp(p.x, p.tx, t) - 9,
    T.MathUtils.lerp(p.fromHeight ?? 2.4, p.toHeight ?? 0.2, t) +
      Math.sin(t * Math.PI) * (p.arc ?? 6),
    T.MathUtils.lerp(p.y, p.ty, t) - 16,
  );
}
export function logFlightPoint(p: Projectile, seconds: number) {
  const t = T.MathUtils.clamp(seconds / p.duration, 0, 1);
  return new T.Vector3(p.x - 9, 0.45, T.MathUtils.lerp(p.y, p.ty, t) - 16);
}
export function curvedFlightPoint(p: Projectile, seconds: number) {
  const duration = Math.hypot(p.tx - p.x, p.ty - p.y) / (p.speed ?? 1);
  const t = T.MathUtils.clamp(seconds / Math.max(duration, 1e-8), 0, 1);
  return new T.Vector3(
    T.MathUtils.lerp(p.x, p.tx, t) - 9,
    T.MathUtils.lerp(p.fromHeight ?? 0.8, p.toHeight ?? 0.6, t) +
      Math.sin(t * Math.PI) * (p.arc ?? 0),
    T.MathUtils.lerp(p.y, p.ty, t) - 16,
  );
}
export function executionerFlightSeconds(p: Projectile) {
  if (!p.turn || !p.speed) return 0;
  const distance = Math.hypot(p.turn.x - p.x, p.turn.y - p.y);
  return (Math.max(0, distance - 0.6) + distance) / p.speed;
}
export function executionerFlightPoint(p: Projectile, seconds: number) {
  const turn = p.turn ?? { x: p.tx, y: p.ty };
  const distance = Math.hypot(turn.x - p.x, turn.y - p.y) || 1;
  const ux = (turn.x - p.x) / distance, uy = (turn.y - p.y) / distance;
  const away = Math.max(0, distance - 0.6) / (p.speed ?? 1);
  const traveled = Math.max(0, seconds) * (p.speed ?? 1);
  const remaining = Math.max(0, seconds - away) * (p.speed ?? 1);
  const offset = seconds <= away
    ? Math.min(distance, 0.6 + traveled)
    : Math.max(0, distance - remaining);
  return new T.Vector3(p.x + ux * offset - 9,
    p.fromHeight ?? 3, p.y + uy * offset - 16);
}
export function projectileArt(p: Projectile) {
  if (["arrow", "arrows", "archers"].includes(p.style))
    return p.team === "blue"
      ? "projectile_arrow_basic"
      : "projectile_arrow_basic_enemy";
  if (p.style === "mortar") return "catapult_projectile1";
  if (p.style === "bomb-tower") return "projectile_bomb";
  if (p.style === "spear-goblins") return "projectile_spear_360";
  if (p.style === "dart-goblin") return "projectile_arrow_basic";
  if (p.style === "ice-wizard") return "ice_wizard_projectile";
  if (p.style === "ice-spirit") return "projectile_icespirit";
  if (p.style === "fire-spirits") return "projectile_firespirit";
  if (p.style === "princess") return "projectile_princess";
  if (p.style === "bomb") return `balloon_bomb_${p.team}`;
  if (p.style === "giant-skeleton-bomb")
    return `giant_skeleton_bomb_${p.team}`;
  if (["bomber", "balloon"].includes(p.style)) return "projectile_bomb";
  if (["cannon", "cannonball", "royal-giant"].includes(p.style))
    return "projectile_cannonball_large";
  if (p.style === "musketeer" || p.style === "mega-minion")
    return "projectile_cannonball_small";
  if (p.style === "fireball") return "fireball_projectile1";
  if (p.style === "rocket") return "projectile_rocket";
  if (p.style === "goblin-barrel") return "spell_goblin_barrel_projectile";
  if (p.style === "log-launch") return "log_projectile";
  if (p.style === "log")
    return p.team === "blue"
      ? "log_roll_projectile"
      : "log_roll_projectile_red";
  if (p.style === "bowler") return "bowler_projectile";
  if (p.style === "executioner") return "executioner_projectile";
  if (p.style === "sparky") return "zapMachine_projectile";
  if (p.style === "rage-bottle") return "rage_bottle_fall";
  if (p.style === "baby-dragon") return "dragon_projectile";
  if (p.style === "wizard") return "fireball_small";
  if (p.style === "lava-hound" || p.style === "lava-pup") return "particle_coal1";
  if (p.style === "witch" || p.style === "minions") return "Tower_projectile1";
  return null;
}
export function makeProjectile(
  p: Projectile,
  library: EffectLibrary,
): ProjectileVisual {
  const object = new T.Group(),
    sprites: EffectSprite[] = [];
  const art = projectileArt(p),
    offsets =
      p.style === "arrows"
        ? arrowOffsets(p.id, p.delay !== undefined, p.team)
        : [],
    count = offsets.length || 1;
  if (art)
    for (let i = 0; i < count; i++) {
      const sprite = library.make(art);
      if (!sprite) break;
      if (offsets.length)
        sprite.mesh.position.set(offsets[i].x, 0, offsets[i].y);
      object.add(sprite.mesh);
      sprites.push(sprite);
    }
  if (
    p.style === "rocket" ||
    p.style === "log-launch" ||
    p.style === "goblin-barrel" ||
    p.style === "princess"
    || p.style === "bowler"
    || p.style === "executioner"
    || p.style === "mortar"
    || p.style === "bomb-tower"
  ) {
    const shadow = library.make(
      p.style === "rocket"
        ? "projectile_shadow_rocket"
        : p.style === "goblin-barrel"
          ? "Barrel_shadow"
          : p.style === "princess"
            ? "projectile_arrow_shadow"
            : p.style === "mortar" || p.style === "bomb-tower"
              ? "projectile_arrow_shadow"
            : p.style === "bowler" || p.style === "executioner"
              ? "bowler_projectile_shadow"
            : "log_projectile_shadow",
    );
    if (shadow) {
      object.add(shadow.mesh);
      sprites.push(shadow);
    }
  }
  if (!sprites.length && !["zap", "tesla"].includes(p.style))
    sphere(object, 0, 0, 0, p.style === "fireball" ? 0.4 : 0.14, 0xffc561);
  return { object, sprites };
}
export function updateProjectile(
  v: ProjectileVisual,
  p: Projectile,
  library: EffectLibrary,
  camera: T.Camera,
  target?: Entity,
) {
  v.object.visible =
    !(p.delay && p.delay > 1e-8) && !["zap", "tesla"].includes(p.style);
  const progress = T.MathUtils.clamp(1 - p.remaining / p.duration, 0, 1);
  // Version-1 replays do not have a flight point; preserve their visual path.
  const tx = p.flight ? p.tx : (target?.x ?? p.tx),
    ty = p.flight ? p.ty : (target?.y ?? p.ty);
  const fromHeight = p.fromHeight ?? 1,
    toHeight = p.toHeight ?? 1;
  const arc = p.arc ?? (p.source === 0 ? 7 : 1.5);
  v.object.position.set(
    (p.flight?.x ?? T.MathUtils.lerp(p.x, tx, progress)) - 9,
    T.MathUtils.lerp(fromHeight, toHeight, progress) +
      Math.sin(progress * Math.PI) * arc,
    (p.flight?.y ?? T.MathUtils.lerp(p.y, ty, progress)) - 16,
  );
  if (v.sprites.some((sprite) => sprite.name.startsWith("balloon_bomb_") ||
      sprite.name.startsWith("giant_skeleton_bomb_") ||
      sprite.name === "rage_bottle_fall"))
    // The native clip already contains the drop and landing. Anchor it on
    // the ground so the generic projectile arc doesn't move it a second time.
    v.object.position.y = 0.2;
  const tangent = new T.Vector3(
    tx - p.x,
    toHeight - fromHeight + Math.cos(progress * Math.PI) * Math.PI * arc,
    ty - p.y,
  );
  tangent.applyQuaternion(camera.quaternion.clone().invert());
  const angle = Math.atan2(tangent.y, tangent.x);
  for (const sprite of v.sprites) {
    if (
      sprite.name === "projectile_shadow_rocket" ||
      sprite.name === "log_projectile_shadow" ||
      sprite.name === "bowler_projectile_shadow" ||
      sprite.name === "Barrel_shadow" ||
      sprite.name === "projectile_arrow_shadow"
    ) {
      sprite.mesh.position.set(0, -v.object.position.y + 0.045, 0);
      sprite.mesh.rotation.set(-Math.PI / 2, 0, 0);
      sprite.mesh.scale.setScalar(1.25);
      continue;
    }
    sprite.mesh.quaternion.copy(camera.quaternion);
    if (sprite.name.includes("arrow_basic")) {
      library.frame(sprite, 7);
      sprite.mesh.rotateZ(angle);
    } else if (sprite.name === "projectile_spear_360") {
      library.frame(sprite, 4);
      sprite.mesh.rotateZ(angle + Math.PI / 2);
    } else if (sprite.name === "fireball_projectile1") {
      library.frame(sprite, 7);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(1.4);
    } else if (sprite.name === "projectile_rocket") {
      // The source's 60 frames turn the missile in 3D. Its first frame gives
      // the clearest silhouette; align that nose with the projected flight.
      library.frame(sprite, 0);
      sprite.mesh.rotateZ(angle - Math.PI / 2);
      sprite.mesh.scale.setScalar(1.25);
    } else if (sprite.name === "log_projectile") {
      library.frame(sprite, 0);
      sprite.mesh.rotateZ(angle - Math.PI / 2);
      sprite.mesh.scale.setScalar(1.25);
    } else if (sprite.name === "spell_goblin_barrel_projectile") {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle - Math.PI / 2);
      sprite.mesh.scale.setScalar(1.35);
    } else if (sprite.name.startsWith("log_roll_projectile")) {
      library.animate(sprite, p.elapsed ?? 0, true);
      sprite.mesh.scale.setScalar(1.4);
    } else if (sprite.name === "bowler_projectile") {
      library.animate(sprite, p.elapsed ?? 0, true);
      sprite.mesh.scale.setScalar(1.3);
    } else if (sprite.name === "catapult_projectile1") {
      library.animate(sprite, p.elapsed ?? 0, true);
      sprite.mesh.scale.setScalar(1.1);
    } else if (sprite.name === "executioner_projectile") {
      library.animate(sprite, p.elapsed ?? 0, true);
      sprite.mesh.scale.setScalar(1.1);
    } else if (sprite.name === "zapMachine_projectile") {
      library.animate(sprite, p.elapsed ?? 0, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(1.1);
    } else if (sprite.name === "rage_bottle_fall") {
      library.animate(sprite, p.elapsed ?? 0);
    } else if (["fireball_small", "Tower_projectile1"].includes(sprite.name)) {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(p.style === "minions" ? 0.22 : 0.45);
    } else if (sprite.name === "ice_wizard_projectile" ||
      sprite.name === "projectile_icespirit" ||
      sprite.name === "projectile_firespirit") {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(0.65);
    } else if (sprite.name === "projectile_princess") {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(0.8);
    } else if (sprite.name === "projectile_bomb") {
      sprite.mesh.rotateZ(["bomber", "bomb-tower"].includes(p.style) ? progress * Math.PI * 2 : 0);
      sprite.mesh.scale.setScalar(p.style === "balloon" ? 0.85 : 0.6);
    } else if (sprite.name === "particle_coal1") {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.scale.setScalar(p.style === "lava-hound" ? 0.7 : 0.45);
    } else if (sprite.name.startsWith("balloon_bomb_")) {
      // Native attack_start/attack_end spans 31 frames at 30 FPS. Play once
      // during the existing death-bomb flight; replay rules own its duration.
      library.animate(sprite, p.elapsed ?? progress * p.duration);
    } else if (sprite.name.startsWith("giant_skeleton_bomb_")) {
      library.animate(sprite, p.elapsed ?? progress * p.duration);
      sprite.mesh.scale.setScalar(1.25);
    } else library.animate(sprite, p.elapsed ?? progress * p.duration, true);
  }
}
