import { describe, it, expect } from "vitest";
import { facing, selectClip, animationFrame } from "../src/render/animation";
import type { AnimationClip } from "../src/render/animation";
const clip: AnimationClip = {
  fps: 30,
  frames: Array.from({ length: 35 }, (_, i) => i),
  source: "Knight_attack1_1",
};
describe("native animation playback", () => {
  it("uses all nine facing angles and mirrors west-facing motion", () => {
    expect(facing(0, -1)).toEqual({ direction: 1, flip: false });
    expect(facing(1, 0)).toEqual({ direction: 5, flip: false });
    expect(facing(-1, 0)).toEqual({ direction: 5, flip: true });
    expect(facing(0, 1)).toEqual({ direction: 9, flip: false });
    expect(
      facing(Math.sin(Math.PI / 8), -Math.cos(Math.PI / 8)).direction,
    ).toBe(2);
  });
  it("preserves native timing and holds the last attack pose until recovery ends", () => {
    expect(animationFrame(clip, 0.5, true, 1.2)).toBe(15);
    expect(animationFrame(clip, 1.19, true, 1.2)).toBe(34);
    expect(animationFrame(clip, 0.4, false, 1.2)).toBe(12);
    expect(animationFrame(clip, 1.3, false, 1.2)).toBe(4);
  });
  it("compresses long source attacks only when the game attack interval is shorter", () => {
    expect(animationFrame(clip, 0.4, true, 0.8)).toBe(17);
    expect(animationFrame(clip, 0.79, true, 0.8)).toBe(34);
  });
  it("keeps team coloring when falling back to a one-direction Balloon sequence", () => {
    const red = { ...clip, source: "balloon1_enemy_run1_1" };
    expect(
      selectClip({ "red-run-1": red, "blue-run-5": clip }, "red", "run", 5),
    ).toBe(red);
  });
});
