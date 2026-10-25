import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARDS, CARD_MAP, STARTER_DECK, type CardId } from "../src/game/cards";
import { isPlayableCard } from "../src/game/playable-cards";
import { Battle } from "../src/game/engine";
import {
  decodeDeckCode,
  encodeDeckCode,
  DECK_CODE_PREFIX,
} from "../src/game/deck-code";
import {
  exportProgress,
  importProgress,
  loadProfile,
  validDeck,
  validRecordEntry,
  type RecordEntry,
} from "../src/game/profile";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";
import { PeerMatch, validPeerPlayer } from "../src/network/peer-match";
import { PeerRoomClient } from "../src/network/peer-client";
import { PEER_PROTOCOL, PROTOCOL } from "../src/network/protocol";
import { attachRooms } from "../server/rooms";

const fake = vi.hoisted(() => ({ wss: undefined as any }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer: class extends EventEmitter {
      constructor() {
        super();
        fake.wss = this;
      }
      close() {}
    },
  };
});
const invalidCards = [
  "golemite",
  "lava-pup",
  "constructor",
  "unknown",
] as const;
const deckWith = (card: string) => [card, ...STARTER_DECK.slice(1)] as CardId[];
const player = { name: "King", deck: [...STARTER_DECK] };
const recording = (): RecordEntry => ({
  id: 42,
  date: "2026-10-24T12:00:00Z",
  mode: "classic",
  winner: "blue",
  crowns: [3, 0],
  replay: new Battle({ seed: 42, ai: false }).exportReplay(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("playable card input boundaries", () => {
  it("accepts the full collection while retaining spawned units only in the internal map", () => {
    expect(CARDS).toHaveLength(74);
    for (const card of CARDS) {
      const deck = [
        card.id,
        ...STARTER_DECK.filter((id) => id !== card.id).slice(0, 7),
      ];
      expect(isPlayableCard(card.id)).toBe(true);
      expect(validDeck(deck)).toBe(true);
      expect(validPeerPlayer({ ...player, deck })).toBe(true);
      expect(decodeDeckCode(encodeDeckCode(deck))).toEqual(deck);
      expect(() => new Battle({ deck, ai: false })).not.toThrow();
    }
    expect(CARD_MAP.golemite).toBeDefined();
    expect(CARD_MAP["lava-pup"]).toBeDefined();
    expect(isPlayableCard(null)).toBe(false);
  });
  it.each(invalidCards)(
    "rejects %s decks before codes, storage, backups or replays reach Battle",
    (card) => {
      const deck = deckWith(card);
      expect(validDeck(deck)).toBe(false);
      expect(validPeerPlayer({ ...player, deck })).toBe(false);
      expect(() => encodeDeckCode(deck)).toThrow(/supported/);
      expect(() => decodeDeckCode(DECK_CODE_PREFIX + deck.join(","))).toThrow(
        /supported/,
      );
      expect(() => new Battle({ deck })).toThrow(/valid cards/);
      vi.stubGlobal("localStorage", { getItem: () => null });
      const profile = loadProfile();
      const corrupt = structuredClone(profile);
      corrupt.deck = deck;
      corrupt.decks[0] = deck;
      corrupt.history = [
        { ...recording(), replay: { ...recording().replay, deck } },
      ];
      vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(corrupt) });
      const restored = loadProfile();
      expect(restored.deck).toEqual(STARTER_DECK);
      expect(restored.history).toEqual([]);
      const backup = JSON.parse(exportProgress(profile));
      backup.profile.deck = deck;
      expect(() => importProgress(JSON.stringify(backup))).toThrow(/invalid/);
      const replay = JSON.parse(exportReplayFile(recording(), "King"));
      replay.match.replay.deck = deck;
      expect(() => importReplayFile(JSON.stringify(replay))).toThrow(/invalid/);
    },
  );
  it.each(invalidCards)(
    "rejects %s actions and placement independently of valid decks",
    (card) => {
      const record = recording();
      record.replay.actions = [
        { tick: 0, team: "blue", card: card as CardId, x: 4, y: 24 },
      ];
      expect(validRecordEntry(record)).toBe(false);
      expect(() => new Battle({ replay: record.replay })).toThrow(/unplayable/);
      const game = new Battle({ ai: false });
      expect(game.canPlace("blue", card as CardId, 4, 24).ok).toBe(false);
      const replay = JSON.parse(exportReplayFile(recording(), "King"));
      replay.match.replay.actions = record.replay.actions;
      expect(() => importReplayFile(JSON.stringify(replay))).toThrow(/invalid/);
    },
  );
  it.each(["golemite", "lava-pup"])(
    "rejects %s peer hello and loadout before starting a battle",
    (card) => {
      vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
      const client = new PeerRoomClient();
      Object.assign(client, { id: "invite", team: "blue" });
      const post = vi.spyOn(client as any, "post");
      expect(() =>
        (client as any).handle({
          kind: "hello",
          id: "invite",
          version: PEER_PROTOCOL,
          player: { ...player, deck: deckWith(card) },
        }),
      ).toThrow();
      expect(post).not.toHaveBeenCalled();
      const output: any[] = [];
      const game = new PeerMatch(
        "invite",
        "classic",
        player,
        42,
        (_, message) => output.push(message),
      );
      expect(game.join({ ...player, deck: deckWith(card) })).toBe(false);
      expect(game.join({ ...player, name: "Queen" })).toBe(true);
      game.receive("red", {
        type: "loadout",
        matchId: game.room.matchId,
        name: "Queen",
        deck: deckWith(card),
      });
      expect(output.at(-1)).toMatchObject({ type: "error" });
      expect(game.battle).toBeUndefined();
      for (const team of ["blue", "red"] as const)
        game.receive(team, {
          type: "ready",
          ready: true,
          matchId: game.room.matchId,
        });
      expect(game.battle).toBeDefined();
      game.room.phase = "playing";
      const play = vi.spyOn(game.battle!, "play");
      game.receive("red", {
        type: "play",
        seq: 1,
        card: card as CardId,
        x: 4,
        y: 10,
        matchId: game.room.matchId,
      });
      expect(play).not.toHaveBeenCalled();
      expect(output.at(-1)).toMatchObject({ type: "ack", ok: false });
    },
  );
  it.each(["golemite", "lava-pup"])(
    "rejects %s legacy room identities and commands without opening a server",
    (card) => {
      const http = new EventEmitter();
      const rooms = attachRooms(http as any);
      const connect = () => {
        const socket = Object.assign(new EventEmitter(), {
          readyState: 1,
          bufferedAmount: 0,
          send: vi.fn(),
          terminate: vi.fn(),
          close: vi.fn(),
        });
        fake.wss.emit("connection", socket);
        return {
          socket,
          send: (message: object) =>
            socket.emit("message", Buffer.from(JSON.stringify(message)), false),
        };
      };
      try {
        const host = connect();
        host.send({
          type: "create",
          version: PROTOCOL,
          mode: "classic",
          ...player,
          deck: deckWith(card),
        });
        expect(rooms.rooms.size).toBe(0);
        expect(
          JSON.parse(host.socket.send.mock.calls.at(-1)![0]),
        ).toMatchObject({ type: "error" });
        host.send({
          type: "create",
          version: PROTOCOL,
          mode: "classic",
          ...player,
        });
        const room = [...rooms.rooms.values()][0];
        const guest = connect();
        guest.send({
          type: "join",
          version: PROTOCOL,
          code: room.code,
          ...player,
          deck: deckWith(card),
        });
        expect(room.players).toHaveLength(1);
        room.battle = new Battle({ ai: false });
        room.phase = "playing";
        const play = vi.spyOn(room.battle, "play");
        host.send({ type: "play", seq: 1, card, x: 4, y: 24 });
        expect(play).not.toHaveBeenCalled();
        expect(
          JSON.parse(host.socket.send.mock.calls.at(-1)![0]),
        ).toMatchObject({ type: "ack", ok: false });
      } finally {
        rooms.close();
      }
    },
  );
});
