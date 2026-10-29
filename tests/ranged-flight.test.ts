import { describe, expect, it } from "vitest";
import golden from "./fixtures/ranged-flight-golden.json";
import {
  flightBattle,
  flightCases,
  flightKey,
  observeFlight,
} from "./helpers/ranged-flight";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { launchedKingDeadline } from "../src/game/king-damage";

describe("origin-16 projectile launch compatibility", () => {
  it("covers every ranged actor, both teams and straight/angled launches from the pre-refactor engine", () => {
    expect(golden.sourceCommit).toBe("f79e4c5");
    expect(golden.rulesFamily).toBe("origin");
    expect(golden.rulesVersion).toBe(16);
    expect(flightBattle(flightCases[0]).battle.exportReplay()).toMatchObject({
      rulesFamily: "origin",
      version: 16,
    });
    expect(golden.cases.map((c) => c.key)).toEqual(flightCases.map(flightKey));
  });
  for (const c of flightCases)
    it(`preserves the launch packet and first impact: ${flightKey(c)}`, () => {
      const observed = observeFlight(c);
      expect(JSON.parse(JSON.stringify(observed))).toEqual(
        golden.cases.find((entry) => entry.key === flightKey(c)),
      );
      const { battle, target } = flightBattle(c);
      const predicted = fatalKingWindups(
        target.team,
        battle.entities,
        battle.areas,
      );
      expect(predicted).toHaveLength(1);
      expect(predicted[0].step).toBe(observed.hitTick);
      if (observed.hitTick > observed.releaseTick) {
        for (let tick = 0; tick < observed.releaseTick; tick++) battle.step();
        expect(
          launchedKingDeadline(
            target.team,
            battle.entities,
            battle.projectiles,
            battle.areas,
          ),
        ).toBe(observed.hitTick - observed.releaseTick);
      }
    });
});
