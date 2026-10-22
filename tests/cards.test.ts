import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HandReveal } from "../src/ui/cards";
import { CARDS } from "../src/game/cards";
import { textureMatrix } from "../src/ui/native";
import { parseSC } from "../scripts/lib/sc.mjs";
import { csvRows } from "../scripts/lib/csv.mjs";
const data = JSON.parse(
  readFileSync("public/assets/ui/cards/cards.json", "utf8"),
);
describe("native card artwork", () => {
  it("binds every playable card to its archived IconFile and verifies all retained sources and crops", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/cards/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const s of manifest.sources)
      if (s.path) expect(hash(s.path)).toBe(s.sha256);
    for (const f of manifest.files)
      expect(hash(`public/assets/ui/cards/${f.file}`)).toBe(f.sha256);
    const source = parseSC(readFileSync("reference/sc/ui-spells.bin"));
    expect(Object.keys(data.portraits).sort()).toEqual(
      CARDS.map((c) => c.id).sort(),
    );
    for (const c of Object.values(data.portraits) as any[]) {
      const row = csvRows(
        readFileSync(`reference/logic/${c.table}.csv`, "utf8"),
      ).find((r: any) => r.Name === c.row);
      expect(c.name).toBe(row.IconFile);
      expect(c.sourceId).toBe(source.names[row.IconFile]);
      const shape = source.clips[c.sourceId].frames[0][0].id;
      expect(data.shapes[c.shape].polygons[0].xy).toEqual(
        source.shapes[shape][0].xy,
      );
    }
    expect(data.portraits["skeleton-army"].name).toBe("skeleton_horde");
    for (const s of Object.values(data.shapes) as any[])
      for (const p of s.polygons) {
        if (p.solid !== undefined) continue;
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
  it("retains distinct hand/deck cost positions, selection states and the complete labeled reveal", () => {
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(Object.keys(data.clips)).toHaveLength(7);
    for (const c of Object.values(data.clips) as any[]) {
      expect(c.frames.length).toBe(source.clips[c.sourceId].frames.length);
      expect(c.fps).toBe(source.clips[c.sourceId].fps);
      expect(c.labels).toEqual(source.clips[c.sourceId].labels);
      for (const f of c.frames)
        for (const p of f) expect(p.matrix.every(Number.isFinite)).toBe(true);
    }
    expect(data.clips.reveal.labels).toEqual({
      show_start: 0,
      show_end: 19,
      hide_start: 20,
      hide_end: 29,
    });
    const cost = (name: string) =>
      data.clips[name].frames[0].find(
        (p: any) => p.binding === "elixar_count/count",
      ).matrix;
    expect(cost("hand")[5]).toBe(53);
    expect(cost("deck")[5]).toBe(-70);
    expect(data.clips["hand-selected"].frames[0].length).toBeGreaterThan(
      data.clips.hand.frames[0].length,
    );
    for (const [id, t] of Object.entries(data.texts))
      expect(t).toEqual(source.texts[id]);
  });
  it("reveals only changed slots, freezes with simulation time, and clears on seek/reset", () => {
    const r = new HandReveal();
    r.reset(20, ["knight", "archers"]);
    expect(r.frame(0, "knight", 20)).toBeNull();
    expect(r.frame(0, "giant", 21)).toBe(0);
    expect(r.frame(1, "archers", 21)).toBeNull();
    for (let i = 0; i < 100; i++) expect(r.frame(0, "giant", 21)).toBe(0);
    expect(r.frame(0, "giant", 21 + 1 / 60)).toBe(1);
    expect(r.frame(0, "giant", 21 + 19 / 60)).toBe(19);
    expect(r.frame(0, "giant", 21 + 20 / 60)).toBeNull();
    expect(r.frame(0, "knight", 22)).toBe(0);
    r.reset(130, ["knight", "archers"]);
    expect(r.frame(0, "knight", 130)).toBeNull();
    expect(r.frame(0, "giant", 131)).toBe(0);
    expect(r.frame(0, "knight", 0)).toBeNull();
  });
});
