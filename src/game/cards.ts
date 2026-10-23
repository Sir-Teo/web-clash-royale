import freeze from "./freeze-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import rage from "./rage-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import lightning from "./lightning-data.json" with { type: "json" };
import log from "./log-data.json" with { type: "json" };
import tornado from "./tornado-data.json" with { type: "json" };
import goblinBarrel from "./goblin-barrel-data.json" with { type: "json" };
import graveyard from "./graveyard-data.json" with { type: "json" };
import clone from "./clone-data.json" with { type: "json" };
import mirror from "./mirror-data.json" with { type: "json" };
import swarms from "./swarm-cards-data.json" with { type: "json" };
import goblinGang from "./goblin-gang-data.json" with { type: "json" };
import barbarians from "./barbarians-data.json" with { type: "json" };
import eliteBarbarians from "./elite-barbarians-data.json" with { type: "json" };
import iceSpirit from "./ice-spirit-data.json" with { type: "json" };
import fireSpirits from "./fire-spirits-data.json" with { type: "json" };
import royalGiant from "./royal-giant-data.json" with { type: "json" };
import megaMinion from "./mega-minion-data.json" with { type: "json" };
import dartGoblin from "./dart-goblin-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import princess from "./princess-data.json" with { type: "json" };
import infernoDragon from "./inferno-dragon-data.json" with { type: "json" };
import electroWizard from "./electro-wizard-data.json" with { type: "json" };
import miner from "./miner-data.json" with { type: "json" };
import bowler from "./bowler-data.json" with { type: "json" };
import darkPrince from "./dark-prince-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };
import executioner from "./executioner-data.json" with { type: "json" };
import sparky from "./sparky-data.json" with { type: "json" };
import lumberjack from "./lumberjack-data.json" with { type: "json" };
import bats from "./bats-data.json" with { type: "json" };
import nightWitch from "./night-witch-data.json" with { type: "json" };
import bandit from "./bandit-data.json" with { type: "json" };
import golem from "./golem-data.json" with { type: "json" };
import lavaHound from "./lava-hound-data.json" with { type: "json" };

export type CardId =
  | "knight"
  | "barbarians"
  | "elite-barbarians"
  | "ice-spirit"
  | "fire-spirits"
  | "archers"
  | "giant"
  | "royal-giant"
  | "musketeer"
  | "three-musketeers"
  | "mini-pekka"
  | "fireball"
  | "arrows"
  | "goblins"
  | "goblin-gang"
  | "spear-goblins"
  | "dart-goblin"
  | "ice-wizard"
  | "princess"
  | "inferno-dragon"
  | "electro-wizard"
  | "miner"
  | "bowler"
  | "dark-prince"
  | "battle-ram"
  | "executioner"
  | "sparky"
  | "lumberjack"
  | "skeletons"
  | "skeleton-army"
  | "bomber"
  | "valkyrie"
  | "hog-rider"
  | "baby-dragon"
  | "minions"
  | "bats"
  | "night-witch"
  | "bandit"
  | "golem"
  | "golemite"
  | "lava-hound"
  | "lava-pup"
  | "mega-minion"
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
  | "rocket"
  | "lightning"
  | "log"
  | "tornado"
  | "goblin-barrel"
  | "graveyard"
  | "clone"
  | "mirror";
