import type { ClientMessage, ServerMessage } from "./protocol";

export type TransportCommand = { generation: number } & (
  | { type: "connect"; first: ClientMessage }
  | { type: "disconnect"; clear: boolean }
  | { type: "send"; message: ClientMessage }
  | { type: "consumed"; serial: number }
  | { type: "pulse" }
);
export type TransportEvent = { generation: number } & (
  | { type: "connection"; status: "connecting" | "reconnecting" | "closed" }
  | {
      type: "message";
      message: ServerMessage;
      latency: number;
      serial?: number;
    }
);

/** One in-flight snapshot, plus only the latest state while the UI is busy. */
export class LatestSnapshot<T> {
  private serial = 0;
  private inFlight?: number;
  private pending?: T;
  constructor(private deliver: (value: T, serial: number) => void) {}
  push(value: T) {
    if (this.inFlight !== undefined) {
      this.pending = value;
      return;
    }
    this.inFlight = ++this.serial;
    this.deliver(value, this.inFlight);
  }
  consumed(serial: number) {
    if (serial !== this.inFlight) return;
    this.inFlight = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending !== undefined) this.push(pending);
  }
  reset() {
    this.inFlight = undefined;
    this.pending = undefined;
  }
}

/** Some engines defer worker socket delivery through a busy UI thread. */
export class UiDelivery {
  private stalled = false;
  constructor(private lastPulse: number) {}
  pulse(now: number) {
    if (now - this.lastPulse > 6000) this.stalled = true;
    this.lastPulse = now;
  }
  ready(now: number) {
    if (now - this.lastPulse > 6000) {
      this.stalled = true;
      return false;
    }
    // Let queued socket callbacks run once after the UI starts responding.
    if (this.stalled) {
      this.stalled = false;
      return false;
    }
    return true;
  }
}
