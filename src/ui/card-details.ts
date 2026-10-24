import { CARD_MAP, type CardId } from "../game/cards";
import {
  ARROWS_WAVES,
  FIREBALL_KNOCKBACK,
  SPELL_CROWN_TOWER_DAMAGE_FRACTION,
} from "../game/combat";
import freeze from "../game/freeze-data.json" with { type: "json" };
import poison from "../game/poison-data.json" with { type: "json" };
import rage from "../game/rage-data.json" with { type: "json" };
import rocket from "../game/rocket-data.json" with { type: "json" };

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
  const allegiance =
    id === "rage" ? "Friendly " : c.kind === "spell" ? "Enemy " : "";
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
        targets,
        cost,
      ],
      note: "Boosts movement, attacks and spawning. The boost ends when the area expires.",
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
    const fraction =
      id === "rocket"
        ? rocket.crownTowerDamageFraction
        : SPELL_CROWN_TOWER_DAMAGE_FRACTION;
    return {
      stats: [
        stat(id === "arrows" ? "Volley damage" : "Damage", c.damage, "swords"),
        stat("Crown Tower damage", c.damage * fraction, "swords"),
        radius,
        targets,
        id === "arrows"
          ? stat("Waves", ARROWS_WAVES, "users")
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
          ? "Damage is the total across all three waves."
          : id === "zap"
            ? "Stuns enemies and resets their attacks."
            : "Knockback applies to eligible troops.",
    };
  }
  return {
    stats: [
      stat(c.count > 1 ? "Hitpoints per troop" : "Hitpoints", c.hp, "heart"),
      stat(
        c.count > 1 ? "Damage per troop" : "Damage per hit",
        c.damage,
        "swords",
      ),
      stat("Hit interval", seconds(c.interval), "timer"),
      stat("Range", tiles(c.range), "scan"),
      targets,
      c.kind === "building"
        ? stat("Lifetime", seconds(c.lifetime ?? 0), "timer")
        : stat("Count", c.count, "users"),
      cost,
    ],
    ...(c.count > 1
      ? {
          note: "Each troop has its own hitpoints. Damage is per troop, per hit.",
        }
      : {}),
  };
}
