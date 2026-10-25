import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerRoomClient } from "../src/network/peer-client";
import { PeerAssembler } from "../src/network/peer-signaling";
import { STARTER_DECK } from "../src/game/cards";
import type { PeerHostCommand } from "../src/network/peer-host-worker";
import type { ServerMessage } from "../src/network/protocol";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function client() {
  vi.useFakeTimers();
  const document = { hidden: false, addEventListener: vi.fn() };
  vi.stubGlobal("document", document);
  const c = new PeerRoomClient();
  const posted = vi.spyOn(c as any, "post");
  const sent: any[] = [];
  const assembler = new PeerAssembler();
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    close: vi.fn(),
    send: (part: string) => {
      const value = assembler.receive(part);
      if (value !== undefined) sent.push(value);
    },
  };
  const open = () => {
    (c as any).bind(channel, (c as any).generation);
    (channel as any).onopen();
  };
  return { c, document, posted, sent, open };
}

describe("graphics and visibility availability", () => {
  it("publishes an immediate graphics hold without changing connection state", () => {
    const { c, posted, sent, open } = client();
    open();
    c.connected = true;
    c.setGameplayAvailable(false);
    expect(posted).toHaveBeenCalledWith({
      type: "availability",
      team: "blue",
      active: false,
      connected: true,
    });
    expect(sent.at(-1)).toEqual({ kind: "visibility", active: false });
    expect(c.connected).toBe(true);
    const count = posted.mock.calls.length;
    c.setGameplayAvailable(false);
    expect(posted).toHaveBeenCalledTimes(count);
    c.setGameplayAvailable(true);
    expect(sent.at(-1)).toEqual({ kind: "visibility", active: true });
  });
  it("requires both restored graphics and a visible document", () => {
    const { c, document, sent, open } = client();
    open();
    c.setGameplayAvailable(false);
    const changed = document.addEventListener.mock.calls[0][1] as () => void;
    changed();
    expect(sent.at(-1).active).toBe(false);
    document.hidden = true;
    c.setGameplayAvailable(true);
    expect(sent.at(-1).active).toBe(false);
    document.hidden = false;
    changed();
    expect(sent.at(-1).active).toBe(true);
  });
  it("keeps reporting unavailable in recurring pings while delivering liveness pulses", () => {
    const { c, posted, sent, open } = client();
    open();
    c.setGameplayAvailable(false);
    vi.advanceTimersByTime(3000);
    expect(sent.filter((m) => m.kind === "ping")).toHaveLength(3);
    expect(
      sent.filter((m) => m.kind === "ping").every((m) => m.active === false),
    ).toBe(true);
    expect(
      posted.mock.calls.filter(([m]) => m.type === "pulse").length,
    ).toBeGreaterThanOrEqual(3);
  });
  it("includes the graphics hold in a guest's initial hello", () => {
    const { c, sent, open } = client();
    c.team = "red";
    c.setGameplayAvailable(false);
    open();
    expect(sent.find((m) => m.kind === "hello")).toMatchObject({
      active: false,
    });
  });
  it("retains graphics availability across leaving and opening another connection", () => {
    const { c, sent, open } = client();
    c.setGameplayAvailable(false);
    open();
    c.disconnect();
    c.team = "red";
    open();
    expect(sent.filter((m) => m.kind === "hello").at(-1).active).toBe(false);
  });
});

async function worker() {
  vi.resetModules();
  let clock = 0;
  let tick!: () => void;
  const self = { onmessage: undefined as any };
  const output: { team: string; message: ServerMessage }[] = [];
  vi.stubGlobal("self", self);
  vi.stubGlobal("performance", { now: () => clock });
  vi.stubGlobal("setInterval", (callback: () => void) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal("postMessage", (message: any) =>
    output.push(structuredClone(message)),
  );
  await import("../src/network/peer-host-worker");
  const send = (data: PeerHostCommand) => self.onmessage({ data });
  const player = { name: "King", deck: [...STARTER_DECK] };
  send({ type: "init", id: "graphics", mode: "classic", seed: 42, player });
  send({ type: "join", player: { ...player, name: "Queen" } });
  for (const team of ["blue", "red"] as const)
    send({
      type: "command",
      team,
      message: { type: "ready", ready: true, matchId: "graphics:1" },
    });
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 30; i++) {
      clock += 1000 / 30;
      tick();
    }
  };
  const room = () =>
    output.filter((e) => e.message.type === "room").at(-1)!.message as Extract<
      ServerMessage,
      { type: "room" }
    >;
  return { send, advance, room };
}

describe("host worker liveness and explicit availability", () => {
  it.each(["inactive", "disconnected"])(
    "does not erase an explicit %s hold when UI pulses recover",
    async (reason) => {
      const { send, advance, room } = await worker();
      advance(5);
      expect(room().room.paused).toBe(true);
      send({
        type: "availability",
        team: "blue",
        active: reason !== "inactive",
        connected: reason !== "disconnected",
      });
      send({ type: "pulse" });
      expect(room().room.paused).toBe(true);
      advance(0.5);
      expect(room().room.paused).toBe(true);
      send({
        type: "availability",
        team: "blue",
        active: true,
        connected: true,
      });
      expect(room().room.paused).toBe(false);
    },
  );
  it("waits for a UI pulse even when explicit graphics availability returns", async () => {
    const { send, advance, room } = await worker();
    advance(5);
    send({ type: "availability", team: "blue", active: true, connected: true });
    expect(room().room.paused).toBe(true);
    send({ type: "pulse" });
    expect(room().room.paused).toBe(false);
  });
});
