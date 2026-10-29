import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const deck: CardId[] = ["bandit", "rage", "heal", "cannon", "archers", "ice-wizard", "knight", "skeletons"];
const enemy: CardId[] = ["knight", "tornado", "cannon", "archers", "zap", "ice-wizard", "rage", "poison"];

/** Legal commands prepare a post-dash swing; the opponent can pull Bandit away. */
export function banditTransitionOpening(version: Replay["version"] = 54, runner: Team = "blue") {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? deck : enemy, enemyDeck: runner === "blue" ? enemy : deck });
    if (candidate.players[runner].hand.includes("bandit") && candidate.players[defender].hand.includes("knight") &&
        candidate.players[defender].hand.includes("tornado")) { initial = candidate; break; }
  }
  if (!initial) throw new Error("No legal ordinary pull opening");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const x = runner === "blue" ? 4 : 14;
  for (const [team, card, y] of [[runner, "bandit", runner === "blue" ? 19 : 13],
    [defender, "knight", runner === "blue" ? 13 : 19]] as const) {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  }
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  while (!bandit.dash && battle.tick < 400) battle.step();
  if (!bandit.dash) throw new Error("Bandit did not launch");
  while (bandit.dash && battle.tick < 450) battle.step();
  const landingTick = battle.tick;
  const knight = battle.entities.find((e) => e.card === "knight")!;
  const landingHp = knight.hp;
  while (!bandit.pendingAttack?.recovery?.animating && battle.tick < landingTick + 60) battle.step();
  if (!bandit.pendingAttack?.recovery?.animating) throw new Error("Bandit did not prepare an ordinary attack");
  return { battle, bandit, knight, runner, defender, landingTick, landingHp,
    releaseTick: landingTick + 29, point: { x: bandit.x, y: bandit.y + (runner === "blue" ? 4.5 : -4.5) } };
}

export function pullPreparingBandit(scene: ReturnType<typeof banditTransitionOpening>) {
  const { battle, defender, point } = scene;
  const result = battle.play(defender, battle.players[defender].hand.indexOf("tornado"), point.x, point.y);
  if (!result.ok) throw new Error(`Tornado: ${result.reason}`);
}
