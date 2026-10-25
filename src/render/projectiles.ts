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
export function projectileArt(p: Projectile) {
  if (["arrow", "arrows", "archers"].includes(p.style))
    return p.team === "blue"
      ? "projectile_arrow_basic"
      : "projectile_arrow_basic_enemy";
  if (p.style === "spear-goblins") return "projectile_spear_360";
  if (p.style === "bomb") return `balloon_bomb_${p.team}`;
  if (["bomber", "balloon"].includes(p.style)) return "projectile_bomb";
  if (["cannon", "cannonball"].includes(p.style))
    return "projectile_cannonball_large";
  if (p.style === "musketeer" || p.style === "three-musketeers")
    return "projectile_cannonball_small";
  if (p.style === "rocket") return "projectile_rocket";
  if (p.style === "fireball") return "fireball_projectile1";
  if (p.style === "baby-dragon") return "dragon_projectile";
  if (p.style === "wizard") return "fireball_small";
  if (
    p.style === "witch" ||
    p.style === "minions" ||
    p.style === "minion-horde"
  )
    return "Tower_projectile1";
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
  if (v.sprites.some((sprite) => sprite.name.startsWith("balloon_bomb_")))
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
    sprite.mesh.quaternion.copy(camera.quaternion);
    if (sprite.name.includes("arrow_basic")) {
      library.frame(sprite, 7);
      sprite.mesh.rotateZ(angle);
    } else if (sprite.name === "projectile_spear_360") {
      library.frame(sprite, 4);
      sprite.mesh.rotateZ(angle + Math.PI / 2);
    } else if (sprite.name === "projectile_rocket") {
      // The native 60 shapes encode pitch, not compass headings. Reconstruct
      // camera-relative pitch around the nose-up side profile, then roll it
      // along the screen-space tangent. Native runtime mapping is unverified.
      const pitch = Math.atan2(tangent.z, Math.hypot(tangent.x, tangent.y));
      library.frame(
        sprite,
        (Math.round(50 + (pitch * 60) / (Math.PI * 2)) + 60) % 60,
      );
      sprite.mesh.rotateZ(angle - Math.PI / 2);
    } else if (sprite.name === "fireball_projectile1") {
      library.frame(sprite, 7);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(1.4);
    } else if (["fireball_small", "Tower_projectile1"].includes(sprite.name)) {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(
        p.style === "minions" || p.style === "minion-horde" ? 0.22 : 0.45,
      );
    } else if (sprite.name === "projectile_bomb") {
      sprite.mesh.rotateZ(p.style === "bomber" ? progress * Math.PI * 2 : 0);
      sprite.mesh.scale.setScalar(p.style === "balloon" ? 0.85 : 0.6);
    } else if (sprite.name.startsWith("balloon_bomb_")) {
      // Native attack_start/attack_end spans 31 frames at 30 FPS. Play once
      // during the existing death-bomb flight; replay rules own its duration.
      library.animate(sprite, p.elapsed ?? progress * p.duration);
    } else library.animate(sprite, p.elapsed ?? progress * p.duration, true);
  }
}
