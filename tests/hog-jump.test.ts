import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Entity } from "../src/game/engine";
import { destructionPlan, landingEffect } from "../src/render/destruction";
import { hogJumpHeight, NativeHogLandings } from "../src/render/hog-jump";
import definitions from "../src/render/destruction-data.json";

const hog = (team: "blue" | "red", y: number) =>
  ({
    id: team === "blue" ? 8 : 9,
    card: "hog-rider",
    team,
    x: 4,
    y,
    hp: 100,
    deploy: 0,
    move: 0,
  }) as Entity;

describe("native Hog Rider river landing", () => {
  it("binds the retained three-emitter, 70-particle landing composition", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const row = csvRows(
      readFileSync("reference/logic/characters.csv", "utf8"),
    ).find((r: any) => r.Name === "HogRider")!;
    expect(row.LandingEffect).toBe("hog_rider_landing");
    expect(definitions.landings["hog-rider"].source).toBe(row.LandingEffect);
    expect(landingEffect("hog-rider")).toBe("land:hog-rider");
    expect(landingEffect("knight")).toBeUndefined();
    const particles = destructionPlan("land:hog-rider", 42);
    expect(particles).toHaveLength(70);
    expect(particles.some((p) => p.ground)).toBe(true);
    expect(particles.some((p) => !p.ground)).toBe(true);
    expect(destructionPlan("land:hog-rider", 42, "red")).toEqual(particles);
  });

  it("raises only a crossing Hog and anchors each landing at the far bank", () => {
    expect(hogJumpHeight(hog("blue", 17.2))).toBe(0);
    expect(hogJumpHeight(hog("blue", 16))).toBeCloseTo(2.2);
    expect(hogJumpHeight(hog("red", 16))).toBeCloseTo(2.2);
    expect(hogJumpHeight(hog("blue", 14.8))).toBe(0);
    expect(hogJumpHeight({ ...hog("blue", 16), deploy: 1 })).toBe(0);
    const blue = hog("blue", 15);
    const red = hog("red", 17);
    const effects = new NativeHogLandings();
    expect(effects.consume([blue, red], 29, 0)).toEqual([]);
    blue.y = 14.6;
    red.y = 17.4;
    blue.move = red.move = 0.1;
    const landings = effects.consume([blue, red], 29, 0.1);
    expect(landings).toMatchObject([
      { effect: "land:hog-rider", origin: { x: 4, y: 14.8 }, team: "blue" },
      { effect: "land:hog-rider", origin: { x: 4, y: 17.2 }, team: "red" },
    ]);
    expect(landings[0].age).toBeCloseTo(0.05);
    expect(effects.consume([blue, red], 29, 0.1)).toEqual([]);
    effects.reset();
    blue.y = 15;
    red.y = 17;
    expect(effects.consume([blue, red], 29, 0)).toEqual([]);
    blue.y = 14.6;
    red.y = 17.4;
    expect(effects.consume([blue, red], 29, 0.1)).toEqual([]);
    blue.y = 22;
    expect(effects.consume([blue, red], 29, 0.2)).toEqual([]);
    blue.y = 14.6;
    expect(effects.consume([blue, red], 29, 0.3)).toEqual([]);
  });
});
