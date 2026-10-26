import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nativeFormationOffset,
  nativeCardFormation,
} from "../src/game/native-formation";
import { CARD_MAP, type CardId } from "../src/game/cards";
import golden from "./fixtures/native-formation-golden.json";
import manifest from "../reference/client/formation-manifest.json";
import data from "../src/game/formation-data.json";

describe("native formation geometry", () => {
  it("pins the bounded CPU capture, source rows, aliases and integer sine table", () => {
    expect(golden.sha256).toBe(
      "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
    );
    expect(golden.emulator).toBe("unicorn 2.1.4");
    expect(golden.cases).toHaveLength(48);
    for (const entry of [...manifest.inputs, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
      ).toBe(entry.sha256);
    expect(data.sineTable).toHaveLength(91);
    for (const [id, definition] of Object.entries(data.cards))
      expect(CARD_MAP[id as CardId].count, id).toBe(definition.count);
  });
  it.each(golden.cases)("reproduces bounded native CPU geometry %#", (row) => {
    expect(
      Array.from({ length: row.count }, (_, index) => {
        const p = nativeFormationOffset(
          index,
          row.count,
          row.radius,
          row.angleShift,
          row.flipY,
          row.lane as 0 | 1,
        );
        return [p.x, p.y];
      }),
    ).toEqual(row.points);
  });
  it("keeps mixed and large groups outside the adopted card formations", () => {
    expect(nativeCardFormation("goblin-gang")).toBeUndefined();
    expect(nativeCardFormation("skeleton-army")).toBeUndefined();
    expect(nativeCardFormation("archers")).toMatchObject({
      radius: 500,
      count: 2,
    });
    expect(nativeCardFormation("three-musketeers")).toMatchObject({
      radius: 800,
      count: 3,
    });
    expect(nativeCardFormation("fire-spirits")).toMatchObject({
      radius: 650,
      count: 3,
    });
  });
});
