import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARDS } from "../src/game/cards";

const portraits = JSON.parse(
  readFileSync("public/assets/ui/cards/cards.json", "utf8"),
).portraits as Record<string, { table: string; row: string }>;

describe("archived 1.8.1 card roster", () => {
  it("maps every archived playable card row to a native portrait", () => {
    const tables = ["spells_characters", "spells_buildings", "spells_other"];
    const source = tables.flatMap((table) =>
      csvRows(readFileSync(`reference/logic/${table}.csv`, "utf8"))
        .filter((row) => row.Name && !row.Name.startsWith("NotInUse"))
        .map((row) => `${table}:${row.Name}`),
    ).sort();
    expect(source).toHaveLength(74);
    expect(new Set(source).size).toBe(source.length);
    expect(CARDS).toHaveLength(74);
    const imported = CARDS.map((card) => {
      const portrait = portraits[card.id];
      expect(portrait, `Missing native portrait for ${card.id}`).toBeDefined();
      return `${portrait.table}:${portrait.row}`;
    }).sort();
    expect(imported).toEqual(source);
    expect(new Set(CARDS.map((card) => card.id)).size).toBe(CARDS.length);
  });
});
