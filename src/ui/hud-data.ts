import type { NativeData, Part } from "./native";
import { battleClock, type BattleTiming } from "./announcements";
export interface HudData extends NativeData {
  crowns: Record<string, string>;
}
export type CrownCounts = { blue: number; red: number };
export function hudClock(b: BattleTiming, reducedMotion = false) {
  const { overtime, remaining } = battleClock(b);
  const age = b.time - 180;
  const outgoing = overtime && !reducedMotion && age < 0.5;
  return {
    name: !overtime || outgoing ? "HUD_topRight" : "HUD_topRight_overtime",
    frame: !overtime
      ? 0
      : reducedMotion
        ? 14
        : outgoing
          ? Math.min(14, Math.floor(age * 30 + 1e-6))
          : Math.min(14, Math.floor((age - 0.5) * 30 + 1e-6)),
    seconds: outgoing ? 0 : Math.ceil(remaining),
    overtime,
  };
}
/** Crown feedback uses presentation time; resets never manufacture past awards. */
export class CrownFeedback {
  time = 0;
  counts: CrownCounts = { blue: 0, red: 0 };
  starts: Record<keyof CrownCounts, number | null> = { blue: null, red: null };
  reset(time: number, counts: CrownCounts) {
    this.time = time;
    this.counts = { ...counts };
    this.starts = { blue: null, red: null };
  }
  update(time: number, counts: CrownCounts) {
    if (
      time < this.time ||
      counts.blue < this.counts.blue ||
      counts.red < this.counts.red
    ) {
      this.reset(time, counts);
      return;
    }
    for (const team of ["blue", "red"] as const) {
      if (counts[team] > this.counts[team]) this.starts[team] = time;
      if (this.starts[team] !== null && time - this.starts[team]! >= 100 / 30)
        this.starts[team] = null;
    }
    this.counts = { ...counts };
    this.time = time;
  }
  frame(team: keyof CrownCounts, reducedMotion = false) {
    const start = this.starts[team];
    return start === null || reducedMotion
      ? 99
      : Math.min(99, Math.max(0, Math.floor((this.time - start) * 30 + 1e-6)));
  }
}
const compose = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function hudParts(
  data: HudData,
  landscape: boolean,
  blue = 99,
  red = 99,
): Part[] {
  const name = landscape ? "HUD_rightMiddle_landscape" : "HUD_rightMiddle";
  return data.clips[name].frames[0].flatMap((p) =>
    p.shape !== -1
      ? [p]
      : data.clips[data.crowns[p.binding!]].frames[
          p.binding === "starPlayer" ? blue : red
        ].map((c) => ({
          ...c,
          binding: p.binding,
          matrix: compose(p.matrix, c.matrix),
          color: [
            ...[0, 1, 2].map((i) =>
              Math.min(255, p.color[i] + (c.color[i] * p.color[i + 4]) / 255),
            ),
            (p.color[3] * c.color[3]) / 255,
            ...[4, 5, 6].map((i) => (p.color[i] * c.color[i]) / 255),
          ],
        })),
  );
}
export function hudView(
  data: HudData,
  landscape: boolean,
  blue = 99,
  red = 99,
): NativeData {
  return {
    ...data,
    clips: {
      display: { fps: 30, frames: [hudParts(data, landscape, blue, red)] },
    },
  };
}
export const hudBox = (landscape: boolean) =>
  landscape ? "-215 -107 80 210" : "-69 -132 80 266";
export const hudTimeText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
