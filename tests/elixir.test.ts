import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ElixirFeedback } from "../src/ui/elixir";
import { textureMatrix } from "../src/ui/native";
import { parseSC } from "../scripts/lib/sc.mjs";
const data = JSON.parse(
  readFileSync("public/assets/ui/elixir/elixir.json", "utf8"),
);
describe("native elixir HUD", () => {
  it("retains all eight full source clips, text styles, and hashed assets", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/elixir/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const s of manifest.sources)
      if (s.path) expect(hash(s.path)).toBe(s.sha256);
    for (const f of manifest.files)
      expect(hash(`public/assets/ui/elixir/${f.file}`)).toBe(f.sha256);
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(Object.keys(data.clips)).toHaveLength(8);
    expect(Object.values(data.clips).map((c: any) => c.frames.length)).toEqual([
      1, 11, 25, 30, 30, 10, 40, 15,
    ]);
    for (const c of Object.values(data.clips) as any[]) {
      expect(c.frames.length).toBe(source.clips[c.sourceId].frames.length);
      expect(c.fps).toBe(source.clips[c.sourceId].fps);
      for (const f of c.frames)
        for (const p of f) expect(p.matrix.every(Number.isFinite)).toBe(true);
    }
    for (const [id, t] of Object.entries(data.texts))
      expect(t).toEqual(source.texts[id]);
    for (const s of Object.values(data.shapes) as any[])
      for (const p of s.polygons) {
        if (p.solid !== undefined) {
          expect(p.solid).toBeGreaterThan(0);
          continue;
        }
        const m = textureMatrix(p);
        expect(m.every(Number.isFinite)).toBe(true);
        p.uv.forEach(([u, v]: number[], i: number) => {
          expect(
            Math.abs(m[0] * u + m[2] * v + m[4] - p.xy[i][0]),
          ).toBeLessThan(0.05);
          expect(
            Math.abs(m[1] * u + m[3] * v + m[5] - p.xy[i][1]),
          ).toBeLessThan(0.05);
        });
      }
  });
  it("preserves repeated display-list child identities for all nine dividers", () => {
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    const bar = source.clips[data.clips.elixir_bar.sourceId];
    const dividers = bar.frames[0].filter((p: any) =>
      /^d[1-9]$/.test(bar.children[p.child].name),
    );
    expect(new Set(dividers.map((p: any) => p.id)).size).toBe(1);
    expect(new Set(dividers.map((p: any) => p.child)).size).toBe(9);
    expect(
      data.clips.elixir_bar.frames[0]
        .filter((p: any) => /^d[1-9]$/.test(p.binding))
        .map((p: any) => p.binding),
    ).toEqual(["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"]);
  });
  it("freezes feedback when paused, expires source clips, and clears transient effects on seeking", () => {
    const hud = new ElixirFeedback();
    hud.reset(20, 5, 1);
    hud.spend(3, 20, 2);
    hud.update(20, 2, 1);
    const held = JSON.stringify(hud);
    for (let i = 0; i < 100; i++) hud.update(20, 2, 1);
    expect(JSON.stringify(hud)).toBe(held);
    hud.update(21, 3, 2);
    expect(hud.gain).toBe(21);
    expect(hud.rateStart).toBe(21);
    hud.update(21.4, 3.2, 2);
    expect(hud.gain).toBeNull();
    expect(hud.spends).toHaveLength(0);
    expect(hud.pulse).toBe(21);
    hud.update(22, 3.5, 2);
    expect(hud.pulse).toBeNull();
    hud.spend(1, 22, 2.5);
    hud.reset(130, 10, 2);
    expect(hud.spends).toHaveLength(0);
    expect(hud.fullSince).toBe(130);
    expect(hud.rateStart).toBeNull();
    hud.update(10, 4, 1);
    expect(hud.fullSince).toBeNull();
    expect(hud.gain).toBeNull();
  });
  it("bounds overlapping spend effects and preserves full-bar timing until elixir is spent", () => {
    const hud = new ElixirFeedback();
    hud.reset(0, 9, 1);
    hud.update(2.8, 10, 1);
    expect(hud.fullSince).toBe(2.8);
    hud.update(5, 10, 1);
    expect(hud.fullSince).toBe(2.8);
    for (let i = 0; i < 5; i++) hud.spend(1, 5 + i / 30, 9 - i);
    expect(hud.spends).toHaveLength(4);
    hud.update(5.2, 5, 1);
    expect(hud.fullSince).toBeNull();
    hud.update(7, 5.6, 1);
    expect(hud.spends).toHaveLength(0);
  });
});
