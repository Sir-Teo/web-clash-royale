import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSC } from "../scripts/lib/sc.mjs";
import { textureMatrix } from "../src/ui/native";
import {
  hudClock,
  hudTimeText,
  CrownFeedback,
  hudParts,
  type HudData,
} from "../src/ui/hud-data";
const data: HudData = JSON.parse(
  readFileSync("public/assets/ui/hud/hud.json", "utf8"),
);
describe("native match timer and crown HUD", () => {
  it("retains source timelines, five text styles, palette transforms, polygon geometry and hashes", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/hud/manifest.json", "utf8"),
    );
    const hash = (p: string) =>
      createHash("sha256").update(readFileSync(p)).digest("hex");
    for (const s of manifest.sources)
      if (s.path) expect(hash(s.path)).toBe(s.sha256);
    for (const f of manifest.files)
      expect(hash(`public/assets/ui/hud/${f.file}`)).toBe(f.sha256);
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(Object.keys(data.clips)).toHaveLength(6);
    expect(Object.keys(data.texts)).toHaveLength(5);
    expect(Object.keys(data.shapes)).toHaveLength(6);
    for (const c of Object.values(data.clips) as any[]) {
      expect(c.fps).toBe(30);
      expect(c.frames.length).toBe(source.clips[c.sourceId].frames.length);
      expect(c.labels).toEqual(source.clips[c.sourceId].labels);
      for (const f of c.frames)
        for (const p of f) {
          expect(p.matrix.every(Number.isFinite)).toBe(true);
          expect(p.binding).not.toMatch(/elixirRegen|cheer_button|_signal/);
        }
    }
    for (const [id, style] of Object.entries(data.texts))
      expect(style).toEqual(source.texts[id]);
    expect(data.clips.HUD_topRight.labels).toEqual({
      out_start: 0,
      out_end: 14,
    });
    expect(data.clips.HUD_topRight_overtime.labels).toEqual({
      in_start: 0,
      in_end: 14,
    });
    expect(data.clips.crown_player.frames).toHaveLength(100);
    expect(data.clips.crown_enemy.frames).toHaveLength(100);
    expect(
      data.clips.HUD_topRight_overtime.frames[14].some(
        (p) => p.color[0] === 200 && p.color[2] === 30,
      ),
    ).toBe(true);
    for (const s of Object.values(data.shapes))
      for (const p of s.polygons ?? [s])
        if (p.solid === undefined) {
          const m = textureMatrix(p);
          expect(m.every(Number.isFinite)).toBe(true);
          p.uv.forEach(([u, v], i) => {
            expect(
              Math.abs(m[0] * u + m[2] * v + m[4] - p.xy[i][0]),
            ).toBeLessThan(0.05);
            expect(
              Math.abs(m[1] * u + m[3] * v + m[5] - p.xy[i][1]),
            ).toBeLessThan(0.05);
          });
        }
  });
  it("restores the exact timer transition from the match clock and keeps regulation endings in regulation", () => {
    const at = (time: number, winner: string | null = null, reduced = false) =>
      hudClock({ time, winner, mode: "classic" }, reduced);
    expect(at(0)).toMatchObject({
      name: "HUD_topRight",
      frame: 0,
      seconds: 180,
    });
    expect(at(179.9)).toMatchObject({ frame: 0, seconds: 1 });
    expect(at(180)).toMatchObject({
      name: "HUD_topRight",
      frame: 0,
      seconds: 0,
      overtime: true,
    });
    expect(at(180.2).frame).toBe(6);
    expect(at(180.499).frame).toBe(14);
    expect(at(180.5)).toMatchObject({
      name: "HUD_topRight_overtime",
      frame: 0,
      seconds: 120,
    });
    expect(at(180.7).frame).toBe(6);
    expect(at(181)).toMatchObject({ frame: 14, seconds: 119 });
    expect(at(180, "blue")).toMatchObject({
      name: "HUD_topRight",
      frame: 0,
      overtime: false,
    });
    expect(at(180, null, true)).toMatchObject({
      name: "HUD_topRight_overtime",
      frame: 14,
      seconds: 120,
    });
    expect([0, 1, 60, 119, 180].map(hudTimeText)).toEqual([
      "0:00",
      "0:01",
      "1:00",
      "1:59",
      "3:00",
    ]);
    expect(at(301).seconds).toBe(0);
  });
  it("animates only newly awarded crowns and holds or resets them across pause and seek", () => {
    const f = new CrownFeedback();
    f.reset(10, { blue: 1, red: 0 });
    expect(f.frame("blue")).toBe(99);
    f.update(10.1, { blue: 2, red: 0 });
    expect(f.frame("blue")).toBe(0);
    expect(f.frame("red")).toBe(99);
    f.update(10.2, { blue: 2, red: 0 });
    expect(f.frame("blue")).toBe(3);
    f.update(10.2, { blue: 2, red: 0 });
    expect(f.frame("blue")).toBe(3);
    f.update(10.3, { blue: 2, red: 1 });
    expect(f.frame("red")).toBe(0);
    expect(f.frame("blue")).toBe(6);
    expect(f.frame("blue", true)).toBe(99);
    f.reset(200, { blue: 3, red: 2 });
    expect(f.frame("blue")).toBe(99);
    expect(f.frame("red")).toBe(99);
    f.update(1, { blue: 0, red: 0 });
    expect(f.counts).toEqual({ blue: 0, red: 0 });
    expect(f.frame("blue")).toBe(99);
    f.update(2, { blue: 0, red: 3 });
    expect(f.frame("red")).toBe(0);
    f.update(6, { blue: 0, red: 3 });
    expect(f.frame("red")).toBe(99);
  });
  it("composes each team crown independently in the source portrait and landscape layouts", () => {
    for (const landscape of [false, true]) {
      const still = hudParts(data, landscape),
        pulse = hudParts(data, landscape, 1, 99);
      expect(
        pulse.every((p) => p.shape !== -1 && p.matrix.every(Number.isFinite)),
      ).toBe(true);
      const binding = (parts: typeof still, name: string) =>
        parts.filter((p) => p.binding === name);
      expect(binding(pulse, "starEnemy")).toEqual(binding(still, "starEnemy"));
      expect(binding(pulse, "starPlayer")[0].matrix[0]).toBeGreaterThan(
        binding(still, "starPlayer")[0].matrix[0],
      );
      expect(binding(pulse, "starPlayer")[0].matrix[4]).toBe(
        landscape ? -175 : -29,
      );
      expect(binding(pulse, "starEnemy")[0].matrix[5]).toBe(
        landscape ? -38 : -63,
      );
      expect(pulse.filter((p) => p.text !== undefined)).toHaveLength(2);
    }
  });
});
