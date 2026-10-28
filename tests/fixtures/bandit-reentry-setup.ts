import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const deck: CardId[] = ["bandit", "zap", "cannon", "archers", "rage", "ice-wizard", "knight", "skeletons"];
const enemy: CardId[] = ["spear-goblins", "knight", "cannon", "archers", "rage", "ice-wizard", "zap", "poison"];

/** Legal commands remove the first group during travel, leaving a distant Knight. */
export function banditReentryOpening(version: Replay["version"] = 51, runner: Team = "blue") {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? deck : enemy,
      enemyDeck: runner === "blue" ? enemy : deck });
    if (candidate.players[runner].hand.includes("bandit") && candidate.players[runner].hand.includes("zap") &&
        candidate.players[defender].hand.includes("spear-goblins") && candidate.players[defender].hand.includes("knight")) {
      initial = candidate; break;
    }
  }
  if (!initial) throw new Error("No legal Bandit reentry opening");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const x = runner === "blue" ? 4 : 14;
  const play = (team: Team, card: CardId, y: number) => {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  play(runner, "bandit", runner === "blue" ? 19 : 13);
  play(defender, "spear-goblins", runner === "blue" ? 13 : 19);
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  while (!bandit.dash && battle.tick < 400) battle.step();
  if (!bandit.dash) throw new Error("First dash did not launch");
  play(defender, "knight", runner === "blue" ? 9.5 : 22.5);
  play(runner, "zap", runner === "blue" ? 13 : 19);
  const knight = battle.entities.find((e) => e.card === "knight")!;
  while (bandit.dash && battle.tick < 450) battle.step();
  if (bandit.dash || bandit.hp <= 0) throw new Error("First dash did not finish alive");
  if (battle.entities.some((e) => e.card === "spear-goblins" && e.hp > 0)) throw new Error("First group survived Zap");
  return { battle, bandit, knight, runner, landingTick: battle.tick,
    landing: { x: bandit.x, y: bandit.y }, landingHp: bandit.hp };
}
