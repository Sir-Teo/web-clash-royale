import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { IntroClock, INTRO_ACTION_TIME, INTRO_DURATION } from "../src/ui/intro";
import { textureMatrix } from "../src/ui/native";
import { parseSC } from "../scripts/lib/sc.mjs";
import { Battle, STEP } from "../src/game/engine";
const data = JSON.parse(
  readFileSync("public/assets/ui/intro/intro.json", "utf8"),
);
describe("native battle opening", () => {
  it("retains both complete timelines, original text styles and source action labels", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/intro/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const source of manifest.sources)
      if (source.path) expect(hash(source.path)).toBe(source.sha256);
    expect(hash(manifest.settings.path)).toBe(manifest.settings.sha256);
    for (const file of manifest.files)
      expect(hash(`public/assets/ui/intro/${file.file}`)).toBe(file.sha256);
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(Object.keys(data.clips)).toHaveLength(2);
    expect(Object.keys(data.texts)).toHaveLength(8);
    for (const [id, text] of Object.entries(data.texts))
      expect(text).toEqual(source.texts[id]);
    for (const [name, clip] of Object.entries(data.clips) as [string, any][]) {
      expect(clip.fps).toBe(30);
      expect(clip.frames).toHaveLength(134);
      expect(clip.labels).toEqual(source.clips[source.names[name]].labels);
      expect(clip.labels.actionFrame / clip.fps).toBe(INTRO_ACTION_TIME);
      expect(clip.frames.length / clip.fps).toBe(INTRO_DURATION);
      for (const frame of clip.frames)
        for (const part of frame) {
          expect(part.matrix.every(Number.isFinite)).toBe(true);
          expect(part.color.every((n: number) => n >= 0 && n <= 255)).toBe(
            true,
          );
          if (part.text !== undefined)
            expect(data.translations[part.binding]).toBeTypeOf("string");
        }
    }
  });
  it("preserves multipart ribbon polygons and maps their cropped textures without degenerate matrices", () => {
    expect(data.shapes[696].polygons).toHaveLength(3);
    expect(data.shapes[698].polygons).toHaveLength(3);
    expect(data.shapes[695].polygons[0].solid).toBeTypeOf("number");
    for (const shape of Object.values(data.shapes) as any[])
      for (const polygon of shape.polygons) {
        if (polygon.solid !== undefined) continue;
        const m = textureMatrix(polygon);
        expect(m.every(Number.isFinite)).toBe(true);
        polygon.uv.forEach(([u, v]: number[], i: number) => {
          expect(
            Math.abs(m[0] * u + m[2] * v + m[4] - polygon.xy[i][0]),
          ).toBeLessThan(0.05);
          expect(
            Math.abs(m[1] * u + m[3] * v + m[5] - polygon.xy[i][1]),
          ).toBeLessThan(0.05);
        });
      }
  });
  it("releases combat exactly at the authored action frame without consuming opening elixir or AI time", () => {
    const clock = new IntroClock(),
      battle = new Battle({ seed: 42 });
    clock.start();
    for (let frame = 0; frame < 103; frame++) {
      expect(clock.blocking).toBe(true);
      expect(clock.advance(STEP)).toBeCloseTo(0, 10);
    }
    expect(clock.time).toBe(INTRO_ACTION_TIME);
    expect(clock.blocking).toBe(false);
    expect(clock.active).toBe(true);
    expect(battle.time).toBe(0);
    expect(battle.actions).toHaveLength(0);
    expect(battle.players.blue.elixir).toBe(5);
    expect(battle.players.red.elixir).toBe(5);
    expect(clock.advance(STEP)).toBeCloseTo(STEP, 10);
    battle.step();
    expect(battle.time).toBe(STEP);
    clock.advance(2);
    expect(clock.active).toBe(false);
    expect(clock.advance(1)).toBe(1);
  });
  it("conserves elapsed combat time across different render sizes, pause and replay reset", () => {
    for (const chunk of [1 / 60, 1 / 30, 0.1, 0.5]) {
      const clock = new IntroClock();
      clock.start();
      let combat = 0;
      for (let i = 0; i < Math.round(6 / chunk); i++)
        combat += clock.advance(chunk);
      expect(combat).toBeCloseTo(6 - INTRO_ACTION_TIME, 8);
    }
    const clock = new IntroClock();
    clock.start();
    clock.advance(2);
    const held = clock.time;
    expect(clock.advance(0)).toBe(0);
    expect(clock.time).toBe(held);
    expect(clock.advance(-1)).toBe(0);
    expect(clock.time).toBe(held);
    clock.skip();
    expect(clock.active).toBe(false);
    expect(clock.advance(0.1)).toBe(0.1);
    clock.start();
    expect(clock.time).toBe(0);
    expect(clock.blocking).toBe(true);
  });
});
