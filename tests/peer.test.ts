import { describe, expect, it } from "vitest";
import { PeerMatch } from "../src/network/peer-match";
import { STARTER_DECK } from "../src/game/cards";
import { Battle, STEP } from "../src/game/engine";
import type { Team } from "../src/game/engine";
import type { ServerMessage } from "../src/network/protocol";
import {
  decodeSignal,
  encodeSignal,
  PeerAssembler,
  peerChunks,
} from "../src/network/peer-signaling";
const player = { name: "King", deck: STARTER_DECK };
function match() {
  const events: { team: Team; message: ServerMessage }[] = [];
  const game = new PeerMatch(
    "1234567890abcdef12345678",
    "classic",
    player,
    42,
    (team, message) => events.push({ team, message: structuredClone(message) }),
  );
  const start = () => {
    expect(game.join({ ...player, name: "Queen" })).toBe(true);
    game.receive("blue", { type: "ready", ready: true });
    game.receive("red", { type: "ready", ready: true });
    for (let i = 0; i < 120; i++) game.advance(STEP);
  };
  return { game, events, start };
}
describe("browser-owned friendly match", () => {
  it("requires two valid players and both ready checks before starting", () => {
    const { game } = match();
    expect(game.join({ ...player, deck: Array(8).fill("knight") })).toBe(false);
    game.receive("blue", { type: "ready", ready: true });
    expect(game.battle).toBeUndefined();
    expect(game.join(player)).toBe(true);
    expect(game.join(player)).toBe(false);
    game.receive("red", { type: "ready", ready: true });
    expect(game.room.phase).toBe("countdown");
    expect(game.battle?.tick).toBe(0);
    game.advance(0.5);
    expect(game.battle?.tick).toBe(0);
  });
  it("validates both players' deployments and rejects duplicate spending", () => {
    const { game, events, start } = match();
    start();
    const b = game.battle!;
    const card = b.players.red.hand.find(
      (c) =>
        c === "knight" ||
        c === "archers" ||
        c === "minions" ||
        c === "fireball",
    )!;
    game.receive("red", { type: "play", seq: 1, card, x: 4, y: 8 });
    expect(b.actions.length).toBe(1);
    game.receive("red", { type: "play", seq: 1, card, x: 4, y: 8 });
    expect(b.actions.length).toBe(1);
    game.receive("blue", {
      type: "play",
      seq: 2,
      card: "knight",
      x: NaN,
      y: 22,
    });
    expect(b.actions.length).toBe(1);
    expect(
      events.filter((e) => e.message.type === "ack").at(-1)?.message,
    ).toMatchObject({ ok: false });
    const blueState = events
      .filter((e) => e.team === "blue" && e.message.type === "state")
      .at(-1)!.message as Extract<ServerMessage, { type: "state" }>;
    expect(blueState.state.players.red.elixir).toBe(0);
    expect(blueState.state.players.blue.elixir).toBeGreaterThan(0);
  });
  it("freezes combat and countdown when either browser is unavailable", () => {
    const { game, start } = match();
    start();
    const tick = game.battle!.tick;
    game.availability("red", false);
    for (let i = 0; i < 300; i++) game.advance(STEP);
    expect(game.battle!.tick).toBe(tick);
    game.availability("blue", false);
    game.availability("red", true);
    game.advance(STEP);
    expect(game.battle!.tick).toBe(tick);
    game.availability("blue", true);
    game.advance(STEP);
    expect(game.battle!.tick).toBe(tick + 1);
  });
  it("shares one reaction cooldown and produces the same final replay for both perspectives", () => {
    const { game, events, start } = match();
    start();
    game.receive("blue", { type: "emote", kind: "thumbs" });
    game.receive("blue", { type: "quick-chat", phrase: "good-luck" });
    expect(events.filter((e) => e.message.type === "emote")).toHaveLength(2);
    expect(events.filter((e) => e.message.type === "quick-chat")).toHaveLength(
      0,
    );
    for (let i = 0; i < 80; i++) game.advance(STEP);
    game.receive("blue", { type: "quick-chat", phrase: "good-luck" });
    expect(events.filter((e) => e.message.type === "quick-chat")).toHaveLength(
      2,
    );
    game.receive("red", { type: "surrender" });
    const endings = events.filter(
      (e) => e.message.type === "state" && e.message.replay,
    );
    expect(endings).toHaveLength(2);
    const a = endings[0].message as Extract<ServerMessage, { type: "state" }>;
    const z = endings[1].message as Extract<ServerMessage, { type: "state" }>;
    expect(a.replay).toEqual(z.replay);
    const replay = new Battle({ replay: a.replay! });
    while (replay.tick < a.replay!.duration) replay.step();
    expect(replay.entities).toEqual(game.battle!.entities);
    expect(replay.players).toEqual(game.battle!.players);
    // Surrender is retained by the match record, outside replay commands.
    expect(a.state.winner).toBe("blue");
    expect(game.room.phase).toBe("finished");
  });
});
describe("manual peer signaling and bounded data packets", () => {
  const offer = {
    version: 1,
    type: "offer",
    id: "1234567890abcdef12345678",
    mode: "classic",
    sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
  } as const;
  it("accepts an invite link or token and rejects truncated or incompatible signals", () => {
    const token = encodeSignal(offer);
    expect(decodeSignal(token)).toEqual(offer);
    expect(decodeSignal(`https://example.test/#battle=${token}`)).toEqual(
      offer,
    );
    expect(() => decodeSignal(token.slice(0, -10))).toThrow();
    expect(() =>
      decodeSignal(encodeSignal({ ...offer, version: 2 } as any)),
    ).toThrow();
    expect(() => decodeSignal("CR1." + "a".repeat(24000))).toThrow();
  });
  it("reassembles large Unicode snapshots without exceeding channel limits", () => {
    const value = { text: "👑".repeat(90000), tick: 120 };
    const assembler = new PeerAssembler();
    const parts = peerChunks(value, 1);
    expect(parts.length).toBeGreaterThan(10);
    for (const part of parts.slice(0, -1))
      expect(assembler.receive(part)).toBeUndefined();
    expect(assembler.receive(parts.at(-1))).toEqual(value);
    expect(
      Math.max(...parts.map((p) => new TextEncoder().encode(p).length)),
    ).toBeLessThan(65536);
  });
  it("rejects out-of-order and oversized updates", () => {
    const parts = peerChunks({ text: "a".repeat(30000) }, 1);
    const assembler = new PeerAssembler();
    assembler.receive(parts[0]);
    expect(() => assembler.receive(parts[2])).toThrow();
    expect(() => peerChunks("a".repeat(1000000), 2)).toThrow();
    expect(() =>
      assembler.receive('{"id":1,"index":0,"total":999999,"text":"x"}'),
    ).toThrow();
  });
});
