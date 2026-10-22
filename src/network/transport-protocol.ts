import type { ClientMessage, ServerMessage } from "./protocol";

export type TransportCommand = { generation: number } & (
  | { type: "connect"; first: ClientMessage }
  | { type: "disconnect"; clear: boolean }
  | { type: "send"; message: ClientMessage }
  | { type: "consumed"; serial: number }
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
