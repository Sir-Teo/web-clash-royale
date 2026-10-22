import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/network/client";
import { LatestSnapshot } from "../src/network/transport-protocol";
import { PROTOCOL } from "../src/network/protocol";
import type {
  TransportCommand,
  TransportEvent,
} from "../src/network/transport-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: TransportCommand[] = [];
  terminated = false;
  onmessage = (_: { data: TransportEvent }) => {};
  onerror = (_: { preventDefault(): void }) => {};
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: TransportCommand) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  get generation() {
    return this.sent.at(-1)!.generation;
  }
  emit(
    event: Omit<Extract<TransportEvent, { type: "message" }>, "generation">,
    generation = this.generation,
  ) {
    this.onmessage({ data: { ...event, generation } });
  }
}
const welcome = {
  type: "welcome",
  team: "red",
  code: "ABC234",
  token: "0".repeat(64),
  deck: [],
  mode: "classic",
} as const;
let client: RoomClient;
beforeEach(() => {
  const storage = new Map<string, string>();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  client = new RoomClient();
  client.connect({
    type: "resume",
    version: PROTOCOL,
    code: welcome.code,
    token: welcome.token,
  });
});
afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
});
function greet(worker = FakeWorker.instances[0]) {
  worker.emit({
    type: "message",
    message: { ...welcome, deck: [], mode: "classic" },
    latency: 0,
  });
  return worker;
}

describe("worker room client", () => {
  it("persists the reserved seat and sends canonical red-side plays", () => {
    const worker = greet();
    expect(client.transport).toBe("worker");
    expect(client.saved).toEqual({ code: welcome.code, token: welcome.token });
    expect(client.play("knight", 4, 22)).toBe(true);
    expect(worker.sent.at(-1)).toMatchObject({
      type: "send",
      message: { type: "play", x: 14, y: 10 },
    });
    expect(client.play("knight", 4, 22)).toBe(false);
    worker.emit({
      type: "message",
      message: { type: "ack", seq: 1, ok: true, reason: "" },
      latency: 0,
    });
    expect(client.pending).toBe(false);
  });
  it("ignores old worker messages after a room switch", () => {
    const worker = greet();
    const old = worker.generation;
    client.disconnect();
    worker.emit(
      {
        type: "message",
        message: { ...welcome, deck: [], mode: "classic" },
        latency: 0,
      },
      old,
    );
    expect(client.connected).toBe(false);
    expect(client.saved).toBeNull();
  });
  it("uses worker RTT rather than comparing clocks across contexts", () => {
    const worker = greet();
    worker.emit({
      type: "message",
      message: { type: "pong", at: -99999 },
      latency: 17,
    });
    expect(client.latency).toBe(17);
  });
  it("releases a snapshot even when a UI handler throws", () => {
    const worker = greet();
    client.onMessage = () => {
      throw Error("UI failure");
    };
    expect(() =>
      worker.emit({
        type: "message",
        message: { type: "ack", seq: 1, ok: true, reason: "" },
        latency: 0,
        serial: 41,
      }),
    ).toThrow("UI failure");
    expect(worker.sent.at(-1)).toMatchObject({ type: "consumed", serial: 41 });
  });
  it("falls back using the saved seat if a loaded worker fails", () => {
    const worker = greet();
    // Storage can be disabled; the welcome token must still survive in memory.
    vi.stubGlobal("sessionStorage", undefined);
    const sockets: any[] = [];
    vi.stubGlobal("location", { protocol: "http:", host: "arena.test" });
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1;
        readyState = 1;
        onopen = () => {};
        sent: any[] = [];
        constructor() {
          sockets.push(this);
        }
        send(data: string) {
          this.sent.push(JSON.parse(data));
        }
        close() {}
      },
    );
    worker.onerror({ preventDefault() {} });
    sockets[0].onopen();
    expect(worker.terminated).toBe(true);
    expect(client.transport).toBe("main");
    expect(sockets[0].sent[0]).toEqual({
      type: "resume",
      version: PROTOCOL,
      code: welcome.code,
      token: welcome.token,
    });
  });
});

describe("latest snapshot delivery", () => {
  it("bounds a blocked consumer to one in-flight state and the newest pending state", () => {
    const delivered: number[][] = [];
    const queue = new LatestSnapshot<number>((value, serial) =>
      delivered.push([value, serial]),
    );
    for (let tick = 1; tick <= 1000; tick++) queue.push(tick);
    expect(delivered).toEqual([[1, 1]]);
    queue.consumed(999);
    expect(delivered).toHaveLength(1);
    queue.consumed(1);
    expect(delivered).toEqual([
      [1, 1],
      [1000, 2],
    ]);
    queue.consumed(1);
    queue.push(1001);
    expect(delivered).toHaveLength(2);
    queue.consumed(2);
    expect(delivered.at(-1)).toEqual([1001, 3]);
  });
  it("drops queued snapshots on a session change and ignores stale acknowledgments", () => {
    const delivered: number[][] = [];
    const queue = new LatestSnapshot<number>((value, serial) =>
      delivered.push([value, serial]),
    );
    queue.push(1);
    queue.push(2);
    queue.reset();
    queue.push(3);
    queue.push(4);
    queue.consumed(1);
    expect(delivered).toEqual([
      [1, 1],
      [3, 2],
    ]);
    queue.consumed(2);
    expect(delivered.at(-1)).toEqual([4, 3]);
  });
});
