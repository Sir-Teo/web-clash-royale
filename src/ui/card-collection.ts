import { CARDS } from "../game/cards";
import type { Card } from "../game/cards";

export type CollectionOrder =
  "collection" | "cost-asc" | "cost-desc" | "name" | "rarity" | "rarity-desc";
export type CollectionKind = Card["kind"] | "all";
export interface CollectionQuery {
  search: string;
  kind: CollectionKind;
  cost: number | "all";
  order: CollectionOrder;
}

// Treat plain-name typing and the punctuation on native card names alike.
const searchable = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const byName = (a: Card, b: Card) =>
  a.name.localeCompare(b.name, "en", {
    sensitivity: "base",
    ignorePunctuation: true,
  });
const rarityRank: Record<Card["rarity"], number> = {
  Common: 0,
  Rare: 1,
  Epic: 2,
  Legendary: 3,
};

export function collectionCards({
  search = "",
  kind = "all",
  cost = "all",
  order = "collection",
}: Partial<CollectionQuery> = {}): Card[] {
  const query = searchable(search);
  const matches = CARDS.filter(
    (card) =>
      (kind === "all" || card.kind === kind) &&
      (cost === "all" || card.cost === cost) &&
      searchable(card.name).includes(query),
  );
  if (order === "name") return matches.sort(byName);
  if (order === "rarity" || order === "rarity-desc")
    return matches.sort(
      (a, b) =>
        (rarityRank[a.rarity] - rarityRank[b.rarity]) *
          (order === "rarity" ? 1 : -1) ||
        a.cost - b.cost ||
        byName(a, b),
    );
  if (order === "cost-asc" || order === "cost-desc")
    matches.sort(
      (a, b) =>
        (order === "cost-asc" ? a.cost - b.cost : b.cost - a.cost) ||
        byName(a, b),
    );
  return matches;
}
