import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const deck: CardId[] = ["bandit", "rage", "heal", "cannon", "archers", "ice-wizard", "knight", "skeletons"];
const enemy: CardId[] = ["knight", "zap", "cannon", "archers", "rage", "ice-wizard", "poison", "skeletons"];

/** Legal close-range opening with optional Rage and no initial dash. */
export function banditOrdinaryOpening(version: Replay["version"] = 55, runner: Team = "blue", raged = true) {
  const defender = runner === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const sample = new Battle({ seed, ai: false,
      deck: runner === "blue" ? deck : enemy, enemyDeck: runner === "blue" ? enemy : deck });
    if (sample.players[runner].hand.includes("bandit") && sample.players[runner].hand.includes("rage") &&
        sample.players[defender].hand.includes("knight")) { initial = sample; break; }
  }
  if (!initial) throw new Error("No legal close-range Bandit opening");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  const x = runner === "blue" ? 4 : 14;
  const y = runner === "blue" ? 19 : 13;
  while (battle.tick < 60) battle.step();
  const defenderPlay = battle.play(defender, battle.players[defender].hand.indexOf("knight"), x, 32 - y);
  if (!defenderPlay.ok) throw new Error(`Knight: ${defenderPlay.reason}`);
  while (battle.tick < 180) battle.step();
  for (const [team, card, point] of [[runner, "bandit", y],
    ...(raged ? [[runner, "rage", y] as const] : [])] as const) {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, point);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  }
  const bandit = battle.entities.find((e) => e.card === "bandit")!;
  const knight = battle.entities.find((e) => e.card === "knight")!;
  const ordinary = () => battle.events.filter((e) => e.type === "hit" && e.card === "bandit" && !e.effect);
  while (!bandit.pendingAttack && battle.tick < 300) {
    battle.step();
    if (bandit.dashCharge || bandit.dash) throw new Error("Close-range Bandit started a dash");
  }
  if (!bandit.pendingAttack || ordinary().length) throw new Error("No fresh ordinary windup");
  return { battle, bandit, knight, runner, raged, preparingTick: battle.tick };
}
