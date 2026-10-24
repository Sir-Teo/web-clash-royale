import type { Point } from "../game/engine";

export const DEFAULT_KEYBOARD_TARGET = { x: 9, y: 24 } as const;

export function moveKeyboardTarget(
  point: Point,
  key: string,
  coarse = false,
): Point | null {
  const step = coarse ? 2 : 0.5;
  let x = point.x,
    y = point.y;
  if (key === "ArrowLeft") x -= step;
  else if (key === "ArrowRight") x += step;
  else if (key === "ArrowUp") y -= step;
  else if (key === "ArrowDown") y += step;
  else return null;
  return {
    x: Math.max(0.5, Math.min(17.5, x)),
    y: Math.max(0.7, Math.min(31.3, y)),
  };
}
