import type { Team } from "../game/engine";
import type { EmoteKind } from "../game/emotes";
import type { NativeData, Part } from "./native";
import settings from "./emote-settings.json";
export interface EmoteData extends NativeData {
  voices: Record<EmoteKind, { files: string[]; volume: number }>;
}
export const EMOTE_DURATION =
  settings.bubbles.blue.frames / settings.bubbles.blue.fps;
export class EmoteClock {
  active: Partial<Record<Team, { kind: EmoteKind; time: number }>> = {};
  show(team: Team, kind: EmoteKind) {
    this.active[team] = { kind, time: 0 };
  }
  reset() {
    this.active = {};
  }
  advance(delta: number) {
    for (const team of ["blue", "red"] as const) {
      const item = this.active[team];
      if (item && (item.time += Math.max(0, delta)) >= EMOTE_DURATION)
        delete this.active[team];
    }
  }
  frame(team: Team, reduced = false) {
    const item = this.active[team];
    if (!item) return null;
    const expression = settings.expressions[item.kind],
      bubble = settings.bubbles[team];
    return {
      kind: item.kind,
      bubble: reduced
        ? 60
        : Math.min(
            bubble.frames - 1,
            Math.floor(item.time * bubble.fps + 1e-6),
          ),
      expression: reduced
        ? 0
        : Math.floor(item.time * expression.fps + 1e-6) % expression.frames,
    };
  }
}
const compose = (parent: Part, child: Part): Part => {
  const a = parent.matrix,
    b = child.matrix,
    p = parent.color,
    c = child.color;
  return {
    ...child,
    binding: parent.binding,
    matrix: [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ],
    color: [
      ...[0, 1, 2].map((i) => Math.min(255, p[i] + (c[i] * p[i + 4]) / 255)),
      (p[3] * c[3]) / 255,
      ...[4, 5, 6].map((i) => (p[i] * c[i]) / 255),
    ],
  };
};
export function emoteView(
  data: EmoteData,
  team: Team,
  kind: EmoteKind,
  bubble: number,
  expression: number,
): NativeData {
  const anchor = settings.bubbles[team].anchor;
  const parts = data.clips[`bubble_${team}`].frames[bubble]
    .flatMap((p) =>
      p.shape === -1
        ? data.clips[kind].frames[expression].map((c) => compose(p, c))
        : [p],
    )
    .map((p) => ({
      ...p,
      matrix: [
        ...p.matrix.slice(0, 4),
        p.matrix[4] - anchor[0],
        p.matrix[5] - anchor[1],
      ],
    }));
  return { ...data, clips: { display: { fps: 60, frames: [parts] } } };
}
export function emoteCell(data: EmoteData, kind: EmoteKind): NativeData {
  const parts = data.clips.cell.frames[0].flatMap((p) =>
    p.shape === -2
      ? data.clips[`icon_${kind}`].frames[0].map((c) => compose(p, c))
      : [p],
  );
  return { ...data, clips: { display: { fps: 60, frames: [parts] } } };
}
