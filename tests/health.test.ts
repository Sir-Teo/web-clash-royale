import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSC } from "../scripts/lib/sc.mjs";
import { csvRows } from "../scripts/lib/csv.mjs";
import {
  healthFrame,
  healthParts,
  healthSelection,
  type HealthData,
} from "../src/ui/health-data";
import { textureMatrix } from "../src/ui/native";
import type { Entity } from "../src/game/engine";
const data: HealthData = JSON.parse(
  readFileSync("public/assets/ui/health/health.json", "utf8"),
);
const entity = (changes: Partial<Entity> = {}) =>
  ({
    card: "knight",
    kind: "troop",
    team: "blue",
    hp: 100,
    maxHp: 100,
    age: 0,
    active: true,
    deploy: 0,
    ...changes,
  }) as Entity;
describe("native health HUD", () => {
  it("retains 12 roots, ten independent 100-state fills, text styles and all source/output hashes", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/ui/health/manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const s of manifest.sources)
      if (s.path) expect(hash(s.path)).toBe(s.sha256);
    for (const f of manifest.files)
      expect(hash(`public/assets/ui/health/${f.file}`)).toBe(f.sha256);
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    expect(Object.keys(data.clips)).toHaveLength(22);
    expect(Object.keys(data.bars)).toHaveLength(10);
    for (const [name, c] of Object.entries(data.clips) as [string, any][]) {
      expect(c.frames).toHaveLength(source.clips[c.sourceId].frames.length);
      expect(c.fps).toBe(source.clips[c.sourceId].fps);
      expect(c.labels).toEqual(source.clips[c.sourceId].labels);
      if (name.endsWith("_bar")) expect(c.frames).toHaveLength(100);
      for (const f of c.frames)
        for (const p of f) expect(p.matrix.every(Number.isFinite)).toBe(true);
    }
    for (const [id, t] of Object.entries(data.texts))
      expect(t).toEqual(source.texts[id]);
    for (const s of Object.values(data.shapes))
      for (const p of s.polygons ?? [s]) {
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
        const [x, y, w, h] = data.atlas.regions[p.file];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(data.atlas.width);
        expect(y + h).toBeLessThanOrEqual(data.atlas.textY);
      }
  });
  it("preserves source health sizes and offsets for the complete playable entity roster", () => {
    expect(Object.keys(data.profiles)).toHaveLength(27);
    for (const p of Object.values(data.profiles)) {
      const row = csvRows(
        readFileSync(`reference/logic/${p.table}.csv`, "utf8"),
      ).find((r: any) => r.Name === p.source);
      expect(p.healthBar).toBe(row.HealthBar);
      expect(p.offsetY).toBe(Number(row.HealthBarOffsetY));
      expect(p.showNumber).toBe(row.ShowHealthNumber === "true");
    }
    expect(data.profiles.giant.healthBar).toBe("High");
    expect(data.profiles.pekka.healthBar).toBe("Medium");
    expect(data.profiles.archers.healthBar).toBe("Small");
  });
  it("selects fill states independently of the King animation and removes empty tower fills", () => {
    expect([1, 0.75, 0.5, 0.25, 0, 2, -1].map(healthFrame)).toEqual([
      0, 25, 50, 74, 99, 0, 99,
    ]);
    const name = "hp_player_wizard";
    for (const frame of [0, 16, 31])
      for (const ratio of [0, 0.25, 0.75, 1]) {
        const p = healthParts(data, name, ratio, frame);
        expect(
          p.every((v) => v.shape !== -1 && v.matrix.every(Number.isFinite)),
        ).toBe(true);
        expect(p.filter((v) => v.binding !== "bar")).toEqual(
          data.clips[name].frames[frame].filter((v) => v.binding !== "bar"),
        );
      }
    const fill = (ratio: number) =>
      healthParts(data, "hp_enemy_tower_withNumber", ratio).filter(
        (p) => p.binding === "bar",
      );
    expect(fill(1)).toHaveLength(3);
    expect(fill(0)).toHaveLength(0);
    const full = healthParts(data, "hp_player_medium", 1)
        .filter((p) => p.binding === "bar")
        .at(-1)!,
      half = healthParts(data, "hp_player_medium", 0.5)
        .filter((p) => p.binding === "bar")
        .at(-1)!;
    expect(half.matrix[4]).toBeLessThan(full.matrix[4]);
  });
  it("restores badge visibility, hidden Tesla state and King activation directly from entity state", () => {
    expect(healthSelection(data, entity()).name).toBe("hp_player_number");
    expect(healthSelection(data, entity({ age: 2.5 })).visible).toBe(false);
    expect(healthSelection(data, entity({ hp: 50, age: 10 }))).toMatchObject({
      name: "hp_player_medium",
      fill: 50,
      visible: true,
    });
    expect(
      healthSelection(data, entity({ card: "giant", team: "red", hp: 25 })),
    ).toMatchObject({ name: "hp_enemy_high", fill: 74 });
    expect(
      healthSelection(
        data,
        entity({ card: "cannon", kind: "building", hp: 75 }),
      ).name,
    ).toBe("hp_player_medium");
    expect(
      healthSelection(
        data,
        entity({
          card: "tesla",
          kind: "building",
          hp: 50,
          burrow: { exposure: 0, idle: 0, phase: "hidden" },
        }),
      ).visible,
    ).toBe(false);
    expect(healthSelection(data, entity({ hp: 0 })).visible).toBe(false);
    const king = entity({
      kind: "tower",
      card: "tower",
      king: true,
      active: false,
    });
    expect(healthSelection(data, king).frame).toBe(0);
    king.active = true;
    king.activation = 3.3;
    expect(healthSelection(data, king).frame).toBe(0);
    king.activation = 3.3 - 1 / 30;
    expect(healthSelection(data, king).frame).toBe(1);
    king.activation = 0;
    expect(healthSelection(data, king).frame).toBe(31);
    king.active = false;
    expect(healthSelection(data, king).frame).toBe(0);
  });
});
