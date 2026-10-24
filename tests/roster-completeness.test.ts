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

  it("keeps every card's archived cost, rarity and basic type", () => {
    const source = Object.fromEntries(
      ["spells_characters", "spells_buildings", "spells_other"].map((table) => [
        table,
        Object.fromEntries(csvRows(readFileSync(`reference/logic/${table}.csv`, "utf8"))
          .filter((row) => row.Name)
          .map((row) => [row.Name, row])),
      ]),
    );
    const mismatches: string[] = [];
    for (const card of CARDS) {
      const { table, row } = portraits[card.id];
      const archived = source[table][row];
      for (const [field, actual, expected] of [
        ["cost", card.cost, Number(archived.ManaCost)],
        ["rarity", card.rarity, archived.Rarity],
        ["type", card.kind, {
        spells_characters: "troop",
        spells_buildings: "building",
        spells_other: "spell",
        }[table]],
      ] as const)
        if (actual !== expected)
          mismatches.push(`${card.id} ${field}: ${actual} vs source ${expected}`);
      if (table === "spells_other" && archived.Radius)
        if (card.radius !== Number(archived.Radius) / 1000)
          mismatches.push(`${card.id} radius: ${card.radius} vs source ${Number(archived.Radius) / 1000}`);
      if (table === "spells_characters" && archived.SummonNumber)
        if (card.count !== Number(archived.SummonNumber))
          mismatches.push(`${card.id} count: ${card.count} vs source ${archived.SummonNumber}`);
    }
    expect(mismatches).toEqual([]);
  });
});
