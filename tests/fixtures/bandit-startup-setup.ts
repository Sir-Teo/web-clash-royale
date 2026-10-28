import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const deck: CardId[] = ["bandit", "zap", "cannon", "archers", "rage", "ice-wizard", "knight", "skeletons"];
const enemy: CardId[] = ["knight", "zap", "cannon", "archers", "rage", "ice-wizard", "poison", "skeletons"];

/** Unmodified legal opening exposes vulnerable charging versus old travel. */
export function banditStartupOpening(version: Replay["version"] = 50, runner: Team = "blue") {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? deck : enemy,
      enemyDeck: runner === "blue" ? enemy : deck });
    if (candidate.players[runner].hand.includes("bandit") &&
        candidate.players[defender].hand.includes("knight") &&
        candidate.players[defender].hand.includes("zap")) { initial = candidate; break; }
  }
  if (!initial) throw new Error("No Bandit charge opening hand");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const x = runner === "blue" ? 4 : 14;
  for (const [team, card, y] of [[runner, "bandit", runner === "blue" ? 19 : 13],
    [defender, "knight", runner === "blue" ? 13 : 19]] as const) {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  }
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  while (!bandit.dash && !bandit.dashCharge?.started && battle.tick < 300) battle.step();
  if (!bandit.dash && !bandit.dashCharge) throw new Error("Bandit did not prepare a dash");
  return { battle, bandit, runner, defender };
}

export function zapChargingBandit(battle: Battle, bandit: Entity, defender: Team) {
  const before = bandit.hp;
  const cast = battle.play(defender, battle.players[defender].hand.indexOf("zap"), bandit.x, bandit.y);
  if (!cast.ok) throw new Error(`Startup Zap: ${cast.reason}`);
  const limit = battle.tick + 12;
  while (battle.tick < limit && !battle.events.some((e) => e.type === "hit" && e.card === "zap")) battle.step();
  if (!battle.events.some((e) => e.type === "hit" && e.card === "zap")) throw new Error("Startup Zap did not land");
  return before - bandit.hp;
}

export function finishBanditStartup(battle: Battle, bandit: Entity) {
  for (let step = 0; step < 180 && !bandit.dash && bandit.hp > 0; step++) battle.step();
  if (!bandit.dash) throw new Error("Charging Bandit did not launch");
}
