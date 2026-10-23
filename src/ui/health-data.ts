import type { NativeData, Part } from "./native";
export interface HealthData extends NativeData {
  bars: Record<string, string>;
  profiles: Record<
    string,
    {
      source: string;
      table: string;
      healthBar: string;
      offsetY: number;
      showNumber: boolean;
    }
  >;
  atlas: {
    file: string;
    width: number;
    height: number;
    textY: number;
    regions: Record<string, number[]>;
  };
}
export const healthFrame = (ratio: number) =>
  Math.round((1 - Math.max(0, Math.min(1, ratio))) * 99);
export const healthMatrix = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function healthParts(
  data: HealthData,
  name: string,
  ratio: number,
  rootFrame = 0,
): Part[] {
  return data.clips[name].frames[rootFrame].flatMap((p) =>
    p.shape !== -1
      ? [p]
      : data.clips[data.bars[name]].frames[healthFrame(ratio)].map((child) => ({
          ...child,
          binding: p.binding,
          matrix: healthMatrix(p.matrix, child.matrix),
          color: [
            ...[0, 1, 2].map((i) =>
              Math.min(
                255,
                p.color[i] + (child.color[i] * p.color[4 + i]) / 255,
              ),
            ),
            (p.color[3] * child.color[3]) / 255,
            ...[4, 5, 6].map((i) => (p.color[i] * child.color[i]) / 255),
          ],
        })),
  );
}
export function healthView(
  data: HealthData,
  name: string,
  ratio: number,
  frame = 0,
): NativeData {
  return {
    ...data,
    clips: {
      display: { fps: 30, frames: [healthParts(data, name, ratio, frame)] },
    },
  };
}

import type { Entity } from "../game/engine";
import { KING_ACTIVATION_TIME } from "../game/combat";
export function healthSelection(data: HealthData, e: Entity) {
  const side = e.team === "blue" ? "player" : "enemy";
  const shielded = !!e.shield && !!e.maxShield;
  let kind: string,
    frame = 0;
  if (e.kind === "tower") {
    kind = e.king ? "wizard" : "tower_withNumber";
    if (e.king && e.active) {
      const clip = data.clips[`hp_${side}_wizard`];
      frame = Math.min(
        clip.frames.length - 1,
        Math.max(
          0,
          Math.floor(
            (KING_ACTIVATION_TIME - (e.activation ?? 0)) * clip.fps + 1e-6,
          ),
        ),
      );
    }
  } else {
    kind = e.hp >= e.maxHp && (!shielded || e.shield === e.maxShield)
      ? "number"
      : (data.profiles[e.card]?.healthBar || "Medium").toLowerCase();
    if (kind === "shield") kind = "medium";
  }
  const visible =
    e.hp > 0 &&
    (e.kind === "tower" ||
      ((!e.burrow || e.burrow.exposure > 0) &&
        (e.hp < e.maxHp || (shielded && e.shield! < e.maxShield!) || e.age < 2.5)));
  return {
    name: shielded ? `hp_shield_${side}_${kind}` : `hp_${side}_${kind}`,
    frame,
    fill: healthFrame(shielded ? e.shield! / e.maxShield! : e.hp / e.maxHp),
    visible,
  };
}

/** Crop to artwork and four-digit HP, excluding unused text-field padding. */
export function healthBox(name: string) {
  const blue = name.startsWith("hp_player");
  return name.endsWith("wizard")
    ? blue
      ? "-72 33 144 48"
      : "-72 -139 144 48"
    : name.endsWith("tower_withNumber")
      ? blue
        ? "-47 41 94 38"
        : "-47 -27 94 38"
      : "-50 -30 100 60";
}
