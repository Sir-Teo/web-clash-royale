import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const deck: CardId[] = ["bandit", "rage", "heal", "cannon", "archers", "ice-wizard", "knight", "skeletons"];
const enemy: CardId[] = ["knight", "zap", "cannon", "archers", "rage", "ice-wizard", "poison", "skeletons"];

/** Legal deployment and optional post-landing Rage; no body/hand/clock edits. */
export function banditCadenceOpening(version: Replay["version"] = 53, runner: Team = "blue", raged = true) {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? deck : enemy, enemyDeck: runner === "blue" ? enemy : deck });
    if (candidate.players[runner].hand.includes("bandit") && candidate.players[runner].hand.includes("rage") &&
        candidate.players[defender].hand.includes("knight")) { initial = candidate; break; }
  }
  if (!initial) throw new Error("No legal Bandit cadence opening");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const x = runner === "blue" ? 4 : 14;
  const play = (team: Team, card: CardId, y: number, px = x) => {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), px, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  play(runner, "bandit", runner === "blue" ? 19 : 13);
  play(defender, "knight", runner === "blue" ? 13 : 19);
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  while (!bandit.dash && battle.tick < 400) battle.step();
  if (!bandit.dash) throw new Error("Bandit did not launch");
  while (bandit.dash && battle.tick < 450) battle.step();
  const knight = battle.entities.find((e) => e.card === "knight")!;
  if (bandit.dash || !knight || bandit.hp <= 0) throw new Error("Bandit did not land alive");
  const landingTick = battle.tick;
  if (raged) play(runner, "rage", bandit.y, bandit.x);
  return { battle, bandit, knight, landingTick, runner, raged };
}
