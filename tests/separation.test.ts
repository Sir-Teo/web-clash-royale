import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import {
  separationCases,
  separationScene,
  separationPositions,
} from "./fixtures/separation-scenes";
import golden from "./fixtures/separation-golden.json";

it.each(separationCases)(
  "preserves committed separation positions exactly: $name",
  (spec) => {
    expect(golden.sourceCommit).toBe("eccdaa5");
    const battle = separationScene(Battle, spec);
    const original = JSON.stringify(
      battle.entities.map(({ x, y, ...rest }) => rest),
    );
    const expected = golden.cases.find((row) => row.name === spec.name)!;
    let step = 0;
    for (const checkpoint of expected.checkpoints) {
      while (step < checkpoint.step) {
        (battle as any).separate();
        step++;
      }
      expect(
        createHash("sha256")
          .update(JSON.stringify(separationPositions(battle.entities)))
          .digest("hex"),
        `step ${step}`,
      ).toBe(checkpoint.digest);
      expect(
        JSON.stringify(battle.entities.map(({ x, y, ...rest }) => rest)),
      ).toBe(original);
    }
  },
);