export interface Card {
  id: CardId;
  name: string;
  cost: number;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
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
    "barbarians",
    "Barbarians",
    barbarians.cost,
    // Match this roster's level-11 Common Knight normalization of the
    // archived level-one hitpoints and damage.
    Math.round((barbarians.sourceHitpoints * 1666) / 660),
    Math.round((barbarians.sourceDamage * 202) / 75),
    barbarians.sourceSpeed / 60,
    barbarians.sourceRange / 1000,
    barbarians.sourceHitSpeed / 1000,
    "Four sturdy melee fighters charge into battle together.",
    { count: barbarians.count },
  ),
  troop(
    "elite-barbarians",
    "Elite Barbarians",
    eliteBarbarians.cost,
    Math.round((eliteBarbarians.sourceHitpoints * 1666) / 660),
    Math.round((eliteBarbarians.sourceDamage * 202) / 75),
    eliteBarbarians.sourceSpeed / 60,
    eliteBarbarians.sourceRange,
    eliteBarbarians.sourceHitSpeed,
    "Two swift elite fighters charge into battle together.",
    { count: eliteBarbarians.count },
  ),
  troop(
    "ice-spirit",
    "Ice Spirit",
    iceSpirit.cost,
    Math.round((iceSpirit.sourceHitpoints * 1666) / 660),
    Math.round((iceSpirit.sourceProjectileDamage * 202) / 75),
    iceSpirit.sourceSpeed / 60,
    iceSpirit.sourceRange,
    iceSpirit.sourceHitSpeed,
    "A tiny one-use attacker that freezes ground and air enemies in a splash.",
    { hitsAir: true, splash: iceSpirit.splashRadius },
  ),
  troop(
    "fire-spirits",
    "Fire Spirits",
    fireSpirits.cost,
    Math.round((fireSpirits.sourceHitpoints * 1666) / 660),
    Math.round((fireSpirits.sourceProjectileDamage * 202) / 75),
    fireSpirits.sourceSpeed / 60,
    fireSpirits.sourceRange,
    fireSpirits.sourceHitSpeed,
    "Three one-use attackers throw fiery splash projectiles at ground and air enemies.",
    { count: fireSpirits.count, hitsAir: true, splash: fireSpirits.splashRadius },
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
  troop(
    "golem",
    "Golem",
    golem.cost,
    Math.round(golem.golem.sourceHitpoints * 1.1 ** 5),
    Math.round(golem.golem.sourceDamage * 1.1 ** 5),
    golem.golem.sourceSpeed / 60,
    golem.golem.sourceRange,
    golem.golem.sourceHitSpeed,
    "A towering building hunter that explodes and splits into two Golemites.",
    { rarity: "Epic", buildingsOnly: true },
  ),
  troop(
    "lava-hound",
    "Lava Hound",
    lavaHound.cost,
    Math.round(lavaHound.hound.sourceHitpoints * 1.1 ** 2),
    Math.round(lavaHound.hound.sourceDamage * 1.1 ** 2),
    lavaHound.hound.sourceSpeed / 60,
    lavaHound.hound.sourceRange,
    lavaHound.hound.sourceHitSpeed,
    "A flying building hunter that splits into six Lava Pups when defeated.",
    { rarity: "Legendary", air: true, hitsAir: true, buildingsOnly: true },
  ),
  troop(
    "royal-giant",
    "Royal Giant",
    royalGiant.cost,
    // Normalize archival level-one values against this roster's Common Knight.
    Math.round((royalGiant.sourceHitpoints * 1666) / 660),
    Math.round((royalGiant.sourceDamage * 202) / 75),
    royalGiant.sourceSpeed / 60,
    royalGiant.sourceRange / 1000,
    royalGiant.sourceHitSpeed / 1000,
    "A cannon-toting giant who fires from afar and targets buildings.",
    { buildingsOnly: royalGiant.buildingsOnly },
  ),
  troop(
    "musketeer",
    "Musketeer",
    4,
    720,
    218,
    1,
    6,
    1,
    "One shot, a whole lot of damage. A long-range defender against ground and air.",
    { rarity: "Rare", hitsAir: true },
  ),
  troop(
    "three-musketeers",
    "Three Musketeers",
    swarms.ThreeMusketeers.cost,
    720,
    218,
    1,
    6,
    1,
    "Three long-range Musketeers enter together. Split their deployment across lanes.",
    { rarity: "Rare", hitsAir: true, count: swarms.ThreeMusketeers.count },
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
    "rocket",
    "Rocket",
    rocket.cost,
    0,
    // Normalize archived spell damage through the same level-11 Fireball
    // ratio used by this curated roster (source 325 -> playable 689).
    Math.round((rocket.sourceDamage * 689) / 325),
    0,
    0,
    1,
    "A powerful, slow projectile that blasts a tight area and knocks enemies back.",
    {
      kind: "spell",
      rarity: "Rare",
      radius: rocket.radius,
      hitsAir: rocket.hitsAir,
    },
  ),
  troop(
    "lightning",
    "Lightning",
    lightning.cost,
    0,
    // Match the curated level-11 Fireball ratio (source 325 -> 689).
    Math.round((lightning.sourceDamage * 689) / 325),
    0,
    0,
    1,
    "Three bolts strike the strongest enemies in an area and briefly stun survivors.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: lightning.radius,
      hitsAir: lightning.hitsAir,
    },
  ),
  troop(
    "log",
    "The Log",
    log.cost,
    0,
    Math.round((log.sourceDamage * 689) / 325),
    0,
    0,
    1,
    "Rolls through ground enemies, knocking them back as it goes.",
    { kind: "spell", rarity: "Legendary", radius: log.collisionRadius },
  ),
  troop(
    "tornado",
    "Tornado",
    tornado.cost,
    0,
    Math.round((tornado.damagePerSecond * tornado.damageInterval * 689) / 325),
    0,
    0,
    tornado.damageInterval,
    "Pulls enemy troops toward its center and deals damage over time.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: tornado.radius,
      hitsAir: tornado.hitsAir,
    },
  ),
  troop(
    "goblin-barrel",
    "Goblin Barrel",
    goblinBarrel.cost,
    0,
    0,
    0,
    0,
    1,
    "Flings a barrel across the arena, releasing three Goblins where it lands.",
    { kind: "spell", rarity: "Epic", radius: goblinBarrel.landingRadius },
  ),
  troop(
    "graveyard",
    "Graveyard",
    graveyard.cost,
    0,
    0,
    0,
    0,
    1,
    "Summons Skeletons over time in a large area anywhere in the arena.",
    { kind: "spell", rarity: "Legendary", radius: graveyard.radius },
  ),
  troop(
    "clone",
    "Clone",
    clone.cost,
    0,
    0,
    0,
    0,
    1,
    "Duplicates friendly troops in an area. The copies have one hitpoint.",
    { kind: "spell", rarity: "Epic", radius: clone.radius },
  ),
  troop(
    "mirror",
    "Mirror",
    mirror.surcharge,
    0,
    0,
    0,
    0,
    1,
    "Repeats your last played card for one extra elixir.",
    { kind: "spell", rarity: "Epic" },
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
    "goblin-gang",
    "Goblin Gang",
    goblinGang.cost,
    202,
    120,
    1.8,
    0.55,
    1.1,
    "Three melee Goblins lead three Spear Goblins into battle.",
    { count: goblinGang.count, radius: goblinGang.radius },
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
    "dart-goblin",
    "Dart Goblin",
    dartGoblin.cost,
    // Match this roster's level-11 Rare Musketeer normalization.
    Math.round((dartGoblin.sourceHitpoints * 720) / 340),
    Math.round((dartGoblin.sourceDamage * 218) / 100),
    dartGoblin.sourceSpeed / 60,
    dartGoblin.sourceRange / 1000,
    dartGoblin.sourceHitSpeed / 1000,
    "A fast-moving Goblin who fires darts at ground and air targets.",
    { rarity: "Rare", hitsAir: dartGoblin.hitsAir },
  ),
  troop(
    "ice-wizard",
    "Ice Wizard",
    iceWizard.cost,
    // Archived Legendary level one maps to collection level nine. Two
    // approximate 10% upgrades bring its baseline to the level-11 roster.
    Math.round(iceWizard.sourceHitpoints * 1.1 ** 2),
    Math.round(iceWizard.sourceDamage * 1.1 ** 2),
    iceWizard.sourceSpeed / 60,
    iceWizard.sourceRange / 1000,
    iceWizard.sourceHitSpeed / 1000,
    "An icy mage whose splash attacks slow troops and towers for two seconds.",
    {
      rarity: "Legendary",
      hitsAir: iceWizard.hitsAir,
      splash: iceWizard.projectileRadius,
    },
  ),
  troop(
    "princess",
    "Princess",
    princess.cost,
    Math.round(princess.sourceHitpoints * 1.1 ** 2),
    Math.round(princess.sourceDamage * 1.1 ** 2),
    princess.sourceSpeed / 60,
    princess.sourceRange / 1000,
    princess.sourceHitSpeed / 1000,
    "A long-range archer whose flaming volley splashes ground and air targets.",
    { rarity: "Legendary", hitsAir: princess.hitsAir, splash: princess.splash },
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
  troop(
    "minions",
    "Minions",
    3,
    230,
    102,
    1.6,
    1,
    1,
    "Three fast, flying attackers. A great way to deal with enemies that cannot hit air.",
    { air: true, hitsAir: true, count: 3 },
  ),
  troop(
    "bats",
    "Bats",
    bats.cost,
    Math.round(bats.sourceHitpoints * 1.1 ** 10),
    Math.round(bats.sourceDamage * 1.1 ** 10),
    bats.sourceSpeed / 60,
    bats.sourceRange,
    bats.sourceHitSpeed,
    "Five fast flying Bats that can attack ground and air.",
    { air: true, hitsAir: true, count: bats.count, radius: bats.summonRadius },
  ),
  troop(
    "night-witch",
    "Night Witch",
    nightWitch.cost,
    Math.round(nightWitch.sourceHitpoints * 1.1 ** 2),
    Math.round(nightWitch.sourceDamage * 1.1 ** 2),
    nightWitch.sourceSpeed / 60,
    nightWitch.sourceRange,
    nightWitch.sourceHitSpeed,
    "Summons Bats while alive and releases four more when defeated.",
    { rarity: "Legendary", hitsAir: nightWitch.hitsAir },
  ),
  troop(
    "bandit",
    "Bandit",
    bandit.cost,
    Math.round(bandit.sourceHitpoints * 1.1 ** 2),
    Math.round(bandit.sourceDamage * 1.1 ** 2),
    bandit.sourceSpeed / 60,
    bandit.sourceRange,
    bandit.sourceHitSpeed,
    "Dashes to distant targets for a heavy hit and cannot be touched mid-dash.",
    { rarity: "Legendary", hitsAir: bandit.hitsAir },
  ),
  troop(
    "mega-minion",
    "Mega Minion",
    megaMinion.cost,
    // Match this roster's level-11 Rare Musketeer normalization.
    Math.round((megaMinion.sourceHitpoints * 720) / 340),
    Math.round((megaMinion.sourceDamage * 218) / 100),
    megaMinion.sourceSpeed / 60,
    megaMinion.sourceRange / 1000,
    megaMinion.sourceHitSpeed / 1000,
    "An armored flying Minion that attacks ground and air targets.",
    { rarity: "Rare", air: true, hitsAir: megaMinion.hitsAir },
  ),
  troop(
    "inferno-dragon",
    "Inferno Dragon",
    infernoDragon.cost,
    Math.round(infernoDragon.sourceHitpoints * 1.1 ** 2),
    Math.round(infernoDragon.sourceDamage[0] * 1.1 ** 2),
    infernoDragon.sourceSpeed / 60,
    infernoDragon.sourceRange / 1000,
    infernoDragon.sourceHitSpeed / 1000,
    "A flying dragon whose focused beam grows stronger the longer it stays locked on.",
    { rarity: "Legendary", air: true, hitsAir: infernoDragon.hitsAir },
  ),
  troop(
    "electro-wizard",
    "Electro Wizard",
    electroWizard.cost,
    Math.round(electroWizard.sourceHitpoints * 1.1 ** 2),
    Math.round(electroWizard.sourceDamage * 1.1 ** 2),
    electroWizard.sourceSpeed / 60,
    electroWizard.sourceRange / 1000,
    electroWizard.sourceHitSpeed / 1000,
    "Strikes two targets, stuns them briefly, and Zaps enemies when he arrives.",
    { rarity: "Legendary", hitsAir: electroWizard.hitsAir },
  ),
  troop(
    "miner",
    "Miner",
    miner.cost,
    Math.round(miner.sourceHitpoints * 1.1 ** 2),
    Math.round(miner.sourceDamage * 1.1 ** 2),
    miner.sourceSpeed / 60,
    miner.sourceRange / 1000,
    miner.sourceHitSpeed / 1000,
    "Tunnels beneath the arena and emerges anywhere to attack ground targets.",
    { rarity: "Legendary" },
  ),
  troop(
    "bowler",
    "Bowler",
    bowler.cost,
    Math.round(bowler.sourceHitpoints * 1.1 ** 5),
    Math.round(bowler.projectile.damage * 1.1 ** 5),
    bowler.sourceSpeed / 60,
    bowler.sourceRange / 1000,
    bowler.sourceHitSpeed / 1000,
    "Rolls a huge boulder through ground troops, damaging and pushing them back.",
    { rarity: "Epic" },
  ),
  troop(
    "dark-prince",
    "Dark Prince",
    darkPrince.cost,
    Math.round(darkPrince.sourceHitpoints * 1.1 ** 5),
    Math.round(darkPrince.sourceDamage * 1.1 ** 5),
    darkPrince.sourceSpeed / 60,
    darkPrince.sourceRange / 1000,
    darkPrince.sourceHitSpeed / 1000,
    "Charges into ground troops with a shield and a sweeping mace attack.",
    { rarity: "Epic", splash: darkPrince.splash },
  ),
  troop(
    "battle-ram",
    "Battle Ram",
    battleRam.cost,
    Math.round((battleRam.sourceHitpoints * 720) / 340),
    Math.round((battleRam.sourceDamage * 218) / 100),
    battleRam.sourceSpeed / 60,
    battleRam.sourceRange / 1000,
    battleRam.sourceHitSpeed / 1000,
    "Charges buildings and releases two Barbarians when the ram breaks.",
    { rarity: "Rare", buildingsOnly: battleRam.targetsBuildings },
  ),
  troop(
    "executioner",
    "Executioner",
    executioner.cost,
    Math.round(executioner.sourceHitpoints * 1.1 ** 5),
    Math.round(executioner.projectile.damage * 1.1 ** 5),
    executioner.sourceSpeed / 60,
    executioner.sourceRange,
    executioner.sourceHitSpeed + executioner.projectile.visualTime,
    "Throws an axe through ground and air enemies, striking again on its return.",
    { rarity: "Epic", hitsAir: true, splash: executioner.projectile.radius },
  ),
  troop(
    "sparky",
    "Sparky",
    sparky.cost,
    Math.round(sparky.sourceHitpoints * 1.1 ** 2),
    Math.round(sparky.projectile.damage * 1.1 ** 2),
    sparky.sourceSpeed / 60,
    sparky.sourceRange,
    sparky.sourceHitSpeed,
    "Charges a powerful cannon blast that splashes ground enemies.",
    { rarity: "Legendary", hitsAir: false, splash: sparky.projectile.radius },
  ),
  troop(
    "lumberjack",
    "Lumberjack",
    lumberjack.cost,
    Math.round(lumberjack.sourceHitpoints * 1.1 ** 2),
    Math.round(lumberjack.sourceDamage * 1.1 ** 2),
    lumberjack.sourceSpeed / 60,
    lumberjack.sourceRange,
    lumberjack.sourceHitSpeed,
    "A fast axe fighter who drops a Rage bottle when defeated.",
    { rarity: "Legendary" },
  ),
  troop(
    "minion-horde",
    "Minion Horde",
    swarms.MinionHorde.cost,
    230,
    102,
    1.6,
    1,
    1,
    "Six flying Minions overwhelm targets that cannot fight back against air.",
    { air: true, hitsAir: true, count: swarms.MinionHorde.count },
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
    "Speeds up friendly troops' movement, attacks and summoning inside its area.",
    {
      kind: "spell",
      rarity: "Epic",
      radius: rage.radius,
      hitsAir: rage.hitsAir,
    },
  ),
];
export const CARD_MAP = {
  ...Object.fromEntries(CARDS.map((c) => [c.id, c])),
  // Spawned by Golem; never offered as a deck card.
  golemite: troop(
    "golemite",
    "Golemite",
    0,
    Math.round(golem.golemite.sourceHitpoints * 1.1 ** 5),
    Math.round(golem.golemite.sourceDamage * 1.1 ** 5),
    golem.golemite.sourceSpeed / 60,
    golem.golemite.sourceRange,
    golem.golemite.sourceHitSpeed,
    "A fragment of Golem that targets buildings and explodes on defeat.",
    { rarity: "Epic", buildingsOnly: true },
  ),
  // Spawned by Lava Hound; never offered as a deck card.
  "lava-pup": troop(
    "lava-pup",
    "Lava Pup",
    0,
    Math.round(lavaHound.pup.sourceHitpoints * 1.1 ** 2),
    Math.round(lavaHound.pup.sourceDamage * 1.1 ** 2),
    lavaHound.pup.sourceSpeed / 60,
    lavaHound.pup.sourceRange,
    lavaHound.pup.sourceHitSpeed,
    "A flying attacker released when Lava Hound is defeated.",
    { rarity: "Legendary", air: true, hitsAir: true },
  ),
} as Record<CardId, Card>;
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
export const PRESETS: { name: string; description: string; deck: CardId[] }[] =
  [
    {
      name: "Giant beatdown",
      description: "Build a push behind your Giant.",
      deck: STARTER_DECK,
    },
    {
      name: "Hog cycle",
      description: "Keep the pressure on with quick rotations.",
      deck: [
        "hog-rider",
        "musketeer",
        "cannon",
        "skeletons",
        "goblins",
        "fireball",
        "zap",
        "valkyrie",
      ],
    },
    {
      name: "Air assault",
      description: "Own the skies with a Balloon push.",
      deck: [
        "balloon",
        "baby-dragon",
        "minions",
        "knight",
        "archers",
        "arrows",
        "fireball",
        "skeletons",
      ],
    },
  ];
export const cardArt = (id: CardId) =>
  `${import.meta.env.BASE_URL}assets/cards/${id}.png`;
export const averageCost = (deck: CardId[]) =>
  deck.reduce((n, id) => n + CARD_MAP[id].cost, 0) / deck.length;
