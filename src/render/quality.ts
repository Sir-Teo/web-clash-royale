/** Presentation budgets; simulation and authored animation clocks stay independent. */
export class RenderQuality {
  readonly targetFps: number;
  readonly maximumRatio: number;
  readonly minimumRatio: number;
  readonly textureLimit: number;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;

  constructor(
    readonly mobile: boolean,
    deviceRatio: number,
  ) {
    const ratio =
      Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
    this.targetFps = mobile ? 30 : 60;
    this.maximumRatio = Math.min(ratio, mobile ? 1 : 2);
    this.minimumRatio = Math.min(
      this.maximumRatio,
      mobile ? 0.65 : this.maximumRatio > 1 ? 1 : 0.75,
    );
    this.textureLimit = mobile ? 1024 : Infinity;
  }

  sample(fps: number, active: boolean, current: number): number {
    if (!active || !Number.isFinite(fps) || fps <= 0) {
      this.slow = this.fast = this.cooldown = 0;
      return current;
    }
    // Recover quickly from an overloaded phone, including during a cooldown.
    if (fps < this.targetFps * 0.55 && current > this.minimumRatio) {
      this.slow = this.fast = 0;
      this.cooldown = 2;
      return this.minimumRatio;
    }
    if (this.cooldown > 0) {
      this.cooldown--;
      return current;
    }
    this.slow = fps < this.targetFps * 0.85 ? this.slow + 1 : 0;
    this.fast = fps >= this.targetFps * 0.95 ? this.fast + 1 : 0;
    if (this.slow >= 2 && current > this.minimumRatio) {
      this.slow = this.fast = 0;
      this.cooldown = 2;
      return Math.max(this.minimumRatio, current - 0.25);
    }
    if (this.fast >= 10 && current < this.maximumRatio) {
      this.slow = this.fast = 0;
      this.cooldown = 6;
      return Math.min(this.maximumRatio, current + 0.125);
    }
    return current;
  }
}
