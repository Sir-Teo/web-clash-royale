import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/network/client";
import { PROTOCOL } from "../src/network/protocol";

let now = 0;
let client: RoomClient;
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  closes = 0;
  sent: any[] = [];
  onopen = () => {};
  onmessage = (_: { data: string }) => {};
  onclose = (_: { code: number }) => {};
  onerror = () => {};
  constructor() {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closes++;
    this.onclose({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen();
    this.onmessage({
      data: JSON.stringify({
        type: "welcome",
        team: "blue",
        code: "ABC234",
        token: "0".repeat(64),
      }),
    });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  Socket.instances = [];
  const saved = new Map<string, string>();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { protocol: "http:", host: "arena.test" });
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
    removeItem: (k: string) => saved.delete(k),
  });
  client = new RoomClient();
  client.connect({
    type: "resume",
    version: PROTOCOL,
    code: "ABC234",
    token: "0".repeat(64),
  });
  Socket.instances[0].open();
});
afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const beat = (time: number) => {
  now = time;
  vi.advanceTimersByTime(3000);
};

describe("room client liveness", () => {
  it("still reconnects when a running browser stops receiving server messages", () => {
    const socket = Socket.instances[0];
    for (let time = 3000; time <= 15000; time += 3000) beat(time);
    expect(socket.closes).toBe(0);
    beat(18000);
    expect(socket.closes).toBe(1);
    expect(client.connected).toBe(false);
  });
  it("allows queued socket messages after a long main-thread stall", () => {
    const socket = Socket.instances[0];
    beat(40000);
    expect(socket.closes).toBe(0);
    expect(socket.sent.at(-1)).toEqual({ type: "ping", at: 40000 });
    socket.onmessage({ data: JSON.stringify({ type: "pong", at: now }) });
    beat(43000);
    expect(socket.closes).toBe(0);
    expect(client.connected).toBe(true);
  });
  it("does not keep a silent connection alive after that single grace turn", () => {
    const socket = Socket.instances[0];
    beat(40000);
    expect(socket.closes).toBe(0);
    beat(43000);
    expect(socket.closes).toBe(1);
  });
});
