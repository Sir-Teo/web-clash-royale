import { sendPeerCommand as send } from "./helpers/peer-command";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerMatch, type PeerPlayer } from "../src/network/peer-match";
import { PeerRoomClient } from "../src/network/peer-client";
import {
  PEER_PROTOCOL,
  type ServerMessage,
  type RoomState,
} from "../src/network/protocol";
import { STARTER_DECK, PRESETS, CARD_MAP } from "../src/game/cards";
import { Battle, STEP, type Team } from "../src/game/engine";
import { snapshot } from "../src/network/perspective";
const host: PeerPlayer = { name: "King", deck: [...STARTER_DECK] };
const guest: PeerPlayer = { name: "Queen", deck: [...PRESETS[2].deck] };
const next: PeerPlayer = { name: "New King", deck: [...PRESETS[1].deck] };
function match(join = true) {
  const events: { team: Team; message: ServerMessage }[] = [];
  const game = new PeerMatch(
    "1234567890abcdef12345678",
    "classic",
    host,
    42,
    (team, message) => events.push({ team, message }),
  );
  if (join) game.join(guest);
  return { game, events };
}
const command = (p: PeerPlayer) => ({
  type: "loadout" as const,
  name: p.name,
  deck: [...p.deck],
});
const start = (game: PeerMatch) => {
  send(game, "blue", { type: "ready", ready: true });
  send(game, "red", { type: "ready", ready: true });
};

