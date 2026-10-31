import { expect, it } from "vitest";
import { Battle, type Action, type Team } from "../src/game/engine";
import { STARTER_DECK, CARD_MAP, type CardId } from "../src/game/cards";
import { createReplayPlayback } from "../src/replay-playback";
import { replayDeckUsage } from "../src/ui/replay-deck-usage";

const action = (team: Team, card: CardId, tick = 0): Action => ({
  team,
  card,
  tick,
  x: 4,
  y: 22,
});
it("keeps empty sides separate and defaults to the recorded blue side", () => {
  const result = replayDeckUsage([]);
  expect(result.viewed.total).toBe(0);
  expect(result.opponent.total).toBe(0);
  expect([...result.viewed.byCard]).toEqual([]);
  expect([...result.opponent.byCard]).toEqual([]);
});
it("counts repeated cards and simultaneous accepted commands independently for each team", () => {
  const actions = [
    action("blue", "knight"),
    action("red", "arrows"),
    action("blue", "knight", 60),
    action("red", "arrows", 90),
    action("red", "mirror", 120),
  ];
  actions.forEach(Object.freeze);
  Object.freeze(actions);
  const before = JSON.stringify(actions);
  const result = replayDeckUsage(actions);
  expect(result.viewed.total).toBe(2);
  expect([...result.viewed.byCard]).toEqual([["knight", 2]]);
  expect(result.opponent.total).toBe(3);
  expect([...result.opponent.byCard]).toEqual([
    ["arrows", 2],
    ["mirror", 1],
  ]);
  expect(JSON.stringify(actions)).toBe(before);
});
it("projects red-side usage without reassigning the recorded commands", () => {
  const actions = [
    action("blue", "knight"),
    action("red", "arrows"),
    action("red", "arrows", 60),
  ];
  const result = replayDeckUsage(actions, "red");
  expect(result.viewed.total).toBe(2);
  expect([...result.viewed.byCard]).toEqual([["arrows", 2]]);
  expect(result.opponent.total).toBe(1);
  expect([...result.opponent.byCard]).toEqual([["knight", 1]]);
});
it.each(["blue", "red"] as const)(
  "%s usage follows canonical consumption at the first and final recorded tick",
  (perspective) => {
    const battle = new Battle({
      seed: 1,
      ai: false,
      deck: STARTER_DECK,
      enemyDeck: STARTER_DECK,
    });
    const play = (team: Team) => {
      const slot = battle.players[team].hand.findIndex(
        (id) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 5,
      );
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(battle.play(team, slot, 4, team === "blue" ? 22 : 10).ok).toBe(
        true,
      );
    };
    play("blue");
    const zero = { ...battle.exportReplay(), perspective };
    const initial = createReplayPlayback(zero, 0);
    const first = replayDeckUsage(
      (initial.source ?? initial.battle).actions,
      perspective,
    );
    expect(first.viewed.total).toBe(perspective === "blue" ? 1 : 0);
    expect(first.opponent.total).toBe(perspective === "blue" ? 0 : 1);
    while (battle.tick < 30) battle.step();
    play("red");
    const replay = { ...battle.exportReplay(), perspective };
    for (const [tick, blue, red] of [
      [0, 0, 0],
      [1, 1, 0],
      [29, 1, 0],
      [30, 1, 1],
    ]) {
      const playback = createReplayPlayback(replay, tick);
      const result = replayDeckUsage(
        (playback.source ?? playback.battle).actions,
        perspective,
      );
      expect(result.viewed.total).toBe(perspective === "blue" ? blue : red);
      expect(result.opponent.total).toBe(perspective === "blue" ? red : blue);
    }
  },
);
