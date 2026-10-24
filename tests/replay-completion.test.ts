import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import {
  completeRecordedReplay,
  replayComplete,
} from "../src/game/replay-completion";
import { CARD_MAP } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";

function source() {
  const live = new Battle({ seed: 1, ai: false });
  for (const team of ["blue", "red"] as const) {
    const slot = live.players[team].hand.findIndex(
      (id) =>
        CARD_MAP[id].kind === "troop" &&
        CARD_MAP[id].cost <= live.players[team].elixir,
    );
    expect(
      live.play(team, slot, team === "blue" ? 4 : 14, team === "blue" ? 22 : 10)
        .ok,
    ).toBe(true);
  }
  const replay = live.exportReplay();
  return { battle: new Battle({ replay }), replay };
}

describe("canonical replay completion", () => {
  for (const viewer of ["blue", "red"] as const)
    it.each(["blue", "red", "draw"] as const)(
      `${viewer} viewer completes a recorded %s result with unique canonical events`,
      (winner) => {
        const { battle, replay } = source();
        const metadata = { ...replay, perspective: viewer };
        const before = battle.events.at(-1)!.id,
          clock = battle.time,
          players = structuredClone(battle.players),
          commands = structuredClone(replay.actions);
        expect(completeRecordedReplay(battle, metadata, winner)).toBe(true);
        const view = perspective(snapshot(battle), viewer);
        expect(view.winner).toBe(winner);
        expect(battle.events.at(-1)).toMatchObject({
          type: "finish",
          time: clock,
        });
        expect(battle.events.at(-1)!.id).toBeGreaterThan(before);
        expect(new Set(view.events.map((e) => e.id)).size).toBe(
          view.events.length,
        );
        expect(battle.time).toBe(clock);
        expect(battle.players).toEqual(players);
        expect(replay.actions).toEqual(commands);
        expect(view.actionCount).toBe(commands.length);
        expect(completeRecordedReplay(battle, metadata, winner)).toBe(false);
        expect(battle.events.filter((e) => e.type === "finish")).toHaveLength(
          1,
        );
      },
    );
  it("does not finish an unfinished recording early", () => {
    const { battle, replay } = source(),
      before = structuredClone(snapshot(battle));
    expect(replayComplete(battle, { duration: 10 })).toBe(false);
    expect(
      completeRecordedReplay(battle, { ...replay, duration: 10 }, "red"),
    ).toBe(false);
    expect(snapshot(battle)).toEqual(before);
  });
  it("treats a natural ending as complete even with a longer duration and preserves its actual result", () => {
    const { battle, replay } = source();
    battle.finish("red", "King Tower destroyed");
    const before = structuredClone(snapshot(battle));
    expect(replayComplete(battle, { duration: 9000 })).toBe(true);
    expect(
      completeRecordedReplay(
        battle,
        { ...replay, duration: 9000, perspective: "red" },
        "red",
      ),
    ).toBe(false);
    expect(snapshot(battle)).toEqual(before);
    expect(battle.reason).toBe("King Tower destroyed");
  });
});
