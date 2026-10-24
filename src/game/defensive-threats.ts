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
  const threats = entities
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
      let lethalKing = false,
        lethalTower = false;
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
        if (eta < 1 && target.hp <= entity.damage) {
          lethalKing = !!target.king;
          lethalTower = !target.king;
        }
      }
      return { entity, score, target: target?.id, lethalKing, lethalTower };
    });
  return threats
    .map((threat) => {
      let pressure = 0,
        urgency = 0;
      for (const neighbor of threats) {
        if (threat.target === undefined || neighbor.target !== threat.target)
          continue;
        // Local support fades to zero at three tiles. This is not a chain
        // joining every attacker in a lane into one distant push.
        const weight = Math.max(
          0,
          1 - distance(threat.entity, neighbor.entity) / 3,
        );
        pressure += neighbor.score * weight;
        // Losing the same Princess Tower is one emergency, not one per body.
        if (neighbor.lethalTower) urgency = Math.max(urgency, 500 * weight);
      }
      return { ...threat, pressure: pressure + urgency };
    })
    .sort(
      (a, b) =>
        Number(b.lethalKing) - Number(a.lethalKing) ||
        b.pressure - a.pressure ||
        b.score - a.score ||
        (team === "red" ? a.entity.y - b.entity.y : b.entity.y - a.entity.y) ||
        a.entity.id - b.entity.id,
    )
    .map(({ entity }) => entity);
}
