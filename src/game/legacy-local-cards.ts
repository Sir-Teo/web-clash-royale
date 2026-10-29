// Frozen compatibility with local main 3a488e0. Change only for replay adapters.
import freeze from "./freeze-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import { rocket } from "./legacy-local-rules";
import { rage } from "./legacy-local-rules";

export type CardId =
  | "knight"
  | "archers"
  | "giant"
  | "musketeer"
  | "three-musketeers"
  | "mini-pekka"
  | "fireball"
  | "arrows"
  | "goblins"
  | "spear-goblins"
  | "skeletons"
  | "skeleton-army"
  | "bomber"
  | "valkyrie"
  | "hog-rider"
  | "baby-dragon"
  | "minions"
  | "minion-horde"
  | "witch"
  | "wizard"
  | "prince"
  | "pekka"
  | "balloon"
  | "cannon"
  | "tesla"
  | "zap"
  | "freeze"
  | "poison"
  | "rage"
  | "rocket";
export interface Card {
  id: CardId;
  name: string;
  cost: number;
  rarity: "Common" | "Rare" | "Epic";
  kind: "troop" | "spell" | "building";
  hp: number;
  damage: number;
  speed: number;
  range: number;
  interval: number;
  count: number;
  air?: boolean;
  hitsAir?: boolean;
  buildingsOnly?: boolean;
  splash?: number;
  radius?: number;
  lifetime?: number;
  stun?: number;
  description: string;
}
const troop = (
  id: CardId,
  name: string,
  cost: number,
  hp: number,
  damage: number,
  speed: number,
  range: number,
  interval: number,
  description: string,
  extra: Partial<Card> = {},
): Card => ({
  id,
  name,
  cost,
  hp,
  damage,
  speed,
  range,
  interval,
  description,
  rarity: "Common",
  kind: "troop",
  count: 1,
  ...extra,
});
// Both cards deploy the same normalized Minion unit.
const minionCard = (
  id: "minions" | "minion-horde",
  name: string,
  cost: number,
  count: number,
  description: string,
) =>
  troop(id, name, cost, 230, 102, 1.6, 1, 1, description, {
    air: true,
    hitsAir: true,
    count,
  });
// Both cards deploy the same normalized Musketeer unit.
const musketeerCard = (
  id: "musketeer" | "three-musketeers",
  name: string,
  cost: number,
  count: number,
  description: string,
) =>
  troop(id, name, cost, 720, 218, 1, 6, 1, description, {
    rarity: "Rare",
    hitsAir: true,
    count,
  });
