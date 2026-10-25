import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerMatch } from "../src/network/peer-match";
import { PeerRoomClient } from "../src/network/peer-client";
import { Battle, STEP, type Team } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK, PRESETS } from "../src/game/cards";
import { loadProfile, recordBattle } from "../src/game/profile";
import { PeerAssembler } from "../src/network/peer-signaling";
import { snapshot } from "../src/network/perspective";
import type { ClientMessage, ServerMessage } from "../src/network/protocol";
const player = { name: "King", deck: [...STARTER_DECK] };
function match() {
  const events: { team: Team; message: ServerMessage }[] = [];
  const game = new PeerMatch("invite", "double", player, 42, (team, message) =>
    events.push({ team, message: structuredClone(message) }),
  );
  game.join({ ...player, name: "Queen" });
  const send = (team: Team, message: ClientMessage) =>
    game.receive(team, { matchId: game.room.matchId, ...message });
  const start = () => {
    send("blue", { type: "ready", ready: true });
    send("red", { type: "ready", ready: true });
  };
  const play = () => {
    for (let i = 0; i < 120; i++) game.advance(STEP);
  };
  const finish = () => {
    start();
    play();
    send("red", { type: "surrender" });
  };
  const vote = (team: Team, ready = true) =>
    send(team, { type: "rematch", matchId: game.room.matchId!, ready });
  return { game, events, send, start, play, finish, vote };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("connected friendly rematches", () => {
  it("rejects unscoped commands before readiness or spending can change", () => {
    const { game, start, play } = match();
    game.receive("blue", { type: "ready", ready: true });
    game.receive("red", { type: "ready", ready: true, matchId: "old" });
    expect(game.battle).toBeUndefined();
    start();
    play();
    const b = game.battle!,
      card = b.players.blue.hand.find(
        (id) => CARD_MAP[id].cost <= b.players.blue.elixir,
      )!;
    game.receive("blue", { type: "play", seq: 1000, card, x: 4, y: 22 });
    game.receive("red", { type: "surrender" });
    expect(b.actions).toHaveLength(0);
    expect(b.winner).toBeNull();
  });

  it.each(["blue", "red"] as const)(
    "requires both players and lets %s cancel without losing the completed match",
    (first) => {
      const { game, events, finish, vote } = match();
      finish();
      const previous = game.battle!,
        record = previous.exportReplay(),
        id = game.room.matchId;
      vote(first);
      expect(game.room.phase).toBe("finished");
      expect(game.battle).toBe(previous);
      expect(game.room.players.find((p) => p.team === first)?.rematch).toBe(
        true,
      );
      const length = events.length;
      vote(first);
      expect(events).toHaveLength(length);
      vote(first, false);
      expect(game.room.players.some((p) => p.rematch)).toBe(false);
      vote(first === "blue" ? "red" : "blue");
      expect(game.room.phase).toBe("finished");
      vote(first);
      expect(game.room.phase).toBe("waiting");
      expect(game.room.code).toBe("invite");
      expect(game.room.matchId).not.toBe(id);
      expect(
        game.room.players.every((p) => p.connected && !p.ready && !p.rematch),
      ).toBe(true);
      expect(game.battle).toBeUndefined();
      expect(previous.exportReplay()).toEqual(record);
    },
  );
  it("ignores early, malformed, missing and expired rematch votes", () => {
    const { game, send, start, play, vote } = match();
    vote("blue");
    expect(game.room.players.some((p) => p.rematch)).toBe(false);
    start();
    vote("blue");
    expect(game.room.players.some((p) => p.rematch)).toBe(false);
    play();
    vote("blue");
    expect(game.room.players.some((p) => p.rematch)).toBe(false);
    send("red", { type: "surrender" });
    game.receive("blue", { type: "rematch", ready: true } as any);
    game.receive("blue", { type: "rematch", matchId: "old", ready: true });
    game.receive("blue", {
      type: "rematch",
      matchId: game.room.matchId!,
      ready: 1,
    } as any);
    expect(game.room.players.some((p) => p.rematch)).toBe(false);
    expect(game.room.phase).toBe("finished");
  });
  it("clears outstanding votes on a disconnect and requires new agreement after recovery", () => {
    const { game, finish, vote } = match();
    finish();
    vote("blue");
    game.availability("red", false, false);
    expect(game.room.players.some((p) => p.rematch)).toBe(false);
    vote("blue");
    vote("red");
    expect(game.room.phase).toBe("finished");
    game.availability("red", true, true);
    vote("red");
    expect(game.room.phase).toBe("finished");
    vote("blue");
    expect(game.room.phase).toBe("waiting");
    expect(game.room.paused).toBe(false);
  });
  it("keeps a fresh countdown paused while a consenting player is hidden", () => {
    const { game, finish, vote, start, play } = match();
    finish();
    game.availability("red", false, true);
    vote("blue");
    vote("red");
    start();
    play();
    expect(game.room.phase).toBe("countdown");
    expect(game.battle!.tick).toBe(0);
    game.availability("red", true, true);
    play();
    expect(game.room.phase).toBe("playing");
    expect(game.battle!.tick).toBeGreaterThan(0);
  });
  it("accepts fresh decks, resets reaction budgets and rejects stale commands without consuming new sequences", () => {
    const { game, events, vote, start, play, send } = match();
    start();
    play();
    send("blue", { type: "emote", kind: "thumbs" });
    send("red", { type: "surrender" });
    const old = game.room.matchId!;
    vote("blue");
    vote("red");
    send("blue", { type: "loadout", name: "New King", deck: PRESETS[1].deck });
    game.receive("blue", {
      type: "loadout",
      matchId: old,
      name: "Old",
      deck: STARTER_DECK,
    });
    game.receive("blue", { type: "ready", matchId: old, ready: true });
    expect(game.room.players[0]).toMatchObject({
      name: "New King",
      ready: false,
    });
    start();
    expect(game.battle!.deck).toEqual(PRESETS[1].deck);
    expect(game.battle!.time).toBe(0);
    game.advance(0.5);
    expect(game.battle!.time).toBe(0);
    play();
    const b = game.battle!,
      card = b.players.blue.hand.find(
        (id) => CARD_MAP[id].cost <= b.players.blue.elixir,
      )!;
    game.receive("blue", {
      type: "play",
      matchId: old,
      seq: 1000,
      card,
      x: 4,
      y: 22,
    });
    game.receive("blue", { type: "surrender", matchId: old });
    game.receive("blue", { type: "emote", matchId: old, kind: "thumbs" });
    expect(b.actions).toHaveLength(0);
    expect(b.winner).toBeNull();
    send("blue", { type: "play", seq: 1, card, x: 4, y: 22 });
    expect(b.actions).toHaveLength(1);
    send("blue", { type: "emote", kind: "thumbs" });
    expect(events.filter((e) => e.message.type === "emote")).toHaveLength(4);
    expect(
      events.filter((e) => e.message.type === "ack").at(-1)?.message,
    ).toMatchObject({ matchId: game.room.matchId, ok: true });
    expect(
      events.filter((e) => e.message.type === "emote").at(-1)?.message,
    ).toMatchObject({ matchId: game.room.matchId });
  });
  it("records three distinct rounds exactly once without rewards and reconstructs their independent replays", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const p = loadProfile(),
      before = { gold: p.gold, trophies: p.trophies, chests: [...p.chests] };
    const { game, events, start, play, send, vote } = match();
    const seeds: number[] = [];
    for (let round = 0; round < 3; round++) {
      start();
      play();
      const b = game.battle!;
      seeds.push(b.seed);
      const card = b.players.blue.hand.find(
        (id) => CARD_MAP[id].cost <= b.players.blue.elixir,
      )!;
      send("blue", { type: "play", seq: round + 1, card, x: 4, y: 22 });
      for (let i = 0; i < 45; i++) game.advance(STEP);
      send("red", { type: "surrender" });
      const ending = events
        .filter(
          (e) =>
            e.team === "blue" && e.message.type === "state" && e.message.replay,
        )
        .at(-1)!.message as Extract<ServerMessage, { type: "state" }>;
      expect(ending.matchId).toBe(game.room.matchId);
      const reward = () =>
        recordBattle(p, b, {
          friendly: true,
          opponent: "Queen",
          opponentType: "friend",
          matchId: game.room.matchId,
          replay: ending.replay,
        });
      expect(reward()).toEqual({ trophies: 0, gold: 0, chest: null });
      reward();
      expect(p.history).toHaveLength(round + 1);
      const rebuilt = new Battle({ replay: ending.replay! });
      while (rebuilt.tick < ending.replay!.duration) rebuilt.step();
      expect(rebuilt.players).toEqual(b.players);
      expect(rebuilt.entities).toEqual(b.entities);
      expect(rebuilt.audioEvents).toEqual(b.audioEvents);
      if (round < 2) {
        vote("blue");
        vote("red");
      }
    }
    expect(new Set(p.history.map((r) => r.matchId)).size).toBe(3);
    expect(new Set(seeds).size).toBe(3);
    expect(p.battles).toBe(3);
    expect(p.wins).toBe(3);
    expect({ gold: p.gold, trophies: p.trophies, chests: p.chests }).toEqual(
      before,
    );
  });
});
function client() {
  vi.stubGlobal("document", { addEventListener: vi.fn(), hidden: false });
  const c = new PeerRoomClient();
  Object.assign(c, {
    joined: true,
    setup: "connected",
    connected: true,
    player,
    room: {
      code: "invite",
      matchId: "invite:2",
      phase: "finished",
      mode: "classic",
      players: [],
    },
  });
  return c;
}
describe("peer client round isolation", () => {
  it.each(["blue", "red"] as const)(
    "tags outgoing %s commands and retains an explicitly captured vote identity",
    (team) => {
      const c = client();
      c.team = team;
      const post = vi.spyOn(c as any, "post");
      const channel = { readyState: "open", bufferedAmount: 0, send: vi.fn() };
      Object.assign(c, { channel });
      expect(c.send({ type: "ready", ready: true })).toBe(true);
      expect(
        c.send({ type: "rematch", ready: true, matchId: "invite:1" }),
      ).toBe(true);
      const messages =
        team === "blue"
          ? post.mock.calls.map(([v]) => (v as any).message)
          : channel.send.mock.calls.map(
              ([raw]) => (new PeerAssembler().receive(raw) as any).message,
            );
      expect(messages[0]).toMatchObject({ type: "ready", matchId: "invite:2" });
      expect(messages[1]).toMatchObject({
        type: "rematch",
        matchId: "invite:1",
      });
    },
  );
  it.each(["state", "ack", "emote", "quick-chat"] as const)(
    "drops old %s without clearing a new pending play or presenting stale reactions",
    (type) => {
      const c = client(),
        output = vi.fn();
      c.onMessage = output;
      c.pending = true;
      c.actionCount = 9;
      const payload = {
        type,
        matchId: "invite:1",
        state: snapshot(new Battle({ ai: false })),
        seq: 1,
        ok: true,
        team: "red",
        kind: "thumbs",
        phrase: "good-luck",
      };
      (c as any).receive(payload);
      expect(output).not.toHaveBeenCalled();
      expect(c.pending).toBe(true);
      expect(c.actionCount).toBe(9);
      (c as any).receive({ ...payload, matchId: "invite:2" });
      expect(output).toHaveBeenCalledTimes(1);
      expect(c.pending).toBe(type !== "state" && type !== "ack");
    },
  );
  it("notifies the completed result when the channel closes without destroying the saved room", () => {
    const c = client(),
      connection = vi.fn();
    c.onConnection = connection;
    const channel: any = { readyState: "open", close: vi.fn() };
    (c as any).bind(channel, 0);
    channel.onclose();
    expect(c.connected).toBe(false);
    expect(c.room?.phase).toBe("finished");
    expect(connection).toHaveBeenCalledWith("reconnecting");
  });
});
