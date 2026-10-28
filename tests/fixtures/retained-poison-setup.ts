import { Battle, type Replay, type Team } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

const poisonDeck: CardId[] = ["poison", "skeletons", "zap", "lightning", "log", "electro-wizard", "rage", "ice-wizard"];
const teslaDeck: CardId[] = ["hog-rider", "bandit", "tesla", "prince", "mortar", "ice-wizard", "rage", "zap"];

/** All entities, resources, clocks and burrow phases come from legal commands. */
export function retainedPoisonOpening(version: Replay["version"], caster: Team = "blue") {
  const defender = caster === "blue" ? "red" : "blue";
  let initial: Battle | undefined;
  for (let seed = 1; seed < 10000; seed++) {
    const candidate = new Battle({ seed, ai: false, deck: caster === "blue" ? poisonDeck : teslaDeck, enemyDeck: caster === "blue" ? teslaDeck : poisonDeck });
    if (candidate.players[caster].hand.includes("poison") && candidate.players[caster].hand.includes("skeletons") && candidate.players[defender].hand.includes("tesla")) {
      initial = candidate;
      break;
    }
  }
  if (!initial) throw new Error("No retained Poison opening hand");
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  const x = caster === "blue" ? 4 : 14;
  const play = (team: Team, card: CardId, x: number, y: number) => {
    const result = battle.play(team, battle.players[team].hand.indexOf(card), x, y);
    if (!result.ok) throw new Error(`${card}: ${result.reason}`);
  };
  play(defender, "tesla", x, caster === "blue" ? 14 : 18);
  play(caster, "skeletons", x, caster === "blue" ? 18 : 14);
  const tesla = battle.entities.find((e) => e.card === "tesla")!;
  while (tesla.burrow?.phase !== "exposed" && battle.tick < 180) battle.step();
  if (tesla.burrow?.phase !== "exposed") throw new Error("Tesla did not expose");
  play(caster, "poison", tesla.x, tesla.y);
  while (tesla.hp > 0 && tesla.burrow?.phase !== "hidden" && battle.tick < 450) battle.step();
  if (tesla.hp <= 0 || tesla.burrow?.phase !== "hidden" || !tesla.poison)
    throw new Error("No live hidden Tesla with retained Poison");
  return { battle, tesla, caster };
}

export function advanceRetainedPoisonTick(battle: Battle, tesla: Battle["entities"][number]) {
  for (let step = 0; step < 60; step++) {
    const due = !!tesla.poison && tesla.poison.elapsed + 1 / 30 + 1e-8 >= 1;
    battle.step();
    if (due) return;
  }
  throw new Error("No retained Poison tick before expiry");
}
