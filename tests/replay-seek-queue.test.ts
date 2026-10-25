import { describe, expect, it, vi } from "vitest";
import { ReplaySeekQueue } from "../src/ui/replay-seek-queue";

function setup() {
  const frames: FrameRequestCallback[] = [];
  const applied: number[] = [];
  const schedule = vi.fn(
    (callback: FrameRequestCallback) => frames.push(callback) - 1,
  );
  const cancel = vi.fn();
  const queue = new ReplaySeekQueue(
    (tick) => applied.push(tick),
    schedule,
    cancel,
  );
  return { frames, applied, schedule, cancel, queue };
}

describe("queued replay scrubbing", () => {
  it("coalesces a burst into the latest position in one frame", () => {
    const s = setup();
    for (const tick of [300, 900, 100, 600]) s.queue.request(tick);
    expect(s.applied).toEqual([]);
    expect(s.schedule).toHaveBeenCalledTimes(1);
    expect(s.queue.target).toBe(600);
    s.frames[0](0);
    expect(s.applied).toEqual([600]);
    expect(s.queue.target).toBeUndefined();
  });

  it("flushes the final drag position and ignores its cancelled callback", () => {
    const s = setup();
    s.queue.request(300);
    s.queue.request(600);
    s.queue.flush();
    expect(s.applied).toEqual([600]);
    expect(s.cancel).toHaveBeenCalledWith(0);
    s.frames[0](0);
    expect(s.applied).toEqual([600]);
  });

  it("cancels an old replay request without consuming the new replay's pending target", () => {
    const s = setup();
    s.queue.request(900);
    s.queue.cancel();
    expect(s.queue.target).toBeUndefined();
    s.queue.request(300);
    s.frames[0](0);
    expect(s.applied).toEqual([]);
    expect(s.queue.target).toBe(300);
    s.frames[1](0);
    expect(s.applied).toEqual([300]);
  });

  it("keeps zero as a real pending seek and flushes it only once", () => {
    const s = setup();
    s.queue.request(0);
    expect(s.queue.target).toBe(0);
    s.queue.flush();
    s.queue.flush();
    expect(s.applied).toEqual([0]);
  });

  it("does no work for an empty flush or cancellation", () => {
    const s = setup();
    s.queue.flush();
    s.queue.cancel();
    expect(s.applied).toEqual([]);
    expect(s.schedule).not.toHaveBeenCalled();
    expect(s.cancel).not.toHaveBeenCalled();
  });

  it("can queue another frame from the applied seek without losing it", () => {
    const frames: FrameRequestCallback[] = [],
      applied: number[] = [];
    const queue = new ReplaySeekQueue(
      (tick) => {
        applied.push(tick);
        if (tick === 300) queue.request(600);
      },
      (callback) => frames.push(callback) - 1,
      () => {},
    );
    queue.request(300);
    frames[0](0);
    expect(applied).toEqual([300]);
    expect(queue.target).toBe(600);
    frames[1](0);
    expect(applied).toEqual([300, 600]);
  });
});
