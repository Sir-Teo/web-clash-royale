import { expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { CARDS } from "../src/game/cards";
import { placementTerritory } from "../src/render/placement-territory";

for (const opened of [[], ["left"], ["left", "right"]])
  it(`placement shading agrees with actual territory for every card with ${opened.length} opened lanes`, () => {
    const battle = new Battle({ seed: 1, ai: false });
    for (const entity of battle.entities)
      if (
        entity.team === "red" &&
        entity.kind === "tower" &&
        !entity.king &&
        opened.includes(entity.lane!)
      )
        entity.hp = 0;
    for (const card of CARDS) {
      if (card.id === "mirror") continue;
      battle.players.blue.lastPlayed = card.id;
      for (const [lane, x] of [1, 17].entries()) {
        const territory = placementTerritory(
          card.id,
          !opened.includes(lane === 0 ? "left" : "right"),
        );
        for (const y of [
          1, 11.49, 11.5, 14.2, 14.5, 14.51, 16, 17.49, 17.5, 17.79, 17.8, 24,
          31,
        ]) {
          const shaded =
            y < territory.blockedUntil ||
            (territory.river && y > 14.5 && y < 17.5);
          expect(
            battle.canPlace("blue", card.id, x, y).ok,
            `${card.id} at ${x}, ${y}`,
          ).toBe(!shaded);
          // Mirror resolves to the repeated card before the preview is drawn.
          expect(
            battle.canPlace("blue", "mirror", x, y).ok,
            `Mirror ${card.id} at ${x}, ${y}`,
          ).toBe(!shaded);
        }
      }
    }
  });

it("no selected card leaves no territory overlay", () => {
  expect(placementTerritory(null, true)).toEqual({
    blockedUntil: 0,
    river: false,
  });
});
