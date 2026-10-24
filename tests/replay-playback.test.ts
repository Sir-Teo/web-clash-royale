import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Battle, type Replay } from "../src/game/engine";
import { CARD_MAP } from "../src/game/cards";
import { createReplayPlayback } from "../src/replay-playback";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import { completeRecordedReplay } from "../src/game/replay-completion";
import type { BattleSnapshot } from "../src/network/protocol";

// Display Battles carry projected entities/events; accepted commands stay canonical.
function displayState(value: BattleSnapshot) {
  const { actionCount: _commands, areas, ...state } = value;
  return { ...state, areas: areas ?? [] };
}

const fixtures = [
  "legacy-replay.json",
  "combat-v2-replay.json",
  "combat-v3-replay.json",
  "combat-v4-replay.json",
].map(
  (name) =>
    JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8")).replay as Replay,
);
fixtures.push({ ...fixtures[3], version: 5 });

describe("canonical replay seeking", () => {
  for (const replay of fixtures)
    for (const viewer of ["blue", "red"] as const)
      it(`rules ${replay.version} ${viewer} matches incremental projection and resumes from the accepted command cursor`, () => {
        const metadata = { ...replay, perspective: viewer },
          original = structuredClone(metadata);
        for (const target of [0, 300, 900, replay.duration]) {
          const source = new Battle({ replay });
          // Match the old per-step projection path, including audio filtering.
          const view = new Battle({ replay: { ...replay, actions: [] } });
          applySnapshot(view, snapshot(source), viewer);
          while (source.tick < target && !source.winner) {
            source.step();
            applySnapshot(view, snapshot(source), viewer);
          }
          const rebuilt = createReplayPlayback(metadata, target),
            canonical = rebuilt.source ?? rebuilt.battle;
          expect(rebuilt.source !== null).toBe(viewer === "red");
          expect(rebuilt.battle.rulesVersion).toBe(replay.version);
          expect(rebuilt.battle.deck).toEqual(
            viewer === "red" ? replay.enemyDeck : replay.deck,
          );
          expect(rebuilt.battle.enemyDeck).toEqual(
            viewer === "red" ? replay.deck : replay.enemyDeck,
          );
          expect(displayState(snapshot(rebuilt.battle))).toEqual(
            displayState(snapshot(view)),
          );
          expect(canonical.actions).toEqual(source.actions);
          expect(canonical.audioEvents).toEqual(source.audioEvents);
          for (let i = 0; i < 31; i++) {
            canonical.step();
            source.step();
          }
          if (rebuilt.source)
            applySnapshot(rebuilt.battle, snapshot(canonical), viewer);
          expect(snapshot(canonical)).toEqual(snapshot(source));
          expect(canonical.actions).toEqual(source.actions);
          expect(displayState(snapshot(rebuilt.battle))).toEqual(
            displayState(perspective(snapshot(source), viewer)),
          );
        }
        expect(metadata).toEqual(original);
      });
  it("caps and floors targets and stops at an actual ending before a longer declared duration", () => {
    const replay = { ...fixtures[4], duration: 9000 };
    const canonical = new Battle({ replay });
    while (!canonical.winner && canonical.tick < replay.duration)
      canonical.step();
    expect(canonical.winner).not.toBeNull();
    for (const viewer of ["blue", "red"] as const) {
      const metadata = { ...replay, perspective: viewer };
      for (const target of [-1, NaN, Infinity])
        expect(createReplayPlayback(metadata, target).battle.tick).toBe(0);
      expect(createReplayPlayback(metadata, 10.9).battle.tick).toBe(10);
      const end = createReplayPlayback(metadata, 100_000);
      expect(end.battle.tick).toBe(canonical.tick);
      expect(displayState(snapshot(end.battle))).toEqual(
        displayState(perspective(snapshot(canonical), viewer)),
      );
      expect(
        completeRecordedReplay(end.source ?? end.battle, metadata, "draw"),
      ).toBe(false);
    }
  });
  it("retains final-tick and zero-duration commands, finishes canonically and creates independent rewinds", () => {
    for (const ticks of [0, 10]) {
      const live = new Battle({ seed: 1, ai: false });
      while (live.tick < ticks) live.step();
      const team = "red",
        player = live.players[team];
      const slot = player.hand.findIndex(
        (id) =>
          CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= player.elixir,
      );
      expect(live.play(team, slot, 14, 10).ok).toBe(true);
      const replay: Replay = { ...live.exportReplay(), perspective: "red" };
      const end = createReplayPlayback(replay, ticks);
      expect(end.battle.tick).toBe(ticks);
      expect(displayState(snapshot(end.battle))).toEqual(
        displayState(perspective(snapshot(live), "red")),
      );
      expect(end.source!.actions).toEqual(live.actions);
      expect(completeRecordedReplay(end.source!, replay, "blue")).toBe(true);
      applySnapshot(end.battle, snapshot(end.source!), "red");
      expect(end.battle.winner).toBe("blue");
      const rewind = createReplayPlayback(replay, 0);
      expect(rewind.battle.winner).toBeNull();
      expect(rewind.battle.tick).toBe(0);
      expect(end.battle.winner).toBe("blue");
    }
  });
});
