import { expect, it } from "vitest";
import { Battle, type Replay } from "../src/game/engine";
import { CARD_MAP } from "../src/game/cards";
import { replayView } from "../src/ui/replay-view";
import { createReplayPlayback } from "../src/replay-playback";
import { completeRecordedReplay } from "../src/game/replay-completion";
import { perspective, snapshot } from "../src/network/perspective";

function recording(family: "origin" | "local", red: boolean) {
  const initial = new Battle({ seed: 12, ai: false });
  const replay: Replay = {
    ...initial.exportReplay(),
    rulesFamily: family,
    version: family === "local" ? 5 : 56,
    ...(red ? { perspective: "red" } : {}),
  };
  const battle = new Battle({ replay });
  for (const team of ["blue", "red"] as const) {
    const slot = battle.players[team].hand.findIndex(
      (id) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 5,
    );
    expect(
      battle.play(
        team,
        slot,
        team === "blue" ? 4 : 14,
        team === "blue" ? 24 : 8,
      ).ok,
    ).toBe(true);
  }
  while (battle.tick < 90) battle.step();
  return {
    replay: {
      ...battle.exportReplay(),
      ...(red ? { perspective: "red" as const } : {}),
    },
    opponent: "Recorded Rival",
  };
}

for (const family of ["origin", "local"] as const)
  for (const red of [false, true])
    it(`${family} ${red ? "red" : "blue"} recordings can be viewed from either side without changing canonical play`, () => {
      const record = recording(family, red);
      const before = structuredClone(record);
      Object.freeze(record.replay.actions);
      Object.freeze(record.replay);
      Object.freeze(record);
      for (const opponent of [false, true]) {
        const view = replayView(record, "Recorded Captain", opponent);
        const team = (opponent ? !red : red) ? "red" : "blue";
        expect(view.playerName).toBe(
          opponent ? record.opponent : "Recorded Captain",
        );
        expect(view.opponentName).toBe(
          opponent ? "Recorded Captain" : record.opponent,
        );
        for (const tick of [0, 45, 90]) {
          const playback = createReplayPlayback(view.replay, tick);
          const canonical = createReplayPlayback(record.replay, tick);
          const expected = perspective(
            snapshot(canonical.source ?? canonical.battle),
            team,
          );
          const actual = snapshot(playback.battle);
          expect(actual.players).toEqual(expected.players);
          expect(actual.entities).toEqual(expected.entities);
          expect(playback.battle.rulesFamily).toBe(family);
          expect(playback.battle.rulesVersion).toBe(
            family === "local" ? 5 : 56,
          );
        }
      }
      expect(replayView(record, "Recorded Captain").replay).toBe(record.replay);
      expect(record).toEqual(before);
    });

it("uses the original recorded perspective to finish a truncated replay in either display view", () => {
  for (const family of ["origin", "local"] as const)
    for (const red of [false, true])
      for (const opponent of [false, true]) {
        const record = recording(family, red);
        const view = replayView(record, "Recorded Captain", opponent);
        const playback = createReplayPlayback(
          view.replay,
          record.replay.duration,
        );
        const canonical = playback.source ?? playback.battle;
        expect(completeRecordedReplay(canonical, record.replay, "blue")).toBe(
          true,
        );
        const projected = perspective(
          snapshot(canonical),
          view.replay.perspective ?? "blue",
        );
        expect(projected.winner).toBe(opponent ? "red" : "blue");
        expect(record.replay.actions).toEqual(canonical.actions);
      }
});

it("retains the legacy opponent fallback and literal recorded names", () => {
  const { replay } = recording("origin", false);
  const view = replayView({ replay }, "<b>Captain & King</b>", true);
  expect(view.playerName).toBe("Royal Trainer");
  expect(view.opponentName).toBe("<b>Captain & King</b>");
});
