import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSC } from "../scripts/lib/sc.mjs";
import { textureMatrix } from "../src/ui/native";
import type { NativeData } from "../src/ui/native";

const directory = "public/assets/ui/connection";
const data: NativeData = JSON.parse(
  readFileSync(`${directory}/connection.json`, "utf8"),
);
describe("native connection warning", () => {
  it("retains all source frames, opacity, transforms, geometry and pinned assets", () => {
    const source = parseSC(readFileSync("reference/sc/ui.bin"));
    const id = source.names.bad_connection;
    const original = source.clips[id];
    const clip = data.clips.bad_connection;
    expect(id).toBe(4827);
    expect(clip.fps).toBe(60);
    expect(clip.frames).toHaveLength(60);
    expect(Object.keys(data.shapes).map(Number).sort()).toEqual(
      [1490, 676].sort(),
    );
    const round = (values: number[]) =>
      values.map((n) => Math.round(n * 100000) / 100000);
    for (const [index, frame] of original.frames.entries()) {
      expect(clip.frames[index]).toEqual(
        frame.map((part: any) => ({
          shape: part.id,
          binding: "",
          matrix: round(source.matrices[part.matrix] ?? [1, 0, 0, 1, 0, 0]),
          color: round(
            source.colors[part.color] ?? [0, 0, 0, 255, 255, 255, 255],
          ),
        })),
      );
    }
    const alphas = clip.frames.map(
      (frame) => frame.find((part) => part.shape === 676)!.color[3],
    );
    expect(Math.min(...alphas)).toBe(128);
    expect(Math.max(...alphas)).toBe(218);
    expect(alphas[0]).toBe(Math.max(...alphas));
    for (const [key, shape] of Object.entries(data.shapes)) {
      expect(shape.polygons).toHaveLength(source.shapes[key].length);
      for (const [index, polygon] of shape.polygons!.entries()) {
        expect(polygon.xy).toEqual(source.shapes[key][index].xy);
        const m = textureMatrix(polygon);
        polygon.uv.forEach(([u, v], i) => {
          expect(
            Math.abs(m[0] * u + m[2] * v + m[4] - polygon.xy[i][0]),
          ).toBeLessThan(0.05);
          expect(
            Math.abs(m[1] * u + m[3] * v + m[5] - polygon.xy[i][1]),
          ).toBeLessThan(0.05);
        });
      }
    }
    const manifest = JSON.parse(
      readFileSync(`${directory}/manifest.json`, "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const file of manifest.sources)
      if (file.path) expect(hash(file.path)).toBe(file.sha256);
    for (const file of manifest.files)
      expect(hash(`${directory}/${file.file}`)).toBe(file.sha256);
  });
});
