import { describe, expect, it } from "vitest";
import { CARDS } from "../src/game/cards";
import { collectionCards } from "../src/ui/card-collection";

const ids = (query: Parameters<typeof collectionCards>[0]) =>
  collectionCards(query).map((card) => card.id);

describe("card collection browsing", () => {
  it.each([
    ["pekka", ["mini-pekka", "pekka"]],
    ["  Mini   Pekka  ", ["mini-pekka"]],
    ["P.E.K.K.A", ["mini-pekka", "pekka"]],
    ["three-musketeers", ["three-musketeers"]],
    ["BÁBY DRÁGON", ["baby-dragon"]],
  ])("finds cards using the plain name %s", (search, expected) => {
    expect(ids({ search: search as string })).toEqual(expected);
  });
  it("combines type, cost and name instead of broadening another filter", () => {
    expect(ids({ kind: "spell", cost: 4 })).toEqual([
      "fireball",
      "freeze",
      "poison",
    ]);
    expect(ids({ kind: "spell", cost: 4, search: "fire" })).toEqual([
      "fireball",
    ]);
    expect(ids({ kind: "troop", cost: 4, search: "fire" })).toEqual([]);
    expect(ids({ kind: "building", cost: 9 })).toEqual([]);
  });
  it("sorts equal-cost cards by name in both elixir directions", () => {
    const names = CARDS.filter(
      (card) => card.kind === "troop" && card.cost === 4,
    )
      .map((card) => card.name)
      .sort((a, b) => a.localeCompare(b));
    for (const order of ["cost-asc", "cost-desc"] as const)
      expect(
        collectionCards({ kind: "troop", cost: 4, order }).map((c) => c.name),
      ).toEqual(names);
  });
  it("orders the whole collection by increasing and decreasing elixir", () => {
    for (const order of ["cost-asc", "cost-desc"] as const) {
      const cards = collectionCards({ order });
      expect(cards).toHaveLength(CARDS.length);
      expect(new Set(cards.map((c) => c.id)).size).toBe(CARDS.length);
      for (let i = 1; i < cards.length; i++)
        expect(
          (cards[i].cost - cards[i - 1].cost) * (order === "cost-asc" ? 1 : -1),
        ).toBeGreaterThanOrEqual(0);
      expect(cards[0].id).toBe(
        order === "cost-asc" ? "ice-spirit" : "three-musketeers",
      );
    }
  });
  it("sorts by name and leaves the source roster and default order intact", () => {
    const original = structuredClone(CARDS);
    expect(collectionCards({ order: "name" })[0].name).toBe("Archers");
    expect(collectionCards({ order: "name" }).at(-1)!.name).toBe("Zap");
    collectionCards({ order: "cost-desc" });
    collectionCards({ order: "rarity" });
    collectionCards({ order: "rarity-desc" });
    expect(CARDS).toEqual(original);
    const defaults = collectionCards();
    expect(defaults).toEqual(CARDS);
    expect(defaults).not.toBe(CARDS);
  });
  it("groups rarities before elixir while retaining name ties", () => {
    expect(ids({ search: "goblin", order: "rarity" })).toEqual([
      "goblins",
      "spear-goblins",
      "goblin-gang",
      "dart-goblin",
      "goblin-hut",
      "goblin-barrel",
    ]);
  });
  it("combines rarity ordering with cost and kind filters", () => {
    expect(ids({ kind: "spell", cost: 3, order: "rarity" })).toEqual([
      "arrows",
      "heal",
      "clone",
      "goblin-barrel",
      "tornado",
    ]);
  });
  it("puts higher rarities first while keeping elixir and name order within each tier", () => {
    expect(ids({ search: "goblin", order: "rarity-desc" })).toEqual([
      "goblin-barrel",
      "dart-goblin",
      "goblin-hut",
      "goblins",
      "spear-goblins",
      "goblin-gang",
    ]);
  });
  it("combines reversed rarity groups with spell and exact-cost filters", () => {
    expect(ids({ kind: "spell", cost: 3, order: "rarity-desc" })).toEqual([
      "clone",
      "goblin-barrel",
      "tornado",
      "heal",
      "arrows",
    ]);
  });
  it("treats whitespace as an empty search and retains every eligible card", () => {
    expect(ids({ search: " \t\n ", kind: "building" })).toEqual(
      CARDS.filter((card) => card.kind === "building").map((card) => card.id),
    );
  });
});
