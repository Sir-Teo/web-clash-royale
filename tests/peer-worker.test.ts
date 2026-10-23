import { afterEach, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import { STARTER_DECK } from "../src/game/cards";
import type { PeerHostCommand } from "../src/network/peer-host-worker";
import type { ServerMessage } from "../src/network/protocol";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("retains a coherent snapshot while the UI has not acknowledged the previous one", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const scope = { onmessage: (_event: { data: PeerHostCommand }) => {} };
  const delivered: { team: string; message: ServerMessage }[] = [];
  vi.stubGlobal("self", scope);
  vi.stubGlobal("postMessage", (data: any) =>
    delivered.push(structuredClone(data)),
  );
  await import("../src/network/peer-host-worker");
  const send = (data: PeerHostCommand) => scope.onmessage({ data });
  const player = { name: "King", deck: STARTER_DECK };
  send({
    type: "init",
    id: "1234567890abcdef12345678",
    mode: "classic",
    player,
    seed: 42,
  });
  send({ type: "join", player });
  send({
    type: "command",
    team: "blue",
    message: { type: "ready", ready: true },
  });
  send({
    type: "command",
    team: "red",
    message: { type: "ready", ready: true },
  });
  vi.advanceTimersByTime(3950);
  // One snapshot in flight per team, despite over a hundred simulation updates.
  expect(delivered.filter((e) => e.message.type === "state")).toHaveLength(2);
  send({ type: "consumed", team: "blue" });
  const latest = delivered
    .filter((e) => e.team === "blue" && e.message.type === "state")
    .at(-1)!.message as Extract<ServerMessage, { type: "state" }>;
  expect(latest.state.tick).toBeGreaterThan(0);
  const expected = new Battle({
    ai: false,
    mode: "classic",
    seed: 42,
    deck: STARTER_DECK,
    enemyDeck: STARTER_DECK,
  });
  while (expected.tick < latest.state.tick) expected.step();
  expect(latest.state.entities).toEqual(expected.entities);
  expect(latest.state.players.blue).toEqual(expected.players.blue);
});
