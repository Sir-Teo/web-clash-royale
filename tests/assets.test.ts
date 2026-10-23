import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../src/game/cards";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
describe("bundled game artwork", () => {
  it("preserves both teams' building directions and Tesla's labeled state transitions", () => {
    const manifest = json("public/assets/buildings/manifest.json");
    expect(manifest.files).toHaveLength(3);
    for (const source of manifest.sourceTables)
      expect(
        createHash("sha256").update(readFileSync(source.path)).digest("hex"),
      ).toBe(source.sha256);
    for (const file of manifest.files) {
      const digest = (path: string) =>
        createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(digest(`reference/sc/${file.source}.bin`)).toBe(
        file.metadataSha256,
      );
      expect(digest(`public/assets/buildings/${file.id}.json`)).toBe(
        file.dataSha256,
      );
      for (const texture of file.textures)
        expect(digest(`public/assets/buildings/${texture.file}`)).toBe(
          texture.sha256,
        );
      const data = json(`public/assets/buildings/${file.id}.json`);
      if (file.id === "king") {
        expect(data.attachedCharacterHeight).toBe(2.2);
        expect(data.clips["blue-sleep"].frames).toHaveLength(86);
        expect(data.clips["red-sleep"].frames).toHaveLength(99);
        expect(data.clips["blue-front"].frames).toHaveLength(86);
        expect(data.clips["red-base"].frames).toHaveLength(99);
        for (const team of ["blue", "red"]) {
          expect(data.clips[`${team}-turret`].frames).toHaveLength(36);
          for (const layer of ["", "-front"]) {
            const clip = data.clips[`princess-${team}${layer}`];
            expect(clip.frames).toHaveLength(1);
            expect(clip.source).toBe(
              `StarTower_${layer ? "top" : "base"}_${team}`,
            );
          }
        }
      }
      for (const team of ["blue", "red"]) {
        const clip = data.clips[team];
        expect(clip.frames).toHaveLength(
          file.id === "tesla" ? 39 : file.id === "king" ? 98 : 19,
        );
        if (file.id === "tesla")
          expect(clip.labels).toEqual({
            deploy: 0,
            idle: 1,
            appear_start: 2,
            appear_end: 21,
            hide_start: 22,
            hide_end: 38,
          });
        if (file.id === "king")
          expect(clip.labels).toEqual({ idle: 0, start: 1, stop: 97 });
      }
      for (const clip of Object.values(data.clips) as any[])
        for (const frame of clip.frames)
          for (const part of data.frames[frame]) {
            expect(part.matrix.every(Number.isFinite)).toBe(true);
            expect(data.shapes[part.shape].length).toBeGreaterThan(0);
            for (const polygon of data.shapes[part.shape])
              expect(data.textures[polygon.sheet]).toBeDefined();
          }
    }
  });
  it("retains the original effects clips, textures and combat source tables", () => {
    const manifest = json("public/assets/effects/manifest.json");
    const digest = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digest("reference/sc/effects.bin")).toBe(manifest.metadataSha256);
    expect(digest("public/assets/effects/effects.json")).toBe(
      manifest.dataSha256,
    );
    for (const t of manifest.textures)
      expect(digest(`public/assets/effects/${t.file}`)).toBe(t.sha256);
    const data = json("public/assets/effects/effects.json");
    expect(Object.keys(data.clips)).toHaveLength(183);
    for (const source of [...manifest.sources, ...manifest.inputs])
      expect(digest(source.path)).toBe(source.sha256);
    for (const name of ["balloon_bomb_blue", "balloon_bomb_red"]) {
      expect(data.clips[name].frames).toHaveLength(31);
      expect(data.clips[name].fps).toBe(30);
      expect(data.clips[name].labels).toEqual({
        attack_start: 0,
        attack_end: 30,
      });
    }
    expect(data.clips.bomb_destruction_state.frames).toHaveLength(79);
    expect(data.clips.crown_rotate_anim.frames).toHaveLength(16);
    expect(data.clips.crown_rotate_anim.fps).toBe(30);
    for (const clip of Object.values(data.clips) as any[]) {
      expect(clip.frames.length).toBeGreaterThan(0);
      expect(clip.bounds.every(Number.isFinite)).toBe(true);
      for (const frame of clip.frames)
        for (const part of data.frames[frame]) {
          expect(part.matrix.every(Number.isFinite)).toBe(true);
          expect(part.color.every((n: number) => n >= 0 && n <= 255)).toBe(
            true,
          );
          for (const polygon of data.shapes[part.shape]) {
            expect(data.textures[polygon.sheet]).toBeDefined();
            expect(polygon.xy.length).toBe(polygon.uv.length);
            expect(
              polygon.uv.flat().every((n: number) => n >= 0 && n <= 1),
            ).toBe(true);
          }
        }
    }
    for (const file of json("reference/logic/manifest.json").files)
      expect(digest(file.path)).toBe(file.sha256);
    const client = json("reference/client/manifest.json");
    for (const file of [...client.files, client.output])
      expect(digest(file.path)).toBe(file.sha256);
    const destruction = json(client.output.path);
    for (const emitter of Object.values(destruction.emitters) as any[])
      for (const name of emitter.clips) expect(data.clips[name]).toBeDefined();
  });
  it("matches every imported card, character and sound to its recorded hash", () => {
    const manifest = json("public/assets/manifest.json");
    for (const file of manifest.files) {
      const bytes = readFileSync(`public/assets/${file.path}`);
      expect(createHash("sha256").update(bytes).digest("hex"), file.path).toBe(
        file.sha256,
      );
    }
    for (const c of CARDS)
      expect(existsSync(`public/assets/cards/${c.id}.png`), c.id).toBe(true);
  });
  it("preserves full source animations and every referenced UV polygon", () => {
    const manifest = json("public/assets/animations/manifest.json");
    expect(manifest.files.length).toBe(37);
    let total = 0;
    for (const file of manifest.files) {
      const bytes = readFileSync(`public/assets/animations/${file.id}.json`);
      expect(
        createHash("sha256")
          .update(readFileSync(`reference/sc/${file.source}.bin`))
          .digest("hex"),
      ).toBe(file.metadataSha256);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        file.dataSha256,
      );
      for (const texture of file.textures) {
        expect(
          createHash("sha256")
            .update(readFileSync(`public/assets/animations/${texture.file}`))
            .digest("hex"),
        ).toBe(texture.sha256);
      }
      const data = JSON.parse(bytes.toString());
      expect(data.anchor.every(Number.isFinite)).toBe(true);
      for (const sequence of Object.values(data.clips) as {
        fps: number;
        frames: number[];
        source: string;
      }[]) {
        expect(sequence.fps).toBeGreaterThanOrEqual(24);
        expect(sequence.frames.length).toBeGreaterThan(0);
        total += sequence.frames.length;
        for (const index of sequence.frames) {
          expect(data.frames[index].length).toBeGreaterThan(0);
          for (const part of data.frames[index]) {
            expect(part.matrix.every(Number.isFinite)).toBe(true);
            expect(part.color.every((v: number) => v >= 0 && v <= 255)).toBe(
              true,
            );
            for (const polygon of data.shapes[part.shape]) {
              expect(data.textures[polygon.sheet]).toBeDefined();
              expect(polygon.xy.length).toBe(polygon.uv.length);
              expect(polygon.xy.length).toBeGreaterThanOrEqual(3);
              expect(polygon.xy.flat().every(Number.isFinite)).toBe(true);
              expect(
                polygon.uv.flat().every((v: number) => v >= 0 && v <= 1),
              ).toBe(true);
            }
          }
        }
      }
      const directions =
        file.id === "balloon" ? [1] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (const direction of directions) {
        expect(
          data.clips[`blue-run-${direction}`].frames.length,
        ).toBeGreaterThan(4);
        if (file.id !== "skeletons" && file.id !== "bats")
          expect(
            data.clips[`red-run-${direction}`].frames.length,
          ).toBeGreaterThan(4);
      }
      if (file.id === "baby-dragon")
        expect(
          Object.values(data.clips).every((c: any) =>
            c.source.startsWith("baby_dragon_"),
          ),
        ).toBe(true);
      if (file.id === "tower-princess") {
        expect(data.anchor).toEqual([0, 0]);
        expect(Object.keys(data.clips)).toHaveLength(54);
        for (const [name, clip] of Object.entries(data.clips) as [
          string,
          any,
        ][]) {
          expect(clip.source.startsWith("princess_tower_")).toBe(true);
          expect(clip.fps).toBe(24);
          expect(clip.frames).toHaveLength(name.includes("attack") ? 40 : 30);
        }
      }
      if (file.id === "prince")
        expect(data.clips["blue-charge-1"].frames.length).toBeGreaterThan(4);
    }
    expect(total).toBeGreaterThan(16000);
  }, 20000);
  it("includes every reconstructed stadium decoration and static unit", () => {
    const layout = json("public/assets/scenery/goblin-layout.json");
    expect(layout.length).toBeGreaterThan(10);
    for (const item of layout) {
      expect(existsSync(`public/assets/scenery/${item.file}`)).toBe(true);
      expect(item.width > 0 && item.height > 0).toBe(true);
      expect(
        item.positions.every(
          (p: { x: number; y: number }) =>
            Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
      ).toBe(true);
    }
    for (const id of ["king", "princess-base", "balloon", "cannon", "tesla"])
      for (const team of ["blue", "red"])
        expect(existsSync(`public/assets/scenery/${id}-${team}.png`)).toBe(
          true,
        );
  });
});
