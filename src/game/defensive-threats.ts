import type { Entity, Team } from "./engine";

const distance = (a: Entity, b: Entity) => Math.hypot(a.x - b.x, a.y - b.y);

/** Visible troop pressure on living Crown Towers, without simulation or RNG. */
export function defensiveThreats(
  team: Team,
  entities: readonly Entity[],
): Entity[] {
  const towers = entities.filter(
    (e) => e.team === team && e.kind === "tower" && e.hp > 0,
  );
  const arrival = (e: Entity, tower: Entity) => {
    const gap = Math.max(
      0,
      distance(e, tower) - e.range - e.radius - tower.radius,
    );
    return (
      Math.max(0, e.deploy) +
      Math.max(0, e.stun) +
      (gap === 0 ? 0 : gap / Math.max(0.1, e.speed))
    );
  };
  return entities
    .filter(
      (e) =>
        e.team !== team &&
        e.kind === "troop" &&
        e.hp > 0 &&
        (team === "red" ? e.y < 15 : e.y > 17),
    )
    .map((entity) => {
      const target =
        towers.find((tower) => tower.id === entity.target) ??
        [...towers].sort(
          (a, b) => arrival(entity, a) - arrival(entity, b) || a.id - b.id,
        )[0];
      let score = 0;
      if (target) {
        let eta = arrival(entity, target);
        const dps = entity.damage / Math.max(0.1, entity.interval);
        const occupied = entities.find(
          (e) =>
            e.id === entity.target &&
            e.team === team &&
            e.kind !== "tower" &&
            e.hp > 0,
        );
        // An attacker already fighting a defender must first finish that fight.
        if (occupied) eta += Math.min(6, occupied.hp / Math.max(1, dps));
        const health = Math.sqrt(
          Math.max(0, Math.min(1, entity.hp / entity.maxHp)),
        );
        const vulnerability =
          1 + 2 * (1 - Math.max(0, Math.min(1, target.hp / target.maxHp)));
        score =
          (dps * health * vulnerability * (target.king ? 1.5 : 1)) /
          (1 + eta / 2);
        if (eta < 1 && target.hp <= entity.damage)
          score += target.king ? 10000 : 500;
      }
      return { entity, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (team === "red" ? a.entity.y - b.entity.y : b.entity.y - a.entity.y) ||
        a.entity.id - b.entity.id,
    )
    .map(({ entity }) => entity);
}
