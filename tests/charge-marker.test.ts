import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSC } from "../scripts/lib/sc.mjs";
import data from "../src/render/charge-marker-data.json";

describe("native Prince charge callout", () => {
  it("retains the dynamic Supercell Magic text and all 43 source keyframes", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/charge-marker-manifest.json", "utf8"),
    );
    for (const file of [...manifest.inputs, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(file.path)).digest("hex"),
      ).toBe(file.sha256);
    const source = parseSC(readFileSync("reference/sc/effects.bin"));
    expect(data.texts[24]).toEqual(source.texts[24]);
    expect(data.texts[24]).toMatchObject({
      font: "Supercell-Magic",
      size: 18,
      align: 2,
      outlined: true,
      bounds: [-2, -2, 314, 21],
    });
    expect(data.translations.TID_CHARGE).toBe("Charge!");
    expect(data.clips.effect_charge.fps).toBe(30);
    const frames = data.clips.effect_charge.frames;
    expect(frames).toHaveLength(43);
    expect(frames.every((frame) => frame.length === 1)).toBe(true);
    expect(frames.every(([part]) => part.text === 24)).toBe(true);
    expect(frames[0][0].color[3]).toBe(0);
    expect(frames[4][0].color[3]).toBe(255);
    expect(frames[42][0].color[3]).toBe(0);
    expect(frames[0][0].matrix[3]).toBeLessThan(0);
    expect(frames[4][0].matrix[3]).toBe(1);
  });
});