describe("waiting peer loadouts", () => {
  it.each(["blue", "red"] as const)(
    "accepts %s changes and clears both Ready checks",
    (team) => {
      const { game, events } = match();
      send(game, team === "blue" ? "red" : "blue", {
        type: "ready",
        ready: true,
      });
      events.length = 0;
      send(game, team, command(next));
      expect(game.room.players.every((p) => !p.ready)).toBe(true);
      expect(game.room.players.find((p) => p.team === team)?.name).toBe(
        next.name,
      );
      const welcome = events.filter((e) => e.message.type === "welcome");
      expect(welcome).toHaveLength(1);
      expect(welcome[0]).toMatchObject({
        team,
        message: {
          peerVersion: PEER_PROTOCOL,
          name: next.name,
          deck: next.deck,
        },
      });
      expect(
        events
          .filter((e) => e.message.type === "room")
          .every((e) => !JSON.stringify(e.message).includes('"deck"')),
      ).toBe(true);
      start(game);
      expect(
        team === "blue" ? game.battle?.deck : game.battle?.enemyDeck,
      ).toEqual(next.deck);
    },
  );
  it("keeps readiness and emits nothing when the loadout is unchanged", () => {
    const { game, events } = match();
    send(game, "blue", { type: "ready", ready: true });
    events.length = 0;
    send(game, "blue", command(host));
    expect(game.room.players[0].ready).toBe(true);
    expect(events).toEqual([]);
  });
  it("recognizes card order changes even when the card set and name stay the same", () => {
    const { game } = match();
    send(game, "red", { type: "ready", ready: true });
    send(game, "blue", command({ ...host, deck: [...host.deck].reverse() }));
    expect(game.room.players.every((p) => !p.ready)).toBe(true);
    start(game);
    expect(game.battle?.deck).toEqual([...host.deck].reverse());
  });
  it("rejects invalid names, unsupported cards and duplicate decks without changing readiness", () => {
    const { game, events } = match();
    send(game, "red", { type: "ready", ready: true });
    const room = structuredClone(game.room);
    for (const invalid of [
      { ...next, name: "" },
      { ...next, name: "X".repeat(19) },
      { ...next, name: "Bad\u0000name" },
      { ...next, deck: Array(8).fill("knight") },
      { ...next, deck: [...next.deck.slice(0, 7), "unknown"] },
      { ...next, deck: null },
    ]) {
      events.length = 0;
      send(game, "red", { type: "loadout", ...invalid } as any);
      expect(game.room).toEqual(room);
      expect(events).toEqual([
        {
          team: "red",
          message: {
            type: "error",
            message: "Choose a valid name and eight different cards.",
          },
        },
      ]);
    }
    start(game);
    expect(game.battle?.enemyDeck).toEqual(guest.deck);
  });
  it("does not confirm a loadout or join the host before a friend connects", () => {
    const { game, events } = match(false);
    send(game, "blue", command(next));
    expect(events).toEqual([]);
    game.join(guest);
    start(game);
    expect(game.battle?.deck).toEqual(host.deck);
  });
  it("owns accepted decks independently of submitted arrays and emitted confirmations", () => {
    const { game, events } = match();
    const joined = events.find(
      (e) => e.team === "blue" && e.message.type === "welcome",
    )!.message as Extract<ServerMessage, { type: "welcome" }>;
    joined.deck.reverse();
    const submitted = command(next);
    send(game, "red", submitted);
    submitted.deck.reverse();
    const accepted = events
      .filter((e) => e.team === "red" && e.message.type === "welcome")
      .at(-1)!.message as Extract<ServerMessage, { type: "welcome" }>;
    accepted.deck.reverse();
    start(game);
    expect(game.battle?.deck).toEqual(host.deck);
    expect(game.battle?.enemyDeck).toEqual(next.deck);
  });
  it("freezes deck and names throughout countdown, active play and the recorded result", () => {
    const { game, events } = match();
    start(game);
    for (const phase of ["countdown", "playing", "finished"]) {
      expect(game.room.phase).toBe(phase);
      events.length = 0;
      send(game, "blue", command(next));
      expect(events).toEqual([]);
      expect(game.room.players[0].name).toBe(host.name);
      expect(game.battle?.deck).toEqual(host.deck);
      if (phase === "countdown")
        for (let i = 0; i < 120; i++) game.advance(STEP);
      if (phase === "playing") send(game, "red", { type: "surrender" });
    }
    expect(game.battle?.exportReplay().deck).toEqual(host.deck);
  });
  it("reconstructs actual plays from both updated decks exactly from their recording", () => {
    const { game } = match();
    send(game, "blue", command(next));
    const red = { ...guest, deck: [...guest.deck].reverse() };
    send(game, "red", command(red));
    start(game);
    for (let i = 0; i < 120; i++) game.advance(STEP);
    for (const team of ["blue", "red"] as const) {
      const card = game.battle!.players[team].hand.find(
        (id) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 5,
      )!;
      send(game, team, {
        type: "play",
        seq: 1,
        card,
        x: 4,
        y: team === "blue" ? 22 : 10,
      });
    }
    for (let i = 0; i < 180; i++) game.advance(STEP);
    expect(game.battle!.actions).toHaveLength(2);
    const replay = game.battle!.exportReplay();
    const rebuilt = new Battle({ replay });
    while (rebuilt.tick < replay.duration) rebuilt.step();
    rebuilt.applyReplayActions();
    expect(snapshot(rebuilt)).toEqual(snapshot(game.battle!));
    expect(rebuilt.audioEvents).toEqual(game.battle!.audioEvents);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function client() {
  vi.stubGlobal("document", { addEventListener: vi.fn(), hidden: false });
  const client = new PeerRoomClient();
  const room: RoomState = {
    code: "1234567890abcdef12345678",
    phase: "waiting",
    mode: "classic",
    players: [
      { team: "blue", name: host.name, ready: false, connected: true },
      { team: "red", name: guest.name, ready: false, connected: true },
    ],
  };
  Object.assign(client, {
    joined: true,
    connected: true,
    player: structuredClone(host),
    room,
  });
  return client;
}
const confirmation = (
  p: PeerPlayer,
  peerVersion: number | undefined = PEER_PROTOCOL,
) => ({
  type: "welcome" as const,
  code: "1234567890abcdef12345678",
  token: "",
  team: "blue" as const,
  mode: "classic" as const,
  name: p.name,
  deck: [...p.deck],
  peerVersion,
});

describe("confirmed peer client loadouts", () => {
  it("deduplicates pending updates and exposes only cloned confirmed values", () => {
    const c = client();
    const send = vi.spyOn(c, "send").mockReturnValue(true);
    const desired = structuredClone(next);
    expect(c.updatePlayer(desired)).toBe(true);
    expect(c.updatePlayer(desired)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    desired.deck.reverse();
    expect(c.loadout).toEqual(host);
    const exposed = c.loadout!;
    exposed.deck.reverse();
    exposed.name = "Changed";
    expect(c.loadout).toEqual(host);
    (c as any).receive(confirmation(next));
    expect(c.loadout).toEqual(next);
    expect((c as any).pendingPlayer).toBeUndefined();
    expect(c.updatePlayer(next)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retains the newest pending choice while older confirmations arrive", () => {
    const c = client();
    const send = vi.spyOn(c, "send").mockReturnValue(true);
    c.updatePlayer(next);
    c.updatePlayer(guest);
    (c as any).receive(confirmation(next));
    expect(c.loadout).toEqual(next);
    expect(c.updatePlayer(guest)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    (c as any).receive(confirmation(guest));
    expect((c as any).pendingPlayer).toBeUndefined();
    expect(c.loadout).toEqual(guest);
  });
  it("can revert to the original choice while another update is pending", () => {
    const c = client();
    const send = vi.spyOn(c, "send").mockReturnValue(true);
    c.updatePlayer(next);
    c.updatePlayer(host);
    expect(send).toHaveBeenCalledTimes(2);
    (c as any).receive(confirmation(next));
    (c as any).receive(confirmation(host));
    expect(c.loadout).toEqual(host);
    expect((c as any).pendingPlayer).toBeUndefined();
  });
  it("rejects invalid, disconnected and post-countdown edits without sending", () => {
    const c = client();
    const send = vi.spyOn(c, "send").mockReturnValue(true);
    expect(c.updatePlayer({ ...next, name: "" })).toBe(false);
    c.connected = false;
    expect(c.updatePlayer(next)).toBe(false);
    c.connected = true;
    (c as any).receive({
      type: "room",
      room: { ...c.room, phase: "countdown" },
    });
    expect(c.updatePlayer(next)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(c.loadout).toEqual(host);
  });
  it.each([undefined, 1, 2, PEER_PROTOCOL + 1])(
    "rejects incompatible peer welcome version %s with an update action",
    (version) => {
      const c = client();
      const output = vi.fn();
      c.onMessage = output;
      const message = confirmation(host);
      message.peerVersion = version;
      (c as any).receive(message);
      expect(c.connected).toBe(false);
      expect(c.loadout).toBeNull();
      expect(output).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          fatal: true,
          message: expect.stringContaining("Update both games"),
        }),
      );
    },
  );
  it("rejects a legacy hello before joining the worker", () => {
    const c = client();
    Object.assign(c, { joined: false, id: "id" });
    const post = vi.spyOn(c as any, "post");
    expect(() =>
      (c as any).handle({ kind: "hello", id: "id", player: guest }),
    ).toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
