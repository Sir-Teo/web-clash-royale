import type { Team } from "../game/engine";
export interface AnimationClip {
  fps: number;
  frames: number[];
  source: string;
}
export function facing(dx: number, dy: number) {
  const angle = Math.atan2(dx, -dy);
  return {
    direction: 1 + Math.round((Math.abs(angle) / Math.PI) * 8),
    flip: dx < 0,
  };
}
export function selectClip(
  clips: Record<string, AnimationClip>,
  team: Team,
  kind: string,
  direction: number,
): AnimationClip {
  // Balloon has one facing. Other troops have nine source directions, mirrored to the left.
  for (const color of [team, "blue"])
    for (const state of [kind, "run", "idle"])
      for (const angle of [direction, 1]) {
        const clip = clips[`${color}-${state}-${angle}`];
        if (clip) return clip;
      }
  return Object.values(clips)[0];
}
export function animationFrame(
  clip: AnimationClip,
  elapsed: number,
  attack: boolean,
  interval: number,
) {
  // Preserve source pacing unless a faster card hit interval requires compression.
  const fps = attack
    ? Math.max(clip.fps, clip.frames.length / interval)
    : clip.fps;
  const frame = Math.floor(Math.max(0, elapsed) * fps + 1e-6);
  return clip.frames[
    attack
      ? Math.min(clip.frames.length - 1, frame)
      : frame % clip.frames.length
  ];
}
