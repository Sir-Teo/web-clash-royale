import { describe, expect, it, vi, afterEach } from "vitest";
import { Texture } from "three";
import { RenderQuality } from "../src/render/quality";
import { limitTexture, textureSize, loadLimited } from "../src/render/texture";

afterEach(() => vi.unstubAllGlobals());

describe("phone rendering budgets", () => {
  it("bounds high-density phone rendering independently of desktop quality", () => {
    const phone = new RenderQuality(true, 3),
      desktop = new RenderQuality(false, 3);
    expect([
      phone.targetFps,
      phone.maximumRatio,
      phone.minimumRatio,
      phone.textureLimit,
    ]).toEqual([30, 1, 0.65, 1024]);
    expect([
      desktop.targetFps,
      desktop.maximumRatio,
      desktop.minimumRatio,
      desktop.textureLimit,
    ]).toEqual([60, 2, 1, Infinity]);
    expect(new RenderQuality(false, 1).minimumRatio).toBe(0.75);
  });
  it.each([0, NaN, Infinity, -1])(
    "recovers invalid device density %s",
    (ratio) => {
      expect(new RenderQuality(true, ratio).maximumRatio).toBe(1);
    },
  );
  it("keeps the minimum within a low-density device's actual maximum", () => {
    const quality = new RenderQuality(true, 0.5);
    expect(quality.maximumRatio).toBe(0.5);
    expect(quality.minimumRatio).toBe(0.5);
    expect(quality.sample(10, true, 0.5)).toBe(0.5);
  });
  it("reacts to severe overload in the first active sample", () => {
    expect(new RenderQuality(true, 3).sample(10, true, 1)).toBe(0.65);
    expect(new RenderQuality(false, 2).sample(20, true, 2)).toBe(1);
  });
  it("reduces sustained moderate load in steps with a cooldown", () => {
    const quality = new RenderQuality(true, 3);
    let ratio = 1;
    const samples = Array.from(
      { length: 6 },
      () => (ratio = quality.sample(24, true, ratio)),
    );
    expect(samples).toEqual([1, 0.75, 0.75, 0.75, 0.75, 0.65]);
  });
  it("treats a stable 30 FPS phone as healthy", () => {
    const quality = new RenderQuality(true, 3);
    let ratio = 1;
    for (let i = 0; i < 60; i++) ratio = quality.sample(30, true, ratio);
    expect(ratio).toBe(1);
  });
  it("recovers gradually after sustained headroom and respects the maximum", () => {
    const quality = new RenderQuality(true, 3);
    let ratio = quality.sample(10, true, 1);
    for (let i = 0; i < 11; i++) ratio = quality.sample(30, true, ratio);
    expect(ratio).toBe(0.65);
    ratio = quality.sample(30, true, ratio);
    expect(ratio).toBeCloseTo(0.775);
    for (let i = 0; i < 80; i++) ratio = quality.sample(30, true, ratio);
    expect(ratio).toBe(1);
  });
  it("permits emergency reduction even while recovering in a cooldown", () => {
    const quality = new RenderQuality(true, 3);
    let ratio = 0.75;
    for (let i = 0; i < 10; i++) ratio = quality.sample(30, true, ratio);
    expect(ratio).toBe(0.875);
    expect(quality.sample(10, true, ratio)).toBe(0.65);
  });
  it("resets sample history while paused and ignores invalid FPS", () => {
    const quality = new RenderQuality(true, 3);
    expect(quality.sample(24, true, 1)).toBe(1);
    expect(quality.sample(0, false, 1)).toBe(1);
    expect(quality.sample(24, true, 1)).toBe(1);
    for (const fps of [0, -1, Infinity, NaN])
      expect(quality.sample(fps, true, 1)).toBe(1);
    expect(quality.sample(24, true, 1)).toBe(1);
  });
});

describe("bounded phone atlas storage", () => {
  it("bounds concurrent decodes while retaining every atlas index", async () => {
    let active = 0,
      peak = 0;
    const indexes: number[] = [];
    await loadLimited([5, 4, 3, 2, 1, 0], 2, async (item, index) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      indexes[index] = item;
      active--;
    });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(indexes).toEqual([5, 4, 3, 2, 1, 0]);
  });
  it("supports empty and unrestricted loads and rejects invalid concurrency", async () => {
    const visit = vi.fn(async () => {});
    await loadLimited([], 4, visit);
    expect(visit).not.toHaveBeenCalled();
    await loadLimited([1, 2, 3], Infinity, visit);
    expect(visit).toHaveBeenCalledTimes(3);
    await expect(loadLimited([1], 0, visit)).rejects.toThrow("loading limit");
    await expect(loadLimited([1], 0.5, visit)).rejects.toThrow("loading limit");
    await expect(loadLimited([1], NaN, visit)).rejects.toThrow("loading limit");
  });
  it.each([
    [2048, 1024, 1024, 1024, 512],
    [1012, 4080, 1024, 254, 1024],
    [512, 192, 1024, 512, 192],
    [2048, 2044, Infinity, 2048, 2044],
    [1, 4096, 1024, 1, 1024],
  ])(
    "fits %sx%s into %s without changing its atlas proportions",
    (w, h, limit, width, height) => {
      expect(textureSize(w, h, limit)).toEqual({ width, height });
    },
  );
  it("releases the oversized source from the texture while retaining its sampling settings", () => {
    const original = { width: 2048, height: 1024 };
    const texture = new Texture(original as any);
    const context = {
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const flip = texture.flipY,
      space = texture.colorSpace,
      version = texture.version;
    expect(limitTexture(texture, 1024)).toBe(texture);
    expect(texture.image).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([1024, 512]);
    expect(context.drawImage).toHaveBeenCalledWith(original, 0, 0, 1024, 512);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(texture.flipY).toBe(flip);
    expect(texture.colorSpace).toBe(space);
    expect(texture.version).toBeGreaterThan(version);
  });
  it("keeps small and desktop sources without allocating another image", () => {
    const createElement = vi.fn();
    vi.stubGlobal("document", { createElement });
    const texture = new Texture({ width: 512, height: 256 } as any),
      original = texture.image;
    limitTexture(texture, 1024);
    limitTexture(texture, Infinity);
    expect(texture.image).toBe(original);
    expect(createElement).not.toHaveBeenCalled();
  });
  it("retains the original texture if canvas storage is unavailable", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    const texture = new Texture({ width: 2048, height: 2048 } as any),
      original = texture.image;
    limitTexture(texture, 1024);
    expect(texture.image).toBe(original);
  });
});
