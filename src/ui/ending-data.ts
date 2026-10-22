import type { Battle, Team } from "../game/engine";
import type { NativeData, Part } from "./native";
import settings from "./ending-settings.json";
export const END_MATCH_TIME = settings.matchFrames / settings.fps;
export const END_DURATION =
  END_MATCH_TIME + settings.scoreFrames / settings.fps;
export interface EndResult {
  names: Record<Team, string>;
  crowns: Record<Team, number>;
  earned: Record<Team, number>;
  winner: Team | "draw";
}
export function endResult(b: Battle, player: string, enemy: string): EndResult {
  const crowns = { blue: b.players.blue.crowns, red: b.players.red.crowns };
  const earned = { blue: 0, red: 0 };
  for (const e of b.events)
    if (e.type === "crown" && Math.abs(e.time - b.time) < 1e-6)
      earned[e.team] = Math.min(
        crowns[e.team],
        earned[e.team] + (e.value ?? 1),
      );
  return {
    names: { blue: player, red: enemy },
    crowns,
    earned,
    winner: b.winner ?? "draw",
  };
}
export class EndClock {
  time: number | null = null;
  hold = false;
  reduced = false;
  start(reduced = false, hold = false) {
    this.reduced = reduced;
    this.hold = hold;
    this.time = 0;
  }
  reset() {
    this.time = null;
    this.hold = false;
  }
  advance(delta: number) {
    if (this.time !== null && !this.hold) this.time += Math.max(0, delta);
  }
  skip() {
    if (this.time !== null) {
      this.hold = false;
      this.time = END_DURATION;
    }
  }
  get finished() {
    return (
      this.time === null ||
      (!this.hold && this.time >= (this.reduced ? 1.4 : END_DURATION))
    );
  }
  get state() {
    if (this.finished) return null;
    if (this.reduced || this.hold)
      return {
        stage: "scores" as const,
        frame: settings.scoreLabels.end,
        still: true,
      };
    if (this.time! < END_MATCH_TIME)
      return {
        stage: "match" as const,
        frame: Math.min(
          settings.matchFrames - 1,
          Math.floor(this.time! * settings.fps + 1e-6),
        ),
        still: false,
      };
    return {
      stage: "scores" as const,
      frame: Math.min(
        settings.scoreFrames - 1,
        Math.floor((this.time! - END_MATCH_TIME) * settings.fps + 1e-6),
      ),
      still: false,
    };
  }
}
export function endCrownFrame(
  result: EndResult,
  team: Team,
  index: number,
  frame: number,
  still = false,
) {
  const count = Math.min(3, Math.max(0, result.crowns[team]));
  const earned = Math.min(count, Math.max(0, result.earned[team]));
  const labels = settings.crownLabels;
  if (index >= count) return labels.noStar;
  if (still || index < count - earned) return labels.oldStar;
  if (frame < settings.scoreLabels.start) return labels.noStar;
  return Math.min(
    labels.newStar_end,
    labels.newStar + frame - settings.scoreLabels.start,
  );
}
const compose = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function endParts(
  data: NativeData,
  result: EndResult,
  frame: number,
  still = false,
): Part[] {
  return (["red", "blue"] as Team[]).flatMap((team) => {
    const name = team === "blue" ? "player" : "enemy";
    return data.clips[`printScore_${name}`].frames[frame].flatMap((p) => {
      if (p.shape !== -1) return [p];
      const index = Number(p.binding!.slice(-1)) - 1;
      return data.clips[`crown_${name}`].frames[
        endCrownFrame(result, team, index, frame, still)
      ].map((c) => ({
        ...c,
        binding: `${team}/${p.binding}`,
        matrix: compose(p.matrix, c.matrix),
        color: [
          ...[0, 1, 2].map((i) =>
            Math.min(255, p.color[i] + (c.color[i] * p.color[i + 4]) / 255),
          ),
          (p.color[3] * c.color[3]) / 255,
          ...[4, 5, 6].map((i) => (p.color[i] * c.color[i]) / 255),
        ],
      }));
    });
  });
}
export function endView(
  data: NativeData,
  result: EndResult,
  frame: number,
  still = false,
): NativeData {
  return {
    ...data,
    clips: {
      display: {
        fps: settings.fps,
        frames: [endParts(data, result, frame, still)],
      },
    },
  };
}
