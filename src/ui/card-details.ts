import { CARD_MAP, type CardId } from "../game/cards";
import {
  cardShieldHitpoints,
  FIREBALL_KNOCKBACK,
  HEAL_PER_TICK,
} from "../game/combat";
import freeze from "../game/freeze-data.json" with { type: "json" };
import poison from "../game/poison-data.json" with { type: "json" };
import rage from "../game/rage-data.json" with { type: "json" };
import rocket from "../game/rocket-data.json" with { type: "json" };
import mirror from "../game/mirror-data.json" with { type: "json" };
import clone from "../game/clone-data.json" with { type: "json" };
import graveyard from "../game/graveyard-data.json" with { type: "json" };
import log from "../game/log-data.json" with { type: "json" };
import lightning from "../game/lightning-data.json" with { type: "json" };
import tornado from "../game/tornado-data.json" with { type: "json" };
import heal from "../game/heal-data.json" with { type: "json" };
import { chargeRange, chargedAttackDamage } from "../game/charge";
import { deploymentTime } from "../game/deployment";
import elixirCollector from "../game/elixir-collector-data.json" with { type: "json" };
import goblinHut from "../game/goblin-hut-data.json" with { type: "json" };
import tombstone from "../game/tombstone-data.json" with { type: "json" };
import furnace from "../game/furnace-data.json" with { type: "json" };
import barbarianHut from "../game/barbarian-hut-data.json" with { type: "json" };

const buildingSpawns = {
  "goblin-hut": { name: "Spear Goblin", rules: goblinHut, stagger: 0, deploy: 1 },
  tombstone: { name: "Skeleton", rules: tombstone, stagger: 0, deploy: 1 },
  furnace: { name: "Fire Spirit", rules: furnace, stagger: furnace.spawnInterval,
    deploy: furnace.spiritDeployTime + furnace.spiritDeployDelay },
  "barbarian-hut": { name: "Barbarian", rules: barbarianHut,
    stagger: barbarianHut.spawnInterval,
    deploy: barbarianHut.unitDeployTime + barbarianHut.unitDeployDelay },
};
const quantity = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"}`;

type StatIcon =
  "heart" | "swords" | "timer" | "scan" | "crosshair" | "users" | "droplet";
export interface CardStat {
  label: string;
  value: string;
  icon: StatIcon;
}
const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const number = (value: number) => formatter.format(value);
const seconds = (value: number) => `${number(value)} s`;
const tiles = (value: number) =>
  `${number(value)} tile${value === 1 ? "" : "s"}`;
const stat = (
  label: string,
  value: string | number,
  icon: StatIcon,
): CardStat => ({
  label,
  value: typeof value === "number" ? number(value) : value,
  icon,
});

