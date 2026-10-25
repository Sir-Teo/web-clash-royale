/** One latest drag destination per frame; transitions invalidate old callbacks. */
export class ReplaySeekQueue {
  private pending: number | undefined;
  private frame: number | undefined;
  private generation = 0;

  constructor(
    private apply: (tick: number) => void,
    private schedule: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private cancelFrame: (handle: number) => void = (handle) =>
      cancelAnimationFrame(handle),
  ) {}

  get target() {
    return this.pending;
  }

  request(tick: number) {
    this.pending = tick;
    if (this.frame !== undefined) return;
    const generation = ++this.generation;
    this.frame = this.schedule(() => {
      if (generation !== this.generation) return;
      this.frame = undefined;
      const target = this.pending;
      this.pending = undefined;
      if (target !== undefined) this.apply(target);
    });
  }

  flush() {
    const target = this.pending;
    this.cancel();
    if (target !== undefined) this.apply(target);
  }

  cancel() {
    ++this.generation;
    if (this.frame !== undefined) this.cancelFrame(this.frame);
    this.frame = undefined;
    this.pending = undefined;
  }
}
