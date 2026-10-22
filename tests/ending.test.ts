import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSC } from "../scripts/lib/sc.mjs";
import type { NativeData } from "../src/ui/native";
import { textureMatrix } from "../src/ui/native";
import { Battle } from "../src/game/engine";
import {
  EndClock,
  END_DURATION,
  END_MATCH_TIME,
  endCrownFrame,
  endParts,
  endResult,
  type EndResult,
} from "../src/ui/ending-data";
import settings from "../src/ui/ending-settings.json";
const data: NativeData = JSON.parse(
  readFileSync("public/assets/ui/ending/ending.json", "utf8"),
);
const result: EndResult = {
  names: { blue: "Sir Teo", red: "Royal Trainer" },
  crowns: { blue: 3, red: 1 },
  earned: { blue: 2, red: 0 },
  winner: "blue",
};
describe("native battle ending", () => {
  it("preserves all five source timelines, three text styles, crown labels and lossless asset hashes", () => {
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/ending/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const item of manifest.sources)
      if (item.path) expect(hash(item.path)).toBe(item.sha256);
    for (const item of manifest.files)
      expect(hash(`public/assets/ui/ending/${item.file}`)).toBe(item.sha256);
    expect(Object.keys(data.clips)).toHaveLength(5);
    expect(Object.keys(data.shapes)).toHaveLength(5);
    expect(Object.keys(data.texts)).toHaveLength(3);
    expect(
      Object.values(data.clips).reduce((n, c) => n + c.frames.length, 0),
    ).toBe(402);
    for (const clip of Object.values(data.clips) as any[]) {
      expect(clip.frames.length).toBe(
        source.clips[clip.sourceId].frames.length,
      );
      expect(clip.labels).toEqual(source.clips[clip.sourceId].labels);
      expect(clip.fps).toBe(30);
    }
    for (const [id, style] of Object.entries(data.texts))
      expect(style).toEqual(source.texts[id]);
    expect(settings.matchFrames).toBe(data.clips.finalScore.frames.length);
    expect(settings.scoreFrames).toBe(
      data.clips.printScore_player.frames.length,
    );
    expect(settings.scoreLabels).toEqual(data.clips.printScore_player.labels);
    expect(settings.crownLabels).toEqual(data.clips.crown_player.labels);
    expect(data.translations["txt_match_over/TID_MATCH_OVER"]).toBe(
      "Match Over!",
    );
    for (const shape of Object.values(data.shapes))
      for (const polygon of shape.polygons ?? [shape])
        if (polygon.solid === undefined) {
          const m = textureMatrix(polygon);
          expect(m.every(Number.isFinite)).toBe(true);
          polygon.uv.forEach(([u, v], i) => {
            expect(
              Math.abs(m[0] * u + m[2] * v + m[4] - polygon.xy[i][0]),
            ).toBeLessThan(0.05);
            expect(
              Math.abs(m[1] * u + m[3] * v + m[5] - polygon.xy[i][1]),
            ).toBeLessThan(0.05);
          });
        }
  });
  it("plays both complete timelines without looping and keeps seeks and reduced motion still", () => {
    const clock = new EndClock();
    expect(clock.finished).toBe(true);
    clock.start();
    clock.advance(0.5);
    expect(clock.state).toEqual({ stage: "match", frame: 15, still: false });
    clock.advance(END_MATCH_TIME - 0.5);
    expect(clock.state).toEqual({ stage: "scores", frame: 0, still: false });
    clock.advance(3.3);
    expect(clock.state?.frame).toBe(99);
    clock.advance(1);
    expect(clock.finished).toBe(true);
    expect(clock.state).toBeNull();
    clock.start(false, true);
    clock.advance(100);
    expect(clock.state).toEqual({ stage: "scores", frame: 87, still: true });
    expect(clock.time).toBe(0);
    clock.skip();
    expect(clock.finished).toBe(true);
    clock.start(true);
    expect(clock.state?.still).toBe(true);
    clock.advance(1.4);
    expect(clock.finished).toBe(true);
    clock.reset();
    expect(clock.state).toBeNull();
    expect(END_DURATION).toBeCloseTo(5.6);
  });
  it("keeps old crowns, emphasizes only newly earned crowns, and preserves empty slots", () => {
    expect(endCrownFrame(result, "blue", 0, 20)).toBe(46);
    expect(endCrownFrame(result, "blue", 1, 15)).toBe(0);
    expect(endCrownFrame(result, "blue", 1, 16)).toBe(20);
    expect(endCrownFrame(result, "blue", 2, 25)).toBe(29);
    expect(endCrownFrame(result, "blue", 2, 87)).toBe(45);
    expect(endCrownFrame(result, "blue", 2, 87, true)).toBe(46);
    expect(endCrownFrame(result, "red", 0, 24)).toBe(46);
    expect(endCrownFrame(result, "red", 1, 24)).toBe(0);
  });
  it("composes crowns into both authored score panels without losing source transforms", () => {
    for (let frame = 0; frame < 102; frame++) {
      const parts = endParts(data, result, frame);
      expect(
        parts.filter((p) => p.binding?.startsWith("blue/star")),
      ).toHaveLength(3);
      expect(
        parts.filter((p) => p.binding?.startsWith("red/star")),
      ).toHaveLength(3);
      expect(
        parts.every((p) => p.shape !== -1 && p.matrix.every(Number.isFinite)),
      ).toBe(true);
      expect(parts.filter((p) => p.text).map((p) => p.binding)).toEqual([
        "enemyName/txt",
        "playerName/txt",
      ]);
    }
    const blue = endParts(data, result, 16).find(
      (p) => p.binding === "blue/star1",
    )!;
    expect(blue.matrix[4]).toBeCloseTo(-63.2, 4);
    expect(blue.matrix[5]).toBeCloseTo(119.95, 4);
  });
  it("takes final awards from the finishing tick and does not celebrate earlier crowns again", () => {
    const b = new Battle({ ai: false });
    b.tick = 90;
    b.players.blue.crowns = 3;
    b.players.red.crowns = 1;
    b.events = [
      { id: 8, type: "crown", team: "red", x: 4, y: 26, value: 1, time: 1 },
      { id: 9, type: "crown", team: "blue", x: 9, y: 2.5, value: 2, time: 3 },
    ];
    b.finish("blue", "King Tower destroyed");
    expect(endResult(b, "One", "Two")).toEqual({
      ...result,
      names: { blue: "One", red: "Two" },
    });
    b.tick++;
    expect(endResult(b, "One", "Two").earned).toEqual({ blue: 0, red: 0 });
  });
});
