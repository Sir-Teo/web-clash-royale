import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeData, Shape } from "../src/ui/native";

const images: {
  src: string;
  decoding: string;
  finish: () => void;
  fail: (error: Error) => void;
}[] = [];
let active = 0;
let peak = 0;

beforeEach(() => {
  vi.resetModules();
  images.length = 0;
  active = peak = 0;
  vi.stubGlobal(
    "Image",
    class {
      private source = "";
      decoding = "";
      private cancel = () => {};
      get src() {
        return this.source;
      }
      set src(value: string) {
        this.source = value;
        if (value === "data:,") this.cancel();
      }
      removeAttribute(attribute: string) {
        if (attribute === "src") {
          this.src = "";
          this.cancel();
        }
      }
      decode() {
        active++;
        peak = Math.max(peak, active);
        let settled = false;
        const complete = (callback: () => void) => {
          if (settled) return;
          settled = true;
          active--;
          callback();
        };
        return new Promise<void>((resolve, reject) => {
          this.cancel = () =>
            complete(() => reject(new Error("Image aborted")));
          images.push(
            Object.assign(this, {
              finish: () => complete(resolve),
              fail: (error: Error) => complete(() => reject(error)),
            }),
          );
        });
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = async () => {
  // Let the queue release completed jobs and start their successors.
  await Promise.resolve();
  await Promise.resolve();
};
const shape = (file: string, polygons?: Shape[]): Shape => ({
  file,
  polygons,
  width: 1,
  height: 1,
  xy: [],
  uv: [],
});

describe("shared native UI image loading", () => {
  it("releases stalled decodes so queued libraries can finish", async () => {
    vi.useFakeTimers();
    const { loadNativeImage } = await import("../src/ui/native-assets");
    const requests = Array.from({ length: 5 }, (_, index) =>
      loadNativeImage(`/stalled/${index}.png`),
    );
    const results = Promise.allSettled(requests);
    expect(images).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(images).toHaveLength(5);
    images[4].finish();
    expect((await results).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "fulfilled",
    ]);
    expect(images.slice(0, 4).every((image) => image.src === "")).toBe(true);
    expect(active).toBe(0);
    expect(peak).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces stalled requests and permits retry without a late completion losing the new request", async () => {
    vi.useFakeTimers();
    const { loadNativeImage } = await import("../src/ui/native-assets");
    const first = loadNativeImage("/stalled/retry.png");
    const result = first.catch((error: Error) => error.message);
    expect(loadNativeImage("/stalled/retry.png")).toBe(first);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toBe("Artwork loading timed out.");
    const retry = loadNativeImage("/stalled/retry.png");
    expect(retry).not.toBe(first);
    images[0].finish();
    await settle();
    expect(loadNativeImage("/stalled/retry.png")).toBe(retry);
    images[1].finish();
    await expect(retry).resolves.toBe(images[1]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears deadlines for successful and failed decodes", async () => {
    vi.useFakeTimers();
    const { loadNativeImage } = await import("../src/ui/native-assets");
    const success = loadNativeImage("/art/ok.png");
    const failure = loadNativeImage("/art/bad.png").catch(
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(24_999);
    images[0].finish();
    images[1].fail(new Error("Decode failed"));
    await expect(success).resolves.toBe(images[0]);
    expect(await failure).toBe("Decode failed");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(images[0].src).toBe("/art/ok.png");
    expect(active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds simultaneous libraries and the health atlas to four decodes", async () => {
    const { loadNativeImage, preloadNativeImages } =
      await import("../src/ui/native-assets");
    const data: Pick<NativeData, "shapes"> = {
      shapes: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [index, shape(`${index}.png`)]),
      ),
    };
    const first = preloadNativeImages(data, "/cards");
    const second = preloadNativeImages(data, "/intro");
    const atlas = loadNativeImage("/health/atlas.png");
    expect(images).toHaveLength(4);
    for (let index = 0; index < 19; index++) {
      images[index].finish();
      await settle();
    }
    await Promise.all([first, second, atlas]);
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(new Set(images.map((image) => image.src)).size).toBe(19);
    expect(images.every((image) => image.decoding === "async")).toBe(true);
  });

  it("coalesces duplicate crops and concurrent callers, skipping solid shapes", async () => {
    const { loadNativeImage, preloadNativeImages } =
      await import("../src/ui/native-assets");
    const data = {
      shapes: {
        0: shape("same.png"),
        1: shape("", [shape("same.png"), shape("other.png"), shape("")]),
        2: shape(""),
      },
    };
    const first = preloadNativeImages(data, "/art");
    const second = preloadNativeImages(data, "/art");
    const crop = loadNativeImage("/art/same.png");
    expect(crop).toBe(loadNativeImage("/art/same.png"));
    expect(images.map((image) => image.src)).toEqual([
      "/art/same.png",
      "/art/other.png",
    ]);
    images.forEach((image) => image.finish());
    await Promise.all([first, second, crop]);
    expect(await crop).toBe(images[0]);
  });

  it("releases failed requests and continues queued libraries before retrying", async () => {
    const { loadNativeImage } = await import("../src/ui/native-assets");
    const requests = Array.from({ length: 5 }, (_, index) =>
      loadNativeImage(`/art/${index}.png`),
    );
    const results = Promise.allSettled(requests);
    const failure = new Error("Decode failed");
    images[0].fail(failure);
    await settle();
    expect(images).toHaveLength(5);
    images.slice(1).forEach((image) => image.finish());
    expect((await results)[0]).toEqual({ status: "rejected", reason: failure });
    const retry = loadNativeImage("/art/0.png");
    expect(retry).not.toBe(requests[0]);
    images[5].finish();
    await expect(retry).resolves.toBe(images[5]);
    expect(active).toBe(0);
  });

  it("drops completed image references and accepts empty artwork", async () => {
    const { loadNativeImage, preloadNativeImages } =
      await import("../src/ui/native-assets");
    await preloadNativeImages({ shapes: {} }, "/empty");
    expect(images).toHaveLength(0);
    const first = loadNativeImage("/art/one.png");
    images[0].finish();
    await first;
    const next = loadNativeImage("/art/one.png");
    expect(next).not.toBe(first);
    images[1].finish();
    await next;
  });
});
