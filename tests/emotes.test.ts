import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSC } from "../scripts/lib/sc.mjs";
import { EMOTES, isEmote } from "../src/game/emotes";
import {
  EmoteClock,
  EMOTE_DURATION,
  emoteView,
  emoteCell,
  type EmoteData,
} from "../src/ui/emote-data";
import { textureMatrix } from "../src/ui/native";
import settings from "../src/ui/emote-settings.json";
const data: EmoteData = JSON.parse(
  readFileSync("public/assets/ui/emotes/emotes.json", "utf8"),
);
describe("native King emotes", () => {
  it("retains every nested expression frame, both bubble masters, original controls and verified assets", () => {
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/emotes/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const file of manifest.sources)
      if (file.path) expect(hash(file.path)).toBe(file.sha256);
    for (const file of manifest.files)
      expect(hash(`public/assets/ui/emotes/${file.file}`)).toBe(file.sha256);
    for (const file of manifest.audioFiles)
      expect(hash(`public/assets/audio/${file.file}`)).toBe(file.sha256);
    expect(manifest.audioFiles).toHaveLength(16);
    expect(Object.keys(data.clips)).toHaveLength(13);
    expect(Object.keys(data.shapes)).toHaveLength(21);
    expect(
      Object.values(data.clips).reduce((n, c) => n + c.frames.length, 0),
    ).toBe(452);
    for (const [name, clip] of Object.entries(data.clips) as [string, any][]) {
      const native = source.clips[clip.timelineId ?? clip.sourceId];
      expect(clip.fps).toBe(native.fps);
      expect(clip.frames.length).toBe(native.frames.length);
      if (isEmote(name)) {
        expect(source.clips[clip.sourceId].frames).toHaveLength(1);
        expect(settings.expressions[name].frames).toBe(native.frames.length);
        expect(data.voices[name].files).toHaveLength(4);
        expect(data.voices[name].volume).toBe(0.7);
      }
    }
    // The first laugh body preserves the outer wrapper's 0.7998 scale and
    // translation; using only the nested animation would move/enlarge it.
    const body = data.clips.laugh.frames[0].find((p) => p.shape === 208)!;
    expect(body.matrix[0]).toBeCloseTo(0.7998046875 ** 2, 5);
    expect(body.matrix[4]).toBeCloseTo(-1.3 + 0.7998046875 * 0.1, 5);
    for (const shape of Object.values(data.shapes))
      for (const polygon of shape.polygons ?? [shape]) {
        if (polygon.solid !== undefined) continue;
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
  it("composes each expression in both bubbles without losing the nested transforms", () => {
    for (const team of ["blue", "red"] as const)
      for (const kind of EMOTES) {
        for (let frame = 0; frame < 145; frame++) {
          const view = emoteView(
            data,
            team,
            kind,
            frame,
            frame % settings.expressions[kind].frames,
          );
          const parts = view.clips.display.frames[0];
          expect(
            parts.every(
              (p) => p.shape! >= 0 && p.matrix.every(Number.isFinite),
            ),
          ).toBe(true);
          expect(parts.filter((p) => p.binding === "bubble/anim").length).toBe(
            data.clips[kind].frames[frame % settings.expressions[kind].frames]
              .length,
          );
        }
        expect(
          emoteCell(data, kind).clips.display.frames[0].some(
            (p) => p.shape! < 0,
          ),
        ).toBe(false);
      }
    const bubble = emoteView(data, "blue", "laugh", 60, 0).clips.display
      .frames[0];
    const first = bubble[0];
    expect(first.matrix[4]).toBeCloseTo(-53 * 0.9990234375, 4);
    expect(first.matrix[5]).toBeCloseTo(-40 * 0.9990234375, 4);
  });
  it("keeps player clocks independent, freezes paused poses and expires without looping the bubble", () => {
    const c = new EmoteClock();
    c.show("blue", "laugh");
    c.advance(0.5);
    c.show("red", "cry");
    expect(c.frame("blue")).toEqual({
      kind: "laugh",
      bubble: 30,
      expression: 30,
    });
    expect(c.frame("red")).toEqual({ kind: "cry", bubble: 0, expression: 0 });
    c.advance(0);
    c.advance(-3);
    expect(c.frame("blue")?.bubble).toBe(30);
    c.advance(EMOTE_DURATION - 0.5);
    expect(c.frame("blue")).toBeNull();
    expect(c.frame("red")).not.toBeNull();
    c.show("red", "thumbs");
    expect(c.frame("red")?.bubble).toBe(0);
    c.advance(EMOTE_DURATION);
    expect(c.frame("red")).toBeNull();
    c.show("blue", "angry");
    c.reset();
    expect(c.active).toEqual({});
  });
  it("uses a stationary bubble and expression for reduced motion while retaining its duration", () => {
    const c = new EmoteClock();
    c.show("blue", "angry");
    const still = c.frame("blue", true);
    c.advance(2);
    expect(c.frame("blue", true)).toEqual(still);
    expect(still).toEqual({ kind: "angry", bubble: 60, expression: 0 });
    c.advance(0.5);
    expect(c.frame("blue", true)).toBeNull();
  });
});
