import { expect, it } from "vitest";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { practiceOpponents } from "../src/ui/practice-opponents";

it("retains every opponent's identity and order without a search", () => {
  for (const query of ["", "  ", " · "])
    expect(practiceOpponents(query)).toEqual(
      SOLO_OPPONENTS.map((opponent, index) => ({ opponent, index })),
    );
});

it.each([
  ["Spark Commander", [16]],
  ["HUT REINFORCEMENTS", [14]],
  ["sparky", [16]],
  ["P.E.K.K.A", [0, 4, 5]],
  ["pekka", [0, 4, 5]],
  ["X-bow", [9]],
  ["  SÍEGE    X-BOW  ", [9]],
  ["golem night witch", [8]],
  ["sparky zap", [16]],
  ["sparky graveyard", []],
  ["not a real card", []],
  ["法师", []],
])("finds names, styles and starting cards for %s", (query, indexes) => {
  const matches = practiceOpponents(query as string);
  expect(matches.map(({ index }) => index)).toEqual(indexes);
  for (const { opponent, index } of matches)
    expect(opponent).toBe(SOLO_OPPONENTS[index]);
});
