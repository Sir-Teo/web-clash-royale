import { PROTOCOL } from "../src/network/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachRooms } from "../server/rooms";
import { QUICK_CHATS } from "../src/game/emotes";
import { STARTER_DECK } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import { perspective, snapshot } from "../src/network/perspective";
import type { ClientMessage, ServerMessage } from "../src/network/protocol";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
});
async function server(options = {}) {
  const http = createServer();
  const rooms = attachRooms(http, {
    introMs: 20,
    reconnectMs: 100,
    ...options,
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => {
    rooms.close();
    http.close();
  });
  return `ws://127.0.0.1:${(http.address() as any).port}/battle`;
}
async function peer(url: string) {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve) => ws.once("open", resolve));
  cleanup.push(() => ws.terminate());
  const send = (m: ClientMessage | object) => ws.send(JSON.stringify(m));
  async function wait<T extends ServerMessage["type"]>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ) {
    let found: Extract<ServerMessage, { type: T }> | undefined;
    await expect
      .poll(
        () => {
          found = messages.find(
            (m) => m.type === type && predicate(m as any),
          ) as any;
          return !!found;
        },
        { timeout: 3000, interval: 10 },
      )
      .toBe(true);
    messages.splice(messages.indexOf(found!), 1);
    return found!;
  }
  return { ws, send, wait, messages };
}
const identity = { version: PROTOCOL, name: "Blue King", deck: [...STARTER_DECK] };
async function match() {
  const url = await server();
  const a = await peer(url),
    b = await peer(url);
  a.send({ type: "create", ...identity, mode: "classic" });
  const welcome = await a.wait("welcome");
  b.send({ type: "join", ...identity, name: "Red King", code: welcome.code });
  const red = await b.wait("welcome");
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await a.wait("room", (m) => m.room.phase === "playing");
  return { url, a, b, welcome, red };
}
describe("authoritative multiplayer", () => {
  it("validates all four emotes, keeps sender identity authoritative and limits each player independently", async () => {
    const { a, b } = await match();
    a.send({ type: "emote", kind: "<script>" });
    a.send({ type: "emote", kind: 9 });
    a.send({ type: "emote", kind: null });
    a.send({ type: "emote", kind: "cry", team: "red" });
    expect(await a.wait("emote")).toEqual({
      type: "emote",
      team: "blue",
      kind: "cry",
    });
    expect(await b.wait("emote")).toEqual({
      type: "emote",
      team: "blue",
      kind: "cry",
    });
    a.send({ type: "emote", kind: "angry" });
    a.send({ type: "quick-chat", phrase: "good-luck" });
    b.send({ type: "emote", kind: "thumbs" });
    expect(await a.wait("emote")).toEqual({
      type: "emote",
      team: "red",
      kind: "thumbs",
    });
    expect(await b.wait("emote")).toEqual({
      type: "emote",
      team: "red",
      kind: "thumbs",
    });
    a.send({ type: "ping", at: 1 });
    await a.wait("pong");
    expect(
      a.messages.filter((m) => ["emote", "quick-chat"].includes(m.type)),
    ).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 2550));
    a.send({ type: "emote", kind: "angry" });
    b.send({ type: "emote" }); // Original clients retain their laugh default.
    expect((await a.wait("emote", (m) => m.team === "blue")).kind).toBe(
      "angry",
    );
    expect((await a.wait("emote", (m) => m.team === "red")).kind).toBe("laugh");
    b.send({ type: "surrender" });
    await a.wait("state", (m) => !!m.state.winner);
    await new Promise((resolve) => setTimeout(resolve, 2550));
    a.send({ type: "emote", kind: "cry" });
    a.send({ type: "ping", at: 2 });
    await a.wait("pong", (m) => m.at === 2);
    expect(a.messages.filter((m) => m.type === "emote")).toEqual([]);
  }, 10000);
  it("validates all six quick chats and shares the emote cooldown across reaction types", async () => {
    const url = await server();
    const a = await peer(url),
      b = await peer(url);
    a.send({ type: "create", ...identity, mode: "classic" });
    const welcome = await a.wait("welcome");
    a.send({ type: "quick-chat", phrase: "good-luck" });
    a.send({ type: "ping", at: 0 });
    await a.wait("pong");
    expect(a.messages.filter((m) => m.type === "quick-chat")).toEqual([]);
    b.send({ type: "join", ...identity, code: welcome.code });
    await b.wait("welcome");
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await a.wait("room", (m) => m.room.phase === "playing");
    for (const phrase of [
      undefined,
      null,
      42,
      "<script>",
      "constructor",
      "__proto__",
    ])
      a.send({ type: "quick-chat", phrase });
    for (let i = 0; i < QUICK_CHATS.length; i += 2) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 2550));
      a.send({ type: "quick-chat", phrase: QUICK_CHATS[i], team: "red" });
      b.send({ type: "quick-chat", phrase: QUICK_CHATS[i + 1], team: "blue" });
      for (const client of [a, b]) {
        expect(
          await client.wait("quick-chat", (m) => m.team === "blue"),
        ).toEqual({ type: "quick-chat", team: "blue", phrase: QUICK_CHATS[i] });
        expect(
          await client.wait("quick-chat", (m) => m.team === "red"),
        ).toEqual({
          type: "quick-chat",
          team: "red",
          phrase: QUICK_CHATS[i + 1],
        });
      }
      a.send({ type: "emote", kind: "laugh" });
      a.send({ type: "quick-chat", phrase: "oops" });
      a.send({ type: "ping", at: i + 1 });
      await a.wait("pong", (m) => m.at === i + 1);
      expect(
        a.messages.filter((m) => ["emote", "quick-chat"].includes(m.type)),
      ).toEqual([]);
    }
    b.send({ type: "surrender" });
    await a.wait("state", (m) => !!m.state.winner);
    await new Promise((resolve) => setTimeout(resolve, 2550));
    a.send({ type: "quick-chat", phrase: "good-game" });
    a.send({ type: "ping", at: 10 });
    await a.wait("pong", (m) => m.at === 10);
    expect(a.messages.filter((m) => m.type === "quick-chat")).toEqual([]);
  }, 15000);
  it("isolates rooms, keeps hands private, accepts both sides and rejects forged moves", async () => {
    const { url, a, b, welcome } = await match();
    const outsider = await peer(url);
    outsider.send({ type: "join", ...identity, code: welcome.code });
    expect((await outsider.wait("error")).message).toMatch(/full|playing/);
    outsider.send({ type: "create", ...identity, mode: "double" });
    await outsider.wait("welcome");
    const first = await a.wait("state", (m) => m.state.tick > 0);
    const red = await b.wait("state", (m) => m.state.tick > 0);
    expect(first.state.players.red.elixir).toBe(0);
    expect(red.state.players.blue.elixir).toBe(0);
    const cardA = first.state.players.blue.hand.find((c) =>
      [
        "skeletons",
        "knight",
        "archers",
        "arrows",
        "goblins",
        "musketeer",
        "mini-pekka",
        "fireball",
      ].includes(c),
    )!;
    a.send({
      type: "play",
      seq: 1,
      card: cardA,
      x: 4,
      y: 22,
      team: "red",
      tick: 9000,
      elixir: 999,
    });
    expect((await a.wait("ack", (m) => m.seq === 1)).ok).toBe(true);
    const synced = await b.wait("state", (m) => m.state.actionCount === 1);
    expect(synced.state.tick).toBeLessThan(100);
    expect(synced.state.events.find((e) => e.card === cardA)?.team).toBe(
      "blue",
    );
    a.send({ type: "play", seq: 1, card: cardA, x: 4, y: 22 });
    expect((await a.wait("error")).message).toMatch(/Duplicate/);
    a.send({ type: "play", seq: 2, card: "__proto__", x: 4, y: 22 });
    expect((await a.wait("ack", (m) => m.seq === 2)).ok).toBe(false);
    const cardB = red.state.players.red.hand.find((c) => c !== "giant")!;
    b.send({ type: "play", seq: 1, card: cardB, x: 14, y: 10 });
    expect((await b.wait("ack", (m) => m.seq === 1)).ok).toBe(true);
    await a.wait("state", (m) => m.state.actionCount === 2);
    expect(outsider.messages.some((m) => m.type === "state")).toBe(false);
    b.send({ type: "surrender" });
    const final = await a.wait("state", (m) => !!m.state.winner);
    expect(final.state.winner).toBe("blue");
    expect(final.replay?.actions.map((a) => a.team)).toEqual(["blue", "red"]);
  });
  it("requires both players ready, enforces version and deck, and frees waiting seats", async () => {
    const url = await server();
    const a = await peer(url),
      b = await peer(url);
    a.send({ type: "create", ...identity, version: 0, mode: "classic" });
    expect((await a.wait("error")).fatal).toBe(true);
    a.send({
      type: "create",
      ...identity,
      deck: Array(8).fill("knight"),
      mode: "classic",
    });
    expect((await a.wait("error")).message).toMatch(/eight unique/);
    a.send({ type: "create", ...identity, mode: "classic" });
    const room = await a.wait("welcome");
    a.send({ type: "ready", ready: true });
    await a.wait("room", (m) => m.room.players[0].ready);
    expect(a.messages.some((m) => m.type === "state")).toBe(false);
    b.send({ type: "join", ...identity, code: room.code });
    await b.wait("welcome");
    b.ws.terminate();
    await a.wait(
      "room",
      (m) => m.room.players.length === 1 && m.room.players[0].ready,
    );
    const c = await peer(url);
    c.send({ type: "join", ...identity, code: room.code });
    expect((await c.wait("welcome")).team).toBe("red");
  });
  it("resumes the same side with a private token and forfeits an expired disconnect", async () => {
    const { url, a, b, red, welcome } = await match();
    b.ws.terminate();
    const resumed = await peer(url);
    resumed.send({
      type: "resume",
      version: PROTOCOL,
      code: welcome.code,
      token: red.token,
    });
    expect((await resumed.wait("welcome")).team).toBe("red");
    const resumedState = await resumed.wait("state");
    expect(resumedState.state.winner).toBeNull();
    resumed.ws.terminate();
    const end = await a.wait("state", (m) => !!m.state.winner);
    expect(end.state.winner).toBe("blue");
    expect(end.state.reason).toBe("Connection lost");
    const thief = await peer(url);
    thief.send({
      type: "resume",
      version: PROTOCOL,
      code: welcome.code,
      token: "f".repeat(64),
    });
    expect((await thief.wait("error")).fatal).toBe(true);
  });
  it("broadcasts every running room, including when there are an even number", async () => {
    const url = await server();
    const clients = await Promise.all(
      Array.from({ length: 4 }, () => peer(url)),
    );
    for (let i = 0; i < 4; i += 2) {
      clients[i].send({ type: "create", ...identity, mode: "classic" });
      const room = await clients[i].wait("welcome");
      clients[i + 1].send({ type: "join", ...identity, code: room.code });
      await clients[i + 1].wait("welcome");
      clients[i].send({ type: "ready", ready: true });
      clients[i + 1].send({ type: "ready", ready: true });
    }
    for (const c of clients)
      expect(
        (await c.wait("state", (m) => m.state.tick >= 4)).state.tick,
      ).toBeGreaterThanOrEqual(4);
  });
});
it("rotates complete red-side presentation without mutating canonical simulation or replays", () => {
  const b = new Battle({ seed: 16, ai: false });
  b.play("red", 0, 14, 10);
  const before = JSON.stringify(snapshot(b));
  const v = perspective(snapshot(b), "red");
  expect(v.players.blue).toBe(b.players.red);
  for (const e of v.entities) {
    const original = b.entities.find((o) => o.id === e.id)!;
    expect(e.x).toBe(18 - original.x);
    expect(e.y).toBe(32 - original.y);
    expect(e.team).not.toBe(original.team);
  }
  expect(JSON.stringify(snapshot(b))).toBe(before);
  const restored = perspective(v, "red");
  restored.entities.forEach((e, i) => {
    expect(e.x).toBeCloseTo(b.entities[i].x, 12);
    expect(e.y).toBeCloseTo(b.entities[i].y, 12);
    expect(e.team).toBe(b.entities[i].team);
  });
  expect(restored.players).toEqual(b.players);
});
