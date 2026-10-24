import type { Projectile } from "../game/engine";

/** Browser arc reconstruction; source gravity is retained separately in rules. */
export function projectilePose(p: Projectile, elapsed: number) {
  const progress = Math.max(0, Math.min(1, elapsed / p.duration));
  const from = p.fromHeight ?? 1,
    to = p.toHeight ?? 1;
  const arc = p.arc ?? (p.source === 0 ? 7 : 1.5);
  return {
    x: p.x + (p.tx - p.x) * progress - 9,
    y: from + (to - from) * progress + Math.sin(progress * Math.PI) * arc,
    z: p.y + (p.ty - p.y) * progress - 16,
  };
}
