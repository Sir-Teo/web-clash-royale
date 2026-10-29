import { Battle, STEP, type Entity, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const banditDeck: CardId[] = ["bandit", "knight", "cannon", "archers", "rage", "ice-wizard", "zap", "skeletons"];
const poisonDeck: CardId[] = ["poison", "knight", "cannon", "archers", "rage", "ice-wizard", "zap", "skeletons"];

/** Legal commands and simulation steps produce a due Poison tick mid-dash. */
export function banditDashOpening(version: Replay["version"], runner: Team = "blue") {
  const caster = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false,
      deck: runner === "blue" ? banditDeck : poisonDeck,
      enemyDeck: runner === "blue" ? poisonDeck : banditDeck });
    if (candidate.players[runner].hand.includes("bandit") &&
        candidate.players[caster].hand.includes("knight") &&
        candidate.players[caster].hand.includes("poison")) {
      initial = candidate;
      break;
    }
  }
  if (!initial) throw new Error("No Bandit/Poison opening hand");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  while (battle.tick < 180) battle.step();
  const play = (team: Team, card: CardId, x: number, y: number) => {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  const x = runner === "blue" ? 4 : 14;
  play(runner, "bandit", x, runner === "blue" ? 19 : 13);
  play(caster, "knight", x, runner === "blue" ? 13 : 19);
  while (battle.tick < 183) battle.step();
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  play(caster, "poison", bandit.x, bandit.y);
  while (battle.tick < 300 && !(bandit.dash && bandit.poison &&
      bandit.poison.elapsed + STEP + 1e-8 >= 1)) battle.step();
  if (!bandit.dash || !bandit.poison || bandit.poison.elapsed + STEP + 1e-8 < 1)
    throw new Error("No retained Poison tick during dash");
  return { battle, bandit, runner, caster };
}

export function dashDistance(before: Pick<Entity, "x" | "y">, after: Pick<Entity, "x" | "y">) {
  return Math.hypot(after.x - before.x, after.y - before.y);
}