/** Current normalized arena stats, including effect data consumed by Battle. */
export function cardDetails(id: CardId): { stats: CardStat[]; note?: string } {
  const c = CARD_MAP[id];
  const cost = stat("Elixir", c.cost, "droplet");
  const allegiance = ["rage", "heal", "clone"].includes(id)
    ? "Friendly "
    : c.kind === "spell"
      ? "Enemy "
      : "";
  const targetType = c.buildingsOnly
    ? "Buildings"
    : c.hitsAir
      ? "Air & ground"
      : "Ground";
  const targets = stat(
    "Targets",
    `${allegiance}${allegiance ? targetType.toLowerCase() : targetType}`,
    "crosshair",
  );
  const radius = stat("Radius", tiles(c.radius ?? 0), "scan");
  if (id === "elixir-collector")
    return {
      stats: [
        stat("Hitpoints", c.hp, "heart"),
        stat("Elixir per cycle", elixirCollector.collectAmount, "droplet"),
        stat("Production interval", seconds(elixirCollector.generateInterval), "timer"),
        stat("Deploy time", seconds(deploymentTime(id)), "timer"),
        stat("Lifetime", seconds(c.lifetime!), "timer"),
        cost,
      ],
      note: "The first collection occurs one production interval after deployment. Stored elixir is capped at 10. Production stops when the building is destroyed or expires.",
    };
  if (Object.hasOwn(buildingSpawns, id)) {
    const spawn = buildingSpawns[id as keyof typeof buildingSpawns];
    return {
      stats: [
        stat("Hitpoints", c.hp, "heart"),
        stat("Spawns", quantity(spawn.rules.spawnNumber, spawn.name), "users"),
        stat("First spawn delay", seconds(spawn.rules.spawnPause), "timer"),
        stat(spawn.stagger ? "Wave interval" : "Spawn interval",
          seconds(spawn.rules.spawnPause + spawn.stagger), "timer"),
        ...(spawn.stagger ? [stat("Troop spacing", seconds(spawn.stagger), "timer")] : []),
        stat("Deploy time", seconds(deploymentTime(id)), "timer"),
        stat("Troop deploy time", seconds(spawn.deploy), "timer"),
        ...(id === "tombstone" ? [stat("On destruction",
          quantity(tombstone.deathSpawnCount, spawn.name), "users")] : []),
        stat("Lifetime", seconds(c.lifetime!), "timer"),
        cost,
      ],
      note: "The first spawn delay starts after the building deploys. " +
        (id === "tombstone"
          ? "The listed death spawn also occurs when its lifetime expires."
          : spawn.stagger
            ? "The second troop does not appear if the building is destroyed before it spawns."
            : "Spawning stops when the building is destroyed or expires."),
    };
  }
  if (id === "mirror")
    return {
      stats: [
        stat("Elixir", `Previous card + ${mirror.surcharge}`, "droplet"),
        stat("Effect", "Repeat previous card", "users"),
      ],
      note: "Play another card first. Copies its targeting and deployment rules.",
    };
  if (id === "heal")
    return {
      stats: [
        stat("Healing per second", HEAL_PER_TICK / heal.healInterval, "heart"),
        stat("Duration", seconds(heal.duration), "timer"),
        stat("Linger", `Up to ${seconds(heal.buffDuration)}`, "timer"),
        radius,
        stat("Targets", "Friendly air & ground troops", "crosshair"),
        cost,
      ],
      note: "Restores troop health up to its maximum. Buildings are unaffected.",
    };
  if (id === "clone")
    return {
      stats: [
        stat("Copy hitpoints", 1, "heart"),
        radius,
        stat("Targets", "Friendly air & ground troops", "crosshair"),
        stat("Deploy delay", seconds(clone.buffDuration), "timer"),
        cost,
      ],
      note: "Copies troop combat stats with one hitpoint and no shield. Buildings and existing clones are unaffected.",
    };
  if (id === "goblin-barrel")
    return {
      stats: [
        stat("Summons", "3 Goblins", "users"),
        stat("Hitpoints per Goblin", CARD_MAP.goblins.hp, "heart"),
        stat("Damage per Goblin", CARD_MAP.goblins.damage, "swords"),
        radius,
        cost,
      ],
      note: "The barrel deals no impact damage; its Goblins attack after landing.",
    };
  if (id === "graveyard")
    return {
      stats: [
        stat("Summons", "Skeletons", "users"),
        stat("Duration", seconds(graveyard.duration), "timer"),
        stat("First spawn", seconds(graveyard.spawnInitialDelay), "timer"),
        stat("Spawn interval", seconds(graveyard.spawnInterval), "timer"),
        radius,
        cost,
      ],
      note: "Summons Skeletons throughout the area; the spell deals no direct damage.",
    };
  if (id === "tornado")
    return {
      stats: [
        stat("Damage per second", c.damage / tornado.damageInterval, "swords"),
        stat("Duration", seconds(tornado.duration), "timer"),
        radius,
        stat("Targets", "Enemy air & ground troops", "crosshair"),
        cost,
      ],
      note: "Pulls troops toward the center. Buildings and Crown Towers are unaffected.",
    };
  if (id === "lightning")
    return {
      stats: [
        stat("Damage per strike", c.damage, "swords"),
        stat(
          "Crown Tower damage",
          c.damage * lightning.crownTowerDamageFraction,
          "swords",
        ),
        stat("Maximum targets", 3, "users"),
        stat("Stun", seconds(lightning.stunDuration), "timer"),
        radius,
        targets,
        cost,
      ],
      note: "Strikes the highest-health eligible enemies in the area.",
    };
  if (id === "log")
    return {
      stats: [
        stat("Damage", c.damage, "swords"),
        stat(
          "Crown Tower damage",
          c.damage * log.crownTowerDamageFraction,
          "swords",
        ),
        stat("Rolling range", tiles(log.rollingRange), "scan"),
        stat("Knockback", tiles(log.knockback), "scan"),
        targets,
        cost,
      ],
      note: "Rolls through ground enemies and knocks eligible troops backward.",
    };
  if (id === "freeze")
    return {
      stats: [
        stat("Effect", "Freeze", "timer"),
        stat("Duration", seconds(freeze.duration), "timer"),
        radius,
        targets,
        stat("Hidden Tesla", "Affected", "crosshair"),
        cost,
      ],
      note: "Also freezes enemy buildings and Crown Towers.",
    };
  if (id === "rage")
    return {
      stats: [
        stat(
          "Speed boost",
          `+${number((rage.speedMultiplier - 1) * 100)}%`,
          "timer",
        ),
        stat("Duration", seconds(rage.duration), "timer"),
        stat("Linger", `Up to ${seconds(rage.buffDuration)}`, "timer"),
        radius,
        stat("Targets", "Friendly air & ground troops", "crosshair"),
        cost,
      ],
      note: "Boosts troop movement, attacks and spawning. Buildings and Crown Towers are unaffected. The boost ends when the area expires.",
    };
  if (id === "poison") {
    const dps = c.damage / poison.damageInterval;
    return {
      stats: [
        stat("Damage per second", dps, "swords"),
        stat(
          "Crown Tower / second",
          dps * poison.crownTowerDamageFraction,
          "swords",
        ),
        stat("Duration", seconds(poison.duration), "timer"),
        stat("Linger", `Up to ${seconds(poison.buffDuration)}`, "timer"),
        radius,
        targets,
        cost,
      ],
      note: "Damage lingers briefly after leaving the cloud. Buried Tesla blocks new Poison applications.",
    };
  }
  if (c.kind === "spell") {
    const fraction = id === "rocket" ? rocket.crownTowerDamageFraction : 0.4;
    return {
      stats: [
        stat(id === "arrows" ? "Volley damage" : "Damage", c.damage, "swords"),
        stat("Crown Tower damage", c.damage * fraction, "swords"),
        radius,
        targets,
        id === "arrows"
          ? stat("Waves", 1, "users")
          : id === "zap"
            ? stat("Stun", seconds(c.stun ?? 0), "timer")
            : stat(
                "Knockback",
                tiles(id === "rocket" ? rocket.knockback : FIREBALL_KNOCKBACK),
                "scan",
              ),
        cost,
      ],
      note:
        id === "arrows"
          ? "A single flight of 15 arrows deals the full volley damage once."
          : id === "zap"
            ? "Stuns enemies and resets their attacks."
            : "Knockback applies to eligible troops.",
    };
  }
  const shield = cardShieldHitpoints(id);
  const charge = chargeRange(id);
  const note = [
    c.count > 1
      ? "Each troop has its own hitpoints. Damage is per troop, per hit."
      : "",
    shield > 0
      ? "Shield hitpoints are separate. A hit that breaks the shield does not damage the body."
      : "",
    Number.isFinite(charge)
      ? "Charges after moving the listed distance, doubling movement speed. Stun resets the charge."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    stats: [
      stat(c.count > 1 ? "Hitpoints per troop" : "Hitpoints", c.hp, "heart"),
      ...(shield > 0
        ? [
            stat(
              c.count > 1 ? "Shield per troop" : "Shield hitpoints",
              shield,
              "heart",
            ),
          ]
        : []),
      stat(
        c.count > 1 ? "Damage per troop" : "Damage per hit",
        c.damage,
        "swords",
      ),
      ...(Number.isFinite(charge)
        ? [
            stat("Charge damage", chargedAttackDamage({
              card: id, damage: c.damage, move: 0, chargeDistance: charge,
            }), "swords"),
            stat("Charge distance", tiles(charge), "scan"),
          ]
        : []),
      stat("Hit interval", seconds(c.interval), "timer"),
      stat("Range", tiles(c.range), "scan"),
      targets,
      c.kind === "building"
        ? stat("Lifetime", seconds(c.lifetime ?? 0), "timer")
        : stat("Count", c.count, "users"),
      cost,
    ],
    ...(note ? { note } : {}),
  };
}
