import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { createReplayPlayback } from "../src/replay-playback";
import { buildReplayPlays, adjacentReplayPlay } from "../src/ui/replay-plays";

const deck: CardId[] = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini-pekka",
  "fireball",
  "arrows",
  "bomber",
];
function recording(family: "origin" | "local" = "origin") {
  const initial = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
  const battle = new Battle({
    replay: {
      ...initial.exportReplay(),
      rulesFamily: family,
      version: family === "local" ? 5 : 56,
    },
  });
  const play = (team: Team) => {
    const slot = battle.players[team].hand
      .map((id, i) => ({ id, i }))
      .filter(
        ({ id }) =>
          CARD_MAP[id].kind === "troop" &&
          CARD_MAP[id].cost <= battle.players[team].elixir,
      )
      .sort((a, b) => CARD_MAP[a.id].cost - CARD_MAP[b.id].cost)[0]?.i;
    if (slot === undefined) throw new Error("No affordable troop");
    expect(
      battle.play(
        team,
        slot,
        team === "blue" ? 4 : 14,
        team === "blue" ? 22 : 10,
      ).ok,
    ).toBe(true);
  };
  play("blue");
  play("red");
  while (battle.tick < 180) battle.step();
  play("blue");
  while (battle.tick < 240) battle.step();
  play("red");
  return battle.exportReplay();
}

it("groups simultaneous card plays in recorded order without changing the recording", () => {
  const replay = recording();
  const before = JSON.stringify(replay);
  replay.actions.forEach(Object.freeze);
  Object.freeze(replay.actions);
  Object.freeze(replay);
  const plays = buildReplayPlays(replay);
  expect(plays.map((p) => [p.tick, p.targetTick])).toEqual([
    [0, 1],
    [180, 181],
    [240, 240],
  ]);
  expect(plays[0].label).toBe(
    `0:00 · Player: ${CARD_MAP[replay.actions[0].card].name} · Opponent: ${CARD_MAP[replay.actions[1].card].name}`,
  );
  expect(plays[1].label).toMatch(/^0:06 · Player:/);
  expect(plays[2].label).toMatch(/^0:08 · Opponent:/);
  expect(JSON.stringify(replay)).toBe(before);
});

it("labels the recorded player correctly in shared red-side playback", () => {
  const replay = { ...recording(), perspective: "red" as const },
    plays = buildReplayPlays(replay);
  expect(plays[0].label).toBe(
    `0:00 · Opponent: ${CARD_MAP[replay.actions[0].card].name} · Player: ${CARD_MAP[replay.actions[1].card].name}`,
  );
  expect(plays[1].label).toMatch(/Opponent:/);
  expect(plays[2].label).toMatch(/Player:/);
});

it("lands after each accepted play while keeping the actual recorded endpoint", () => {
  for (const family of ["origin", "local"] as const)
    for (const perspective of ["blue", "red"] as const) {
      const replay = { ...recording(family), perspective };
      for (const play of buildReplayPlays(replay)) {
        const playback = createReplayPlayback(replay, play.targetTick),
          canonical = playback.source ?? playback.battle;
        expect(canonical.exportReplay().actions).toEqual(
          replay.actions.filter((a) => a.tick <= play.tick),
        );
        expect(canonical.tick).toBe(play.targetTick);
        expect(playback.battle.tick).toBe(play.targetTick);
      }
    }
});

it("keeps a final-tick play visible in a zero-duration recording", () => {
  const battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
  const slot = battle.players.blue.hand.findIndex(
    (id) => CARD_MAP[id].kind === "troop" && CARD_MAP[id].cost <= 5,
  );
  expect(battle.play("blue", slot, 4, 22).ok).toBe(true);
  const replay = battle.exportReplay(),
    plays = buildReplayPlays(replay);
  expect(plays).toHaveLength(1);
  expect(plays[0]).toMatchObject({ tick: 0, targetTick: 0 });
  const rebuilt = createReplayPlayback(replay, plays[0].targetTick).battle;
  expect(rebuilt.tick).toBe(0);
  expect(rebuilt.players.blue.hand).toEqual(battle.players.blue.hand);
  expect(rebuilt.players.blue.elixir).toBe(battle.players.blue.elixir);
  expect(rebuilt.exportReplay().actions).toEqual(replay.actions);
});

it("handles empty recordings and strictly navigates distinct displayed positions", () => {
  const replay = recording(),
    empty = { ...replay, actions: [] };
  expect(buildReplayPlays(empty)).toEqual([]);
  expect(adjacentReplayPlay([], 0, 1)).toBeUndefined();
  const plays = buildReplayPlays(replay);
  expect(adjacentReplayPlay(plays, 0, -1)).toBeUndefined();
  expect(adjacentReplayPlay(plays, 0, 1)).toBe(plays[0]);
  expect(adjacentReplayPlay(plays, 1, 1)).toBe(plays[1]);
  expect(adjacentReplayPlay(plays, 180, -1)).toBe(plays[0]);
  expect(adjacentReplayPlay(plays, 181, -1)).toBe(plays[0]);
  expect(adjacentReplayPlay(plays, 200, -1)).toBe(plays[1]);
  expect(adjacentReplayPlay(plays, 200, 1)).toBe(plays[2]);
  expect(adjacentReplayPlay(plays, 240, 1)).toBeUndefined();
});

it("handles two final groups that share the recording endpoint and an unflushed slider target", () => {
  const base = recording();
  const replay: Replay = {
    ...base,
    actions: [
      ...base.actions.slice(0, 2),
      { ...base.actions[2], tick: 239 },
      { ...base.actions[3], tick: 240 },
    ],
  };
  const plays = buildReplayPlays(replay);
  expect(plays.map((p) => p.targetTick)).toEqual([1, 240, 240]);
  expect(adjacentReplayPlay(plays, 200, 1)).toBe(plays[1]);
  expect(adjacentReplayPlay(plays, 240, -1)).toBe(plays[0]);
  expect(adjacentReplayPlay(plays, 239.5, 1)).toBe(plays[1]);
  expect(adjacentReplayPlay(plays, 239.5, -1)).toBe(plays[0]);
  const rebuilt = createReplayPlayback(replay, plays[1].targetTick).battle;
  expect(rebuilt.tick).toBe(240);
  expect(rebuilt.exportReplay().actions).toEqual(replay.actions);
});
