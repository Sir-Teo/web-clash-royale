import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../src/game/cards";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
describe("bundled game artwork", () => {
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
  it("keeps every sampled animation frame inside its atlas", () => {
    const manifest = json("public/assets/sprites/manifest.json");
    expect(manifest.files.length).toBe(17);
    for (const file of manifest.files) {
      const bytes = readFileSync(`public/assets/sprites/${file.id}.png`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        file.atlasSha256,
      );
      const data = json(`public/assets/sprites/${file.id}.json`);
      expect(data.anchor.every(Number.isFinite)).toBe(true);
      for (const sequence of Object.values(data.clips) as number[][]) {
        expect(sequence.length).toBeGreaterThan(0);
        for (const index of sequence) {
          const [x, y, w, h] = data.frames[index];
          expect(
            x >= 0 && y >= 0 && x + w <= data.width && y + h <= data.height,
          ).toBe(true);
        }
      }
    }
  });
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
