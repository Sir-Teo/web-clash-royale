import { Battle, type Entity, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

export const goalDeck: CardId[] = ["bandit", "zap", "cannon", "archers", "rage", "ice-wizard", "knight", "skeletons"];
export const goalEnemyDeck: CardId[] = ["skeletons", "zap", "cannon", "archers", "rage", "ice-wizard", "knight", "poison"];

/** Legal play kills the chosen Skeleton while Bandit is already travelling. */
export function banditGoalOpening(version: Replay["version"], runner: Team = "blue") {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? goalDeck : goalEnemyDeck,
      enemyDeck: runner === "blue" ? goalEnemyDeck : goalDeck });
    if (candidate.players[runner].hand.includes("bandit") && candidate.players[runner].hand.includes("zap") && candidate.players[defender].hand.includes("skeletons")) {
      initial = candidate;
      break;
    }
  }
  if (!initial) throw new Error("No committed-dash opening hand");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const play = (team: Team, card: CardId, x: number, y: number) => {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  const x = runner === "blue" ? 4 : 14;
  play(runner, "bandit", x, runner === "blue" ? 19 : 13);
  play(defender, "skeletons", x, runner === "blue" ? 13 : 19);
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  while (!bandit.dash && battle.tick < 300) battle.step();
  if (!bandit.dash) throw new Error("Bandit did not begin a dash");
  const target = battle.entities.find((e) => e.id === bandit.dash!.target)!;
  const goal = bandit.dash.goal ? { ...bandit.dash.goal } : undefined;
  play(runner, "zap", target.x, target.y);
  while (target.hp > 0 && battle.tick < 330) battle.step();
  if (target.hp > 0) throw new Error("Zap did not remove the chosen target");
  battle.step();
  return { battle, bandit, target, goal, runner };
}

export function finishCommittedDash(battle: Battle, bandit: Entity) {
  for (let step = 0; bandit.dash && step < 60; step++) battle.step();
  if (bandit.dash) throw new Error("Committed dash did not finish");
}
