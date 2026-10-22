import * as T from "three";
import type { Entity, Projectile } from "../game/engine";
import { sphere } from "./models";
import { EffectLibrary } from "./effects";
import type { EffectSprite } from "./effects";

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
  if (["bomber", "balloon", "bomb"].includes(p.style)) return "projectile_bomb";
  if (["cannon", "cannonball"].includes(p.style))
    return "projectile_cannonball_large";
  if (p.style === "musketeer") return "projectile_cannonball_small";
  if (p.style === "fireball") return "fireball_projectile1";
  if (p.style === "baby-dragon") return "dragon_projectile";
  if (p.style === "wizard") return "fireball_small";
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
    count = p.style === "arrows" ? 13 : 1;
  if (art)
    for (let i = 0; i < count; i++) {
      const sprite = library.make(art);
      if (!sprite) break;
      if (count > 1) {
        const angle = i * 2.39996,
          radius = Math.sqrt(i / count) * 3.25;
        sprite.mesh.position.set(
          Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        );
      }
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
    } else if (sprite.name === "fireball_projectile1") {
      library.frame(sprite, 7);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(1.4);
    } else if (["fireball_small", "Tower_projectile1"].includes(sprite.name)) {
      library.animate(sprite, p.elapsed ?? progress * p.duration, true);
      sprite.mesh.rotateZ(angle);
      sprite.mesh.scale.setScalar(p.style === "minions" ? 0.22 : 0.45);
    } else if (sprite.name === "projectile_bomb") {
      sprite.mesh.rotateZ(p.style === "bomber" ? progress * Math.PI * 2 : 0);
      sprite.mesh.scale.setScalar(
        p.style === "balloon" || p.style === "bomb" ? 0.85 : 0.6,
      );
    } else library.animate(sprite, p.elapsed ?? progress * p.duration, true);
  }
}
