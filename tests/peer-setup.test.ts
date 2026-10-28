import { afterEach, expect, it, vi } from "vitest";
import { PeerRoomClient } from "../src/network/peer-client";
import { decodeSignal, encodeSignal } from "../src/network/peer-signaling";
import { PEER_PROTOCOL } from "../src/network/protocol";
import { STARTER_DECK } from "../src/game/cards";

const sdp = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const player = { name: "King", deck: [...STARTER_DECK] };
const invite = encodeSignal({
  version: 1,
  type: "offer",
  id: "1".repeat(24),
  mode: "classic",
  sdp,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  vi.useFakeTimers();
  const document = { hidden: false, addEventListener: vi.fn() };
  vi.stubGlobal("document", document);
  const peers: any[] = [],
    workers: any[] = [];
  class Channel {
    readyState = "connecting";
    bufferedAmount = 0;
    onopen?: () => void;
    onclose?: () => void;
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = "closed";
      this.onclose?.();
    });
  }
  class Peer {
    iceGatheringState = "complete";
    connectionState = "new";
    localDescription: any;
    onconnectionstatechange?: () => void;
    ondatachannel?: (event: any) => void;
    channel = new Channel();
    createOffer = vi.fn(async () => ({ type: "offer", sdp }));
    createAnswer = vi.fn(async () => ({ type: "answer", sdp }));
    setLocalDescription = vi.fn(async (value) => {
      this.localDescription = value;
    });
    setRemoteDescription = vi.fn(async () => {});
    createDataChannel = () => this.channel;
    close = vi.fn(() => {
      this.connectionState = "closed";
      this.onconnectionstatechange?.();
    });
    constructor() {
      peers.push(this);
    }
  }
  class Worker {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("Worker", Worker);
  const c = new PeerRoomClient();
  const messages = vi.fn();
  c.onMessage = messages;
  const errors = () =>
    messages.mock.calls.map(([m]) => m).filter((m) => m.type === "error");
  const offer = () => c.offer(player, "classic");
  const answer = () => c.answer(invite, player);
  const reply = () =>
    encodeSignal({ ...decodeSignal(c.signal), type: "answer" });
  const open = () => {
    const pc = peers.at(-1),
      channel = pc.channel;
    if (c.team === "red") pc.ondatachannel({ channel });
    channel.readyState = "open";
    channel.onopen();
    return channel;
  };
  const welcome = () =>
    (c as any).receive({
      type: "welcome",
      code: "1".repeat(24),
      token: "",
      team: c.team,
      mode: "classic",
      ...player,
      peerVersion: PEER_PROTOCOL,
    });
  return {
    c,
    document,
    peers,
    workers,
    errors,
    offer,
    answer,
    reply,
    open,
    welcome,
  };
}

it.each(["offer", "answer"] as const)(
  "releases a stalled browser %s preparation after 25 seconds",
  async (kind) => {
    const s = fixture(),
      pending = deferred<void>();
    // Hold the common first local-description step without relying on ICE state.
    const work = kind === "offer" ? s.offer() : s.answer();
    s.peers[0].setLocalDescription.mockImplementation(() => pending.promise);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(24999);
    expect(s.c.setup).toBe("gathering");
    expect(s.errors()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.c.setup).toBe("idle");
    expect(s.peers[0].close).toHaveBeenCalledOnce();
    expect(s.errors()).toEqual([
      expect.objectContaining({
        fatal: true,
        message: expect.stringContaining(
          "Preparing the connection took too long",
        ),
      }),
    ]);
    if (kind === "offer") expect(s.workers[0].terminate).toHaveBeenCalledOnce();
    pending.resolve();
    await work;
    expect(s.c.signal).toBe("");
    expect(s.errors()).toHaveLength(1);
  },
);

it.each(["offer", "answer"] as const)(
  "does not time out the manual %s exchange",
  async (kind) => {
    const s = fixture();
    await (kind === "offer" ? s.offer() : s.answer());
    const signal = s.c.signal;
    await vi.advanceTimersByTimeAsync(120000);
    expect(s.c.setup).toBe(kind);
    expect(s.c.signal).toBe(signal);
    expect(s.errors()).toEqual([]);
  },
);

it("bounds a host's pending remote-description call and ignores its late success", async () => {
  const s = fixture();
  await s.offer();
  const pending = deferred<void>();
  s.peers[0].setRemoteDescription.mockImplementation(() => pending.promise);
  const work = s.c.accept(s.reply());
  expect(s.c.setup).toBe("connecting");
  await vi.advanceTimersByTimeAsync(25000);
  expect(s.c.setup).toBe("idle");
  expect(s.errors()[0].message).toContain("could not connect");
  pending.resolve();
  await work;
  expect(s.c.setup).toBe("idle");
});