export const CARDS: Card[] = [
  troop(
    "knight",
    "Knight",
    3,
    1666,
    202,
    1,
    0.75,
    1.2,
    "A tough melee fighter. A dependable defender with a magnificent moustache.",
  ),
  troop(
    "archers",
    "Archers",
    3,
    304,
    107,
    1,
    5,
    0.9,
    "A pair of lightly armored ranged attackers. Together, they cover the ground and the skies.",
    { count: 2, hitsAir: true },
  ),
  troop(
    "giant",
    "Giant",
    5,
    4091,
    254,
    0.65,
    0.8,
    1.5,
    "Slow but durable, he only attacks buildings. Put a ranged troop behind him.",
    { rarity: "Rare", buildingsOnly: true },
  ),
  musketeerCard(
    "musketeer",
    "Musketeer",
    4,
    1,
    "One shot, a whole lot of damage. A long-range defender against ground and air.",
  ),
  musketeerCard(
    "three-musketeers",
    "Three Musketeers",
    9,
    3,
    "Three long-range musketeers cover ground and air. A powerful formation with a steep elixir cost.",
  ),
  troop(
    "mini-pekka",
    "Mini P.E.K.K.A",
    4,
    1361,
    720,
    1.3,
    0.7,
    1.6,
    "A little suit of armor with a very big punch. Perfect for stopping tanks.",
    { rarity: "Rare" },
  ),
  troop(
    "fireball",
    "Fireball",
    4,
    0,
    689,
    0,
    0,
    1,
    "Incinerates a small area, dealing damage to troops and buildings. Reduced Crown Tower damage.",
    { kind: "spell", rarity: "Rare", radius: 2.5, hitsAir: true },
  ),
  troop(
    "arrows",
    "Arrows",
    3,
    0,
    366,
    0,
    0,
    1,
    "Pepper a large area with arrows. An excellent answer to swarms.",
    { kind: "spell", radius: 3.6, hitsAir: true },
  ),
  troop(
    "goblins",
    "Goblins",
    2,
    202,
    120,
    1.8,
    0.55,
    1.1,
    "Four speedy melee attackers. Small, mean, green and very good value.",
    { count: 4 },
  ),
  troop(
    "spear-goblins",
    "Spear Goblins",
    2,
    133,
    81,
    1.7,
    5,
    1.7,
    "Three unarmored ranged attackers. They can hit flying enemies, too.",
    { count: 3, hitsAir: true },
  ),
  troop(
    "skeletons",
    "Skeletons",
    1,
    81,
    81,
    1.3,
    0.5,
    1,
    "Three tiny distractions. Cycle your deck and pull enemies off course.",
    { count: 3 },
  ),
  troop(
    "skeleton-army",
    "Skeleton Army",
    3,
    81,
    81,
    1.3,
    0.5,
    1,
    "Fifteen skeletons overwhelm single-target attackers. Watch out for splash damage.",
    { rarity: "Epic", count: 15 },
  ),
  troop(
    "bomber",
    "Bomber",
    2,
    332,
    222,
    1,
    4.5,
    1.8,
    "A skeleton with a bomb. Deals area damage to ground troops.",
    { splash: 1.6 },
  ),
  troop(
    "valkyrie",
    "Valkyrie",
    4,
    1908,
    267,
    1,
    0.8,
    1.5,
    "A whirlwind of steel. Her spinning axe hits every ground enemy around her.",
    { rarity: "Rare", splash: 1.6 },
  ),
  troop(
    "hog-rider",
    "Hog Rider",
    4,
    1696,
    318,
    1.9,
    0.8,
    1.6,
    "Fast melee troop that targets buildings and jumps over the river. Hoooog Rider!",
    { rarity: "Rare", buildingsOnly: true },
  ),
  troop(
    "baby-dragon",
    "Baby Dragon",
    4,
    1152,
    160,
    1.3,
    3.5,
    1.5,
    "A flying baby dragon that belches splash damage. Cute, hungry, and dangerous.",
    { rarity: "Epic", air: true, hitsAir: true, splash: 1.5 },
  ),
  minionCard(
    "minions",
    "Minions",
    3,
    3,
    "Three fast, flying attackers. A great way to deal with enemies that cannot hit air.",
  ),
  minionCard(
    "minion-horde",
    "Minion Horde",
    5,
    6,
    "Six flying Minions overwhelm ground and air targets. Keep them away from splash damage and Arrows.",
  ),
  troop(
    "witch",
    "Witch",
    5,
    838,
    134,
    1,
    5.5,
    1.1,
    "Ranged splash attacks and a fresh batch of skeletons every seven seconds.",
    { rarity: "Epic", hitsAir: true, splash: 1.2 },
  ),
  troop(
    "wizard",
    "Wizard",
    5,
    720,
    281,
    1,
    5.5,
    1.4,
    "A handsome fire-thrower. His fireballs damage clusters of ground and air troops.",
    { rarity: "Rare", hitsAir: true, splash: 1.6 },
  ),
  troop(
    "prince",
    "Prince",
    5,
    1920,
    392,
    1.3,
    0.8,
    1.4,
    "Once he gets going, his charge deals double damage. Point him toward a tower.",
    { rarity: "Epic" },
  ),
  troop(
    "pekka",
    "P.E.K.K.A",
    7,
    3760,
    816,
    0.65,
    0.9,
    1.8,
    "A heavily armored, slow melee fighter. One huge hit at a time.",
    { rarity: "Epic" },
  ),
  troop(
    "balloon",
    "Balloon",
    5,
    1680,
    640,
    0.85,
    0.9,
    2,
    "Floats over the river to drop enormous bombs on buildings. Explodes when defeated.",
    { rarity: "Epic", air: true, buildingsOnly: true },
  ),
  troop(
    "cannon",
    "Cannon",
    3,
    824,
    175,
    0,
    5.5,
    0.9,
    "A defensive building with a powerful ground attack. Distracts building-targeting troops.",
    { kind: "building", lifetime: 30 },
  ),
  troop(
    "tesla",
    "Tesla",
    4,
    1152,
    230,
    0,
    5.5,
    1.2,
    "Hides underground when idle, then emerges to shock enemies on the ground and in the air.",
    { kind: "building", lifetime: 30, hitsAir: true },
  ),
  troop(
    "zap",
    "Zap",
    2,
    0,
    192,
    0,
    0,
    1,
    "A quick blast of electricity. Stuns enemies and resets their attacks.",
    { kind: "spell", radius: 2.5, hitsAir: true, stun: 0.5 },
  ),
  troop(
    "freeze",
    "Freeze",
    freeze.cost,
    0,
    0,
    0,
    0,
    1,
    "Freezes enemies in an area, stopping their movement and attacks.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: freeze.radius,
      hitsAir: freeze.hitsAir,
    },
  ),
  troop(
    "poison",
    "Poison",
    poison.cost,
    0,
    121,
    0,
    0,
    poison.damageInterval,
    "Damages enemies in its lingering cloud. Troops leaving the cloud remain poisoned briefly.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: poison.radius,
      hitsAir: poison.hitsAir,
    },
  ),
  troop(
    "rage",
    "Rage",
    rage.cost,
    0,
    0,
    0,
    0,
    1,
    "Boosts friendly movement, attacks and spawning by 35% in its area. The boost lingers briefly after leaving.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: rage.radius,
      hitsAir: rage.hitsAir,
    },
  ),
  troop(
    "rocket",
    "Rocket",
    rocket.cost,
    0,
    rocket.damage,
    0,
    0,
    1,
    "A slow, powerful blast that damages air and ground enemies. Deals 40% damage to Crown Towers.",
    { kind: "spell", rarity: "Rare", radius: rocket.radius, hitsAir: true },
  ),
];
export const CARD_MAP = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
) as Record<CardId, Card>;
export const STARTER_DECK: CardId[] = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini-pekka",
  "fireball",
  "arrows",
  "goblins",
];
