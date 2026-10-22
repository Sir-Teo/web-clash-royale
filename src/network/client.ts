import { DirectRoomClient } from "./client-core";
import { PROTOCOL } from "./protocol";
import type { ClientMessage } from "./protocol";
import type { TransportCommand, TransportEvent } from "./transport-protocol";

/** Keep network liveness independent of expensive graphics work. */
export class RoomClient extends DirectRoomClient {
  private worker?: Worker;
  private workerEnabled = typeof Worker !== "undefined";
  private generation = 0;
  private first?: ClientMessage;
  private uiPulse?: ReturnType<typeof setInterval>;

  get transport() {
    return this.worker ? "worker" : "main";
  }

  override connect(first: ClientMessage) {
    this.disconnect(first.type !== "resume");
    if (!this.workerEnabled) {
      super.connect(first);
      return;
    }
    this.first = first;
    if (first.type === "resume")
      this.session = { code: first.code, token: first.token };
    try {
      if (!this.worker) {
        const worker = new Worker(
          new URL("./transport-worker.ts", import.meta.url),
          {
            type: "module",
            name: "royale-network",
          },
        );
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<TransportEvent>) => {
          const message = event.data;
          if (worker !== this.worker || message.generation !== this.generation)
            return;
          if (message.type === "connection") {
            this.connected = false;
            this.pending = false;
            this.onConnection(message.status);
            return;
          }
          try {
            this.receive(message.message, message.latency);
          } finally {
            if (message.serial !== undefined)
              this.post({
                type: "consumed",
                generation: message.generation,
                serial: message.serial,
              });
          }
        };
        worker.onerror = (event) => {
          if (worker !== this.worker) return;
          event.preventDefault();
          this.fallback();
        };
      }
      this.post({ type: "connect", generation: this.generation, first });
      this.uiPulse = setInterval(() => {
        this.post({ type: "pulse", generation: this.generation });
      }, 3000);
    } catch {
      this.fallback();
    }
  }

  private post(message: TransportCommand) {
    this.worker?.postMessage(message);
  }

  private fallback() {
    const first = this.first;
    const saved = this.session ?? this.saved;
    this.worker?.terminate();
    this.worker = undefined;
    this.workerEnabled = false;
    // A worker can fail after reserving a seat. Reuse its persisted credentials.
    if (first)
      super.connect(
        saved ? { type: "resume", version: PROTOCOL, ...saved } : first,
      );
  }

  override send(message: ClientMessage) {
    if (!this.worker) return super.send(message);
    if (!this.connected) return false;
    this.post({ type: "send", generation: this.generation, message });
    return true;
  }

  override disconnect(clear = true) {
    this.first = undefined;
    clearInterval(this.uiPulse);
    this.generation++;
    this.post({ type: "disconnect", generation: this.generation, clear });
    super.disconnect(clear);
  }
}