it("deduplicates an in-flight accepted reply without extending its deadline", async () => {
  const s = fixture();
  await s.offer();
  const reply = s.reply(),
    pending = deferred<void>();
  s.peers[0].setRemoteDescription.mockImplementation(() => pending.promise);
  const first = s.c.accept(reply);
  await vi.advanceTimersByTimeAsync(24000);
  await s.c.accept(reply);
  expect(s.peers[0].setRemoteDescription).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.errors()).toHaveLength(1);
  pending.resolve();
  await first;
});

it("returns a malformed browser reply to the same invite and permits retry", async () => {
  const s = fixture();
  await s.offer();
  const signal = s.c.signal,
    reply = s.reply();
  s.peers[0].setRemoteDescription.mockRejectedValueOnce(new Error("Bad SDP"));
  await expect(s.c.accept(reply)).rejects.toThrow("Bad SDP");
  expect(s.c.setup).toBe("offer");
  expect(s.c.signal).toBe(signal);
  await vi.advanceTimersByTimeAsync(30000);
  expect(s.errors()).toEqual([]);
  await s.c.accept(reply);
  expect(s.c.setup).toBe("connecting");
});

it("times out a silent open guest channel and closes its heartbeat", async () => {
  const s = fixture();
  await s.answer();
  const channel = s.open();
  expect(s.c.setup).toBe("connecting");
  await vi.advanceTimersByTimeAsync(25000);
  expect(s.errors()[0].message).toContain("game did not respond");
  expect(s.c.setup).toBe("idle");
  expect(channel.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["blue", "red"] as const)(
  "clears the %s handshake deadline after welcome",
  async (team) => {
    const s = fixture();
    await (team === "blue" ? s.offer() : s.answer());
    s.open();
    s.welcome();
    s.document.hidden = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.c.setup).toBe("connected");
    expect(s.c.connected).toBe(true);
    expect(s.errors()).toEqual([]);
  },
);

it("keeps an early welcome connected when accepting the reply resolves later", async () => {
  const s = fixture();
  await s.offer();
  const pending = deferred<void>();
  s.peers[0].setRemoteDescription.mockImplementation(() => pending.promise);
  const work = s.c.accept(s.reply());
  s.welcome();
  pending.resolve();
  await work;
  await vi.advanceTimersByTimeAsync(30000);
  expect(s.c.setup).toBe("connected");
  expect(s.c.connected).toBe(true);
  expect(s.errors()).toEqual([]);
});

it.each([false, true])(
  "keeps a channel's handshake state when SDP finishes later (welcome: %s)",
  async (welcomed) => {
    const s = fixture(),
      pending = deferred<void>();
    const work = s.answer();
    s.peers[0].setLocalDescription.mockImplementation(() => pending.promise);
    await vi.advanceTimersByTimeAsync(0);
    s.open();
    if (welcomed) s.welcome();
    pending.resolve();
    await work;
    expect(s.c.signal).toBe("");
    expect(s.c.setup).toBe(welcomed ? "connected" : "connecting");
    s.document.hidden = true;
    await vi.advanceTimersByTimeAsync(30000);
    if (welcomed) {
      expect(s.c.setup).toBe("connected");
      expect(s.errors()).toEqual([]);
    } else {
      expect(s.c.setup).toBe("idle");
      expect(s.errors()[0].message).toContain("game did not respond");
    }
  },
);

it.each(["resolve", "reject"] as const)(
  "ignores an old reply's late %s after cancel and a fresh invite",
  async (finish) => {
    const s = fixture();
    await s.offer();
    const pending = deferred<void>();
    s.peers[0].setRemoteDescription.mockImplementation(() => pending.promise);
    const work = s.c.accept(s.reply());
    s.c.leave();
    await s.offer();
    const signal = s.c.signal;
    if (finish === "resolve") pending.resolve();
    else pending.reject(new Error("Old reply"));
    await work;
    await vi.advanceTimersByTimeAsync(30000);
    expect(s.c.setup).toBe("offer");
    expect(s.c.signal).toBe(signal);
    expect(s.peers[1].close).not.toHaveBeenCalled();
    expect(s.workers[1].terminate).not.toHaveBeenCalled();
    expect(s.errors()).toEqual([]);
  },
);
